/**
 * Device API Routes
 * CRUD operations for device management
 */

import { Router } from 'express';
import { eq, like, or, and, desc } from 'drizzle-orm';
import { db, devices, deviceNetworkLinks, accessPaths, pathHops, locations, networks, generateId } from '../db/index.js';

const router = Router();
import { sites } from '../db/index.js';

// ============================================
// SPECIFIC ROUTES FIRST (before /:id)
// ============================================

// Get device statistics
router.get('/stats/summary', async (req, res) => {
    try {
        const allDevices = await db.select().from(devices);

        const stats = {
            total: allDevices.length,
            byStatus: {
                online: allDevices.filter(d => d.status === 'online').length,
                offline: allDevices.filter(d => d.status === 'offline').length,
                degraded: allDevices.filter(d => d.status === 'degraded').length,
                unknown: allDevices.filter(d => d.status === 'unknown').length,
            },
            byType: {} as Record<string, number>,
            byPlatform: {} as Record<string, number>,
        };

        allDevices.forEach(d => {
            stats.byType[d.type] = (stats.byType[d.type] || 0) + 1;
            if (d.platformType) {
                stats.byPlatform[d.platformType] = (stats.byPlatform[d.platformType] || 0) + 1;
            }
        });

        res.json(stats);
    } catch (error) {
        console.error('[Devices] Stats error:', error);
        res.status(500).json({ error: 'Failed to get device stats' });
    }
});

// Auto-assign devices to sites based on name patterns
router.post('/auto-assign', async (req, res) => {
    try {
        // Get all sites
        const allSites = await db.select().from(sites);
        
        // Site assignment rules based on device name patterns
        const siteRules: { pattern: RegExp; siteName: string }[] = [
            { pattern: /greenford/i, siteName: 'Greenford' },
            { pattern: /kyle|rise/i, siteName: 'Kyle Rise' },
            { pattern: /carling/i, siteName: 'Carling' },
            { pattern: /radisson/i, siteName: 'Radisson Blu' },
            { pattern: /noc|processing|pu2/i, siteName: 'Processing Unit Two (NOC)' },
            { pattern: /farm|wisp/i, siteName: 'Kyle Rise' },
        ];
        
        // Get unassigned site
        const unassignedSite = allSites.find(s => s.name.toLowerCase() === 'unassigned');
        
        // Create default locations for each site if they don't exist
        const siteLocations: Record<string, string> = {};
        
        for (const site of allSites) {
            const existingLocations = await db.select().from(locations)
                .where(eq(locations.siteId, site.id))
                .limit(1);
            
            if (existingLocations.length > 0) {
                siteLocations[site.id] = existingLocations[0].id;
            } else {
                const locId = generateId('loc');
                const now = new Date();
                await db.insert(locations).values({
                    id: locId,
                    siteId: site.id,
                    name: 'Default',
                    type: 'other',
                    description: `Default location for ${site.name}`,
                    createdAt: now,
                    updatedAt: now,
                });
                siteLocations[site.id] = locId;
            }
        }
        
        // Get all devices
        const allDevices = await db.select().from(devices);
        
        const results = {
            processed: 0,
            assigned: 0,
            unchanged: 0,
            assignments: [] as { deviceName: string; siteName: string }[],
        };
        
        for (const device of allDevices) {
            results.processed++;
            
            // Skip if already assigned
            if (device.locationId) {
                results.unchanged++;
                continue;
            }
            
            // Find matching site based on device name
            let targetSiteId: string | null = null;
            let targetSiteName = '';
            
            for (const rule of siteRules) {
                if (rule.pattern.test(device.name)) {
                    const site = allSites.find(s => s.name === rule.siteName);
                    if (site) {
                        targetSiteId = site.id;
                        targetSiteName = site.name;
                        break;
                    }
                }
            }
            
            // If no match, assign to Unassigned site
            if (!targetSiteId && unassignedSite) {
                targetSiteId = unassignedSite.id;
                targetSiteName = 'Unassigned';
            }
            
            // Assign device to the location
            if (targetSiteId && siteLocations[targetSiteId]) {
                await db.update(devices)
                    .set({ 
                        locationId: siteLocations[targetSiteId],
                        updatedAt: new Date()
                    })
                    .where(eq(devices.id, device.id));
                
                results.assigned++;
                results.assignments.push({
                    deviceName: device.name,
                    siteName: targetSiteName,
                });
            }
        }
        
        res.json(results);
    } catch (error) {
        console.error('[Devices] Auto-assign error:', error);
        res.status(500).json({ error: 'Failed to auto-assign devices' });
    }
});

