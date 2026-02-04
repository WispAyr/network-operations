/**
 * Sites & Locations API Routes
 * Handles CRUD operations for the site/location hierarchy
 */

import { Router, Request, Response } from 'express';
import { eq, desc, sql, count, and, isNull } from 'drizzle-orm';
import { db, sites, locations, devices, vehicles, generateId, NewSite, NewLocation } from '../db/index.js';

const router = Router();

// ============================================
// SITES
// ============================================

/**
 * GET /api/v1/sites
 * List all sites with optional stats
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const includeStats = req.query.stats === 'true';
    
    if (includeStats) {
      // Get sites with device/location counts
      const sitesWithStats = await db
        .select({
          id: sites.id,
          name: sites.name,
          description: sites.description,
          role: sites.role,
          isPrimary: sites.isPrimary,
          address: sites.address,
          latitude: sites.latitude,
          longitude: sites.longitude,
          primaryUplinkType: sites.primaryUplinkType,
          backupUplinkType: sites.backupUplinkType,
          connectsToSiteId: sites.connectsToSiteId,
          metadata: sites.metadata,
          createdAt: sites.createdAt,
          updatedAt: sites.updatedAt,
        })
        .from(sites)
        .orderBy(desc(sites.isPrimary), sites.name);

      // Get counts for each site
      const siteIds = sitesWithStats.map(s => s.id);
      
      const locationCounts = await db
        .select({
          siteId: locations.siteId,
          count: count(),
        })
        .from(locations)
        .groupBy(locations.siteId);

      const deviceCounts = await db
        .select({
          siteId: locations.siteId,
          count: count(),
          online: sql<number>`SUM(CASE WHEN ${devices.status} = 'online' THEN 1 ELSE 0 END)`,
          offline: sql<number>`SUM(CASE WHEN ${devices.status} = 'offline' THEN 1 ELSE 0 END)`,
        })
        .from(devices)
        .innerJoin(locations, eq(devices.locationId, locations.id))
        .groupBy(locations.siteId);

      // Merge stats into sites
      const result = sitesWithStats.map(site => ({
        ...site,
        stats: {
          locationCount: locationCounts.find(l => l.siteId === site.id)?.count ?? 0,
          deviceCount: deviceCounts.find(d => d.siteId === site.id)?.count ?? 0,
          devicesOnline: deviceCounts.find(d => d.siteId === site.id)?.online ?? 0,
          devicesOffline: deviceCounts.find(d => d.siteId === site.id)?.offline ?? 0,
        },
      }));

      res.json(result);
    } else {
      const result = await db.select().from(sites).orderBy(desc(sites.isPrimary), sites.name);
      res.json(result);
    }
  } catch (error) {
    console.error('[Sites] Error listing sites:', error);
    res.status(500).json({ error: 'Failed to list sites' });
  }
});

/**
 * GET /api/v1/sites/tree
 * Get hierarchical tree view of sites -> locations -> devices
 */
router.get('/tree', async (req: Request, res: Response) => {
  try {
    // Get all sites
    const allSites = await db.select().from(sites).orderBy(desc(sites.isPrimary), sites.name);
    
    // Get all locations
    const allLocations = await db.select().from(locations).orderBy(locations.name);
    
    // Get all devices with their locations
    const allDevices = await db
      .select({
        id: devices.id,
        name: devices.name,
        type: devices.type,
        status: devices.status,
        locationId: devices.locationId,
        vehicleId: devices.vehicleId,
        primaryIp: devices.primaryIp,
      })
      .from(devices)
      .orderBy(devices.name);

    // Get unassigned devices (no location or vehicle)
    const unassignedDevices = allDevices.filter(d => !d.locationId && !d.vehicleId);

    // Build the tree
    const tree = allSites.map(site => ({
      id: site.id,
      name: site.name,
      type: 'site' as const,
      role: site.role,
      isPrimary: site.isPrimary,
      children: allLocations
        .filter(loc => loc.siteId === site.id)
        .map(location => ({
          id: location.id,
          name: location.name,
          type: 'location' as const,
          locationType: location.type,
          floor: location.floor,
          children: allDevices
            .filter(dev => dev.locationId === location.id)
            .map(device => ({
              id: device.id,
              name: device.name,
              type: 'device' as const,
              deviceType: device.type,
              status: device.status,
              primaryIp: device.primaryIp,
            })),
        })),
    }));

    // Get vehicles as separate tree entries
    const allVehicles = await db.select().from(vehicles).orderBy(vehicles.name);
    const vehicleTree = allVehicles.map(vehicle => ({
      id: vehicle.id,
      name: vehicle.name,
      type: 'vehicle' as const,
      vehicleType: vehicle.type,
      currentSiteId: vehicle.currentSiteId,
      children: allDevices
        .filter(dev => dev.vehicleId === vehicle.id)
        .map(device => ({
          id: device.id,
          name: device.name,
          type: 'device' as const,
          deviceType: device.type,
          status: device.status,
          primaryIp: device.primaryIp,
        })),
    }));

    res.json({
      sites: tree,
      vehicles: vehicleTree,
      unassigned: unassignedDevices.map(d => ({
        id: d.id,
        name: d.name,
        type: 'device' as const,
        deviceType: d.type,
        status: d.status,
        primaryIp: d.primaryIp,
      })),
    });
  } catch (error) {
    console.error('[Sites] Error getting tree:', error);
    res.status(500).json({ error: 'Failed to get site tree' });
  }
});