// Get topology data for network visualization
router.get('/topology', async (req, res) => {
    try {
        // Get all devices with status
        const allDevices = await db.select().from(devices);
        
        // Get all sites for site-level nodes
        const allSites = await db.select().from(sites);
        
        // Build topology nodes from real devices
        const nodes: any[] = [];
        const links: any[] = [];
        
        // Add Skynet node (NOC/core)
        nodes.push({
            id: 'skynet',
            name: 'Skynet AI (NOC)',
            type: 'skynet',
            status: 'online',
            ip: '192.168.195.33',
            layer: 0,
            vendor: 'Custom',
        });
        
        // Add ZeroTier gateway
        nodes.push({
            id: 'zerotier-gw',
            name: 'ZeroTier Gateway',
            type: 'gateway',
            status: 'online',
            ip: '192.168.195.1',
            layer: 1,
            vendor: 'ZeroTier',
        });
        
        // Link Skynet to ZeroTier
        links.push({
            source: 'skynet',
            target: 'zerotier-gw',
            type: 'vpn',
            status: 'active',
        });
        
        // Group devices by site
        const devicesBySite: Record<string, typeof allDevices> = {};
        
        for (const device of allDevices) {
            let siteKey = 'unassigned';
            
            if (device.locationId) {
                const loc = await db.select().from(locations).where(eq(locations.id, device.locationId)).limit(1);
                if (loc[0]) {
                    const site = allSites.find(s => s.id === loc[0].siteId);
                    if (site) siteKey = site.id;
                }
            } else {
                if (/greenford/i.test(device.name)) siteKey = allSites.find(s => /greenford/i.test(s.name))?.id || 'unassigned';
                else if (/kyle|rise/i.test(device.name)) siteKey = allSites.find(s => /kyle/i.test(s.name))?.id || 'unassigned';
                else if (/carling/i.test(device.name)) siteKey = allSites.find(s => /carling/i.test(s.name))?.id || 'unassigned';
            }
            
            if (!devicesBySite[siteKey]) devicesBySite[siteKey] = [];
            devicesBySite[siteKey].push(device);
        }
        
        // Create site gateway nodes and device nodes
        let layerCounter = 2;
        
        for (const [siteId, siteDevices] of Object.entries(devicesBySite)) {
            const site = allSites.find(s => s.id === siteId);
            if (!site) continue;
            
            const siteGatewayId = `site-gw-${siteId}`;
            nodes.push({
                id: siteGatewayId,
                name: `${site.name} Gateway`,
                type: 'gateway',
                status: siteDevices.some(d => d.status === 'online') ? 'online' : 'offline',
                layer: layerCounter,
                vendor: 'Site',
            });
            
            links.push({
                source: 'zerotier-gw',
                target: siteGatewayId,
                type: 'vpn',
                status: 'active',
            });
            
            const deviceLimit = 10;
            for (const device of siteDevices.slice(0, deviceLimit)) {
                const nodeType = (() => {
                    switch (device.type) {
                        case 'router': return 'router';
                        case 'switch': return 'switch';
                        case 'access_point': return 'access_point';
                        case 'gateway': return 'gateway';
                        case 'server': return 'server';
                        case 'camera': return 'camera';
                        case 'workstation': return 'workstation';
                        case 'iot': return 'iot';
                        default: return 'unknown';
                    }
                })();
                
                nodes.push({
                    id: device.id,
                    name: device.name,
                    type: nodeType,
                    status: device.status || 'unknown',
                    ip: device.primaryIp,
                    mac: device.primaryMac,
                    vendor: device.manufacturer,
                    layer: layerCounter + 1,
                });
                
                links.push({
                    source: siteGatewayId,
                    target: device.id,
                    type: device.platformType === 'zerotier' ? 'vpn' : 'wired',
                    status: device.status === 'online' ? 'active' : 'down',
                });
            }
            
            layerCounter++;
        }
        
        res.json({ nodes, links });
    } catch (error) {
        console.error('[Devices] Topology error:', error);
        res.status(500).json({ error: 'Failed to get topology data' });
    }
});

// ============================================
// GENERAL ROUTES
// ============================================

// List devices with filtering and search
router.get('/', async (req, res) => {
    try {
        const { search, status, type, locationId, platformType, limit = '50', offset = '0' } = req.query;

        let query = db.select().from(devices);
        const conditions: any[] = [];

        if (search) {
            conditions.push(
                or(
                    like(devices.name, `%${search}%`),
                    like(devices.hostname, `%${search}%`),
                    like(devices.primaryIp, `%${search}%`)
                )
            );
        }

        if (status) {
            conditions.push(eq(devices.status, status as any));
        }

        if (type) {
            conditions.push(eq(devices.type, type as any));
        }

        if (locationId) {
            conditions.push(eq(devices.locationId, locationId as string));
        }

        if (platformType) {
            conditions.push(eq(devices.platformType, platformType as any));
        }

        const result = await db.select()
            .from(devices)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(devices.updatedAt))
            .limit(parseInt(limit as string))
            .offset(parseInt(offset as string));

        // Get count for pagination
        const countResult = await db.select().from(devices)
            .where(conditions.length > 0 ? and(...conditions) : undefined);

        res.json({
            devices: result,
            total: countResult.length,
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
        });
    } catch (error) {
        console.error('[Devices] List error:', error);
        res.status(500).json({ error: 'Failed to list devices' });
    }
});

// Get device by ID with full details
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const device = await db.select().from(devices).where(eq(devices.id, id)).limit(1);

        if (device.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        // Get network links
        const networkLinks = await db.select({
            link: deviceNetworkLinks,
            network: networks,
        })
            .from(deviceNetworkLinks)
            .leftJoin(networks, eq(deviceNetworkLinks.networkId, networks.id))
            .where(eq(deviceNetworkLinks.deviceId, id));

        // Get access paths
        const paths = await db.select().from(accessPaths)
            .where(eq(accessPaths.targetDeviceId, id));

        // Get hops for each path
        const pathsWithHops = await Promise.all(paths.map(async (path) => {
            const hops = await db.select().from(pathHops)
                .where(eq(pathHops.pathId, path.id))
                .orderBy(pathHops.order);
            return { ...path, hops };
        }));

        // Get location details if exists
        let location = null;
        if (device[0].locationId) {
            const loc = await db.select().from(locations)
                .where(eq(locations.id, device[0].locationId)).limit(1);
            location = loc[0] || null;
        }

        res.json({
            ...device[0],
            networkLinks: networkLinks.map(nl => ({
                ...nl.link,
                network: nl.network,
            })),
            accessPaths: pathsWithHops,
            location,
        });
    } catch (error) {
        console.error('[Devices] Get error:', error);
        res.status(500).json({ error: 'Failed to get device' });
    }
});

// Create device
router.post('/', async (req, res) => {
    try {
        const {
            name, type, manufacturer, model, serialNumber, firmwareVersion,
            locationId, vehicleId, primaryIp, primaryMac, hostname,
            managementUrl, sshPort, httpPort, platformType, platformDeviceId,
            notes, tags, metadata, status = 'unknown'
        } = req.body;

        if (!name || !type) {
            return res.status(400).json({ error: 'Name and type are required' });
        }

        const id = generateId('dev');
        const now = new Date();

        await db.insert(devices).values({
            id,
            name,
            type,
            manufacturer,
            model,
            serialNumber,
            firmwareVersion,
            locationId,
            vehicleId,
            primaryIp,
            primaryMac,
            hostname,
            managementUrl,
            sshPort,
            httpPort,
            platformType,
            platformDeviceId,
            notes,
            tags,
            metadata,
            status,
            createdAt: now,
            updatedAt: now,
        });

        const created = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
        res.status(201).json(created[0]);
    } catch (error) {
        console.error('[Devices] Create error:', error);
        res.status(500).json({ error: 'Failed to create device' });
    }
});