/**
 * GET /api/v1/sites/:id
 * Get a single site with its locations
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    
    const site = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
    
    if (!site.length) {
      return res.status(404).json({ error: 'Site not found' });
    }

    // Get locations for this site
    const siteLocations = await db
      .select()
      .from(locations)
      .where(eq(locations.siteId, id))
      .orderBy(locations.name);

    // Get device counts per location
    const locationDeviceCounts = await db
      .select({
        locationId: devices.locationId,
        total: count(),
        online: sql<number>`SUM(CASE WHEN ${devices.status} = 'online' THEN 1 ELSE 0 END)`,
        offline: sql<number>`SUM(CASE WHEN ${devices.status} = 'offline' THEN 1 ELSE 0 END)`,
      })
      .from(devices)
      .where(sql`${devices.locationId} IN (SELECT id FROM locations WHERE site_id = ${id})`)
      .groupBy(devices.locationId);

    const locationsWithStats = siteLocations.map(loc => ({
      ...loc,
      stats: {
        deviceCount: locationDeviceCounts.find(c => c.locationId === loc.id)?.total ?? 0,
        devicesOnline: locationDeviceCounts.find(c => c.locationId === loc.id)?.online ?? 0,
        devicesOffline: locationDeviceCounts.find(c => c.locationId === loc.id)?.offline ?? 0,
      },
    }));

    res.json({
      ...site[0],
      locations: locationsWithStats,
    });
  } catch (error) {
    console.error('[Sites] Error getting site:', error);
    res.status(500).json({ error: 'Failed to get site' });
  }
});

/**
 * POST /api/v1/sites
 * Create a new site
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      role = 'other',
      isPrimary = false,
      address,
      latitude,
      longitude,
      primaryUplinkType,
      backupUplinkType,
      connectsToSiteId,
      metadata,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const newSite: NewSite = {
      id: generateId('site'),
      name,
      description,
      role,
      isPrimary,
      address,
      latitude,
      longitude,
      primaryUplinkType,
      backupUplinkType,
      connectsToSiteId,
      metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(sites).values(newSite);

    res.status(201).json(newSite);
  } catch (error) {
    console.error('[Sites] Error creating site:', error);
    res.status(500).json({ error: 'Failed to create site' });
  }
});

/**
 * PUT /api/v1/sites/:id
 * Update a site
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const updates = {
      ...req.body,
      updatedAt: new Date(),
    };

    // Remove id from updates if present
    delete updates.id;
    delete updates.createdAt;

    const result = await db
      .update(sites)
      .set(updates)
      .where(eq(sites.id, id))
      .returning();

    if (!result.length) {
      return res.status(404).json({ error: 'Site not found' });
    }

    res.json(result[0]);
  } catch (error) {
    console.error('[Sites] Error updating site:', error);
    res.status(500).json({ error: 'Failed to update site' });
  }
});

/**
 * DELETE /api/v1/sites/:id
 * Delete a site (cascades to locations)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const result = await db.delete(sites).where(eq(sites.id, id)).returning();

    if (!result.length) {
      return res.status(404).json({ error: 'Site not found' });
    }

    res.json({ success: true, deleted: result[0] });
  } catch (error) {
    console.error('[Sites] Error deleting site:', error);
    res.status(500).json({ error: 'Failed to delete site' });
  }
});

// ============================================
// LOCATIONS
// ============================================

/**
 * GET /api/v1/sites/:siteId/locations
 * List locations for a site
 */