// Update device
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Remove fields that shouldn't be updated directly
        delete updates.id;
        delete updates.createdAt;
        updates.updatedAt = new Date();

        await db.update(devices).set(updates).where(eq(devices.id, id));

        const updated = await db.select().from(devices).where(eq(devices.id, id)).limit(1);

        if (updated.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        res.json(updated[0]);
    } catch (error) {
        console.error('[Devices] Update error:', error);
        res.status(500).json({ error: 'Failed to update device' });
    }
});

// Delete device
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const device = await db.select().from(devices).where(eq(devices.id, id)).limit(1);

        if (device.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        await db.delete(devices).where(eq(devices.id, id));
        res.json({ success: true, deleted: device[0] });
    } catch (error) {
        console.error('[Devices] Delete error:', error);
        res.status(500).json({ error: 'Failed to delete device' });
    }
});

// Bulk import devices
router.post('/bulk-import', async (req, res) => {
    try {
        const { devices: deviceList, source = 'manual' } = req.body;

        if (!Array.isArray(deviceList) || deviceList.length === 0) {
            return res.status(400).json({ error: 'devices array is required' });
        }

        const results = {
            created: 0,
            updated: 0,
            failed: 0,
            errors: [] as string[],
        };

        for (const device of deviceList) {
            try {
                const { name, type } = device;

                if (!name || !type) {
                    results.failed++;
                    results.errors.push(`Missing name or type for device`);
                    continue;
                }

                // Check if device exists (by platformDeviceId or name+type)
                let existing = null;
                if (device.platformDeviceId) {
                    const found = await db.select().from(devices)
                        .where(eq(devices.platformDeviceId, device.platformDeviceId))
                        .limit(1);
                    existing = found[0];
                }

                if (!existing && device.primaryMac) {
                    const found = await db.select().from(devices)
                        .where(eq(devices.primaryMac, device.primaryMac))
                        .limit(1);
                    existing = found[0];
                }

                if (existing) {
                    // Update existing
                    delete device.id;
                    delete device.createdAt;
                    device.updatedAt = new Date();
                    await db.update(devices).set(device).where(eq(devices.id, existing.id));
                    results.updated++;
                } else {
                    // Create new
                    const id = generateId('dev');
                    const now = new Date();
                    await db.insert(devices).values({
                        ...device,
                        id,
                        platformType: device.platformType || source,
                        createdAt: now,
                        updatedAt: now,
                    });
                    results.created++;
                }
            } catch (err) {
                results.failed++;
                results.errors.push(`Error processing device ${device.name}: ${err}`);
            }
        }

        res.json(results);
    } catch (error) {
        console.error('[Devices] Bulk import error:', error);
        res.status(500).json({ error: 'Failed to bulk import devices' });
    }
});

// Add network link to device
router.post('/:id/network-links', async (req, res) => {
    try {
        const { id: deviceId } = req.params;
        const { networkId, ipAddress, macAddress, interfaceName, isManagementInterface } = req.body;

        if (!networkId) {
            return res.status(400).json({ error: 'networkId is required' });
        }

        const id = generateId('dnl');
        const now = new Date();

        await db.insert(deviceNetworkLinks).values({
            id,
            deviceId,
            networkId,
            ipAddress,
            macAddress,
            interfaceName,
            isManagementInterface: isManagementInterface || false,
            status: 'active',
            createdAt: now,
            updatedAt: now,
        });

        const created = await db.select().from(deviceNetworkLinks).where(eq(deviceNetworkLinks.id, id)).limit(1);
        res.status(201).json(created[0]);
    } catch (error) {
        console.error('[Devices] Add network link error:', error);
        res.status(500).json({ error: 'Failed to add network link' });
    }
});

export default router;