router.get('/:siteId/locations', async (req: Request, res: Response) => {
  try {
    const siteId = req.params.siteId as string;

    const siteLocations = await db
      .select()
      .from(locations)
      .where(eq(locations.siteId, siteId))
      .orderBy(locations.name);

    res.json(siteLocations);
  } catch (error) {
    console.error('[Sites] Error listing locations:', error);
    res.status(500).json({ error: 'Failed to list locations' });
  }
});

/**
 * POST /api/v1/sites/:siteId/locations
 * Create a location within a site
 */
router.post('/:siteId/locations', async (req: Request, res: Response) => {
  try {
    const siteId = req.params.siteId as string;
    const { name, type = 'other', description, floor, coordinates, metadata } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Verify site exists
    const site = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
    if (!site.length) {
      return res.status(404).json({ error: 'Site not found' });
    }

    const newLocation: NewLocation = {
      id: generateId('loc'),
      siteId,
      name,
      type,
      description,
      floor,
      coordinates,
      metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(locations).values(newLocation);

    res.status(201).json(newLocation);
  } catch (error) {
    console.error('[Sites] Error creating location:', error);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

/**
 * GET /api/v1/locations/:id
 * Get a single location with its devices
 */
router.get('/locations/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const location = await db.select().from(locations).where(eq(locations.id, id)).limit(1);

    if (!location.length) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Get devices in this location
    const locationDevices = await db
      .select()
      .from(devices)
      .where(eq(devices.locationId, id))
      .orderBy(devices.name);

    res.json({
      ...location[0],
      devices: locationDevices,
    });
  } catch (error) {
    console.error('[Sites] Error getting location:', error);
    res.status(500).json({ error: 'Failed to get location' });
  }
});

/**
 * PUT /api/v1/locations/:id
 * Update a location
 */
router.put('/locations/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const updates = {
      ...req.body,
      updatedAt: new Date(),
    };

    delete updates.id;
    delete updates.siteId; // Don't allow moving between sites via this endpoint
    delete updates.createdAt;

    const result = await db
      .update(locations)
      .set(updates)
      .where(eq(locations.id, id))
      .returning();

    if (!result.length) {
      return res.status(404).json({ error: 'Location not found' });
    }

    res.json(result[0]);
  } catch (error) {
    console.error('[Sites] Error updating location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

/**
 * DELETE /api/v1/locations/:id
 * Delete a location
 */
router.delete('/locations/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // First, unassign any devices from this location
    await db
      .update(devices)
      .set({ locationId: null, updatedAt: new Date() })
      .where(eq(devices.locationId, id));

    const result = await db.delete(locations).where(eq(locations.id, id)).returning();

    if (!result.length) {
      return res.status(404).json({ error: 'Location not found' });
    }

    res.json({ success: true, deleted: result[0] });
  } catch (error) {
    console.error('[Sites] Error deleting location:', error);
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

// ============================================
// DEVICE ASSIGNMENT
// ============================================

/**
 * PUT /api/v1/devices/:deviceId/assign
 * Assign a device to a location or vehicle
 */
router.put('/devices/:deviceId/assign', async (req: Request, res: Response) => {
  try {
    const deviceId = req.params.deviceId as string;
    const { locationId, vehicleId } = req.body;

    // Can only assign to one - location OR vehicle
    if (locationId && vehicleId) {
      return res.status(400).json({ error: 'Device can only be assigned to a location OR a vehicle, not both' });
    }

    const updates: { locationId?: string | null; vehicleId?: string | null; updatedAt: Date } = {
      updatedAt: new Date(),
    };

    if (locationId !== undefined) {
      // Verify location exists
      if (locationId) {
        const loc = await db.select().from(locations).where(eq(locations.id, locationId)).limit(1);
        if (!loc.length) {
          return res.status(404).json({ error: 'Location not found' });
        }
      }
      updates.locationId = locationId;
      updates.vehicleId = null; // Clear vehicle if assigning to location
    }

    if (vehicleId !== undefined) {
      // Verify vehicle exists
      if (vehicleId) {
        const veh = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
        if (!veh.length) {
          return res.status(404).json({ error: 'Vehicle not found' });
        }
      }
      updates.vehicleId = vehicleId;
      updates.locationId = null; // Clear location if assigning to vehicle
    }

    const result = await db
      .update(devices)
      .set(updates)
      .where(eq(devices.id, deviceId))
      .returning();

    if (!result.length) {
      return res.status(404).json({ error: 'Device not found' });
    }

    res.json(result[0]);
  } catch (error) {
    console.error('[Sites] Error assigning device:', error);
    res.status(500).json({ error: 'Failed to assign device' });
  }
});

export default router;
