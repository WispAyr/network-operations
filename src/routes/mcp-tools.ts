/**
 * MCP Tools HTTP API
 * 
 * Exposes MCP tool functionality via HTTP REST endpoints
 * for AI agent integration (Clawdbot, etc.)
 */

import { Router, Request, Response } from 'express';
import { db, generateId } from '../db/index.js';
import { sites, locations, devices, networks, topologies, accessPaths, pathHops, vehicles, deviceNetworkLinks, deployments } from '../db/schema.js';
import { eq, like, and, ne, desc } from 'drizzle-orm';

const router = Router();

// ============================================
// SITE MANAGEMENT TOOLS
// ============================================

/**
 * POST /api/v1/tools/list_sites
 * List all sites with their locations and device counts
 */
router.post('/list_sites', async (req: Request, res: Response) => {
    try {
        const { search } = req.body;
        let query = db.select().from(sites);

        if (search) {
            query = query.where(like(sites.name, `%${search}%`)) as typeof query;
        }

        const result = await query;

        // Get location and device counts for each site
        const sitesWithDetails = await Promise.all(
            result.map(async (site) => {
                const siteLocations = await db.select().from(locations).where(eq(locations.siteId, site.id));
                const locationIds = siteLocations.map(l => l.id);

                let deviceCount = 0;
                for (const locId of locationIds) {
                    const devicesInLoc = await db.select().from(devices).where(eq(devices.locationId, locId));
                    deviceCount += devicesInLoc.length;
                }

                return {
                    ...site,
                    locationCount: siteLocations.length,
                    deviceCount,
                };
            })
        );

        res.json({ success: true, sites: sitesWithDetails });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list sites' });
    }
});

/**
 * POST /api/v1/tools/create_site
 * Create a new site
 */
router.post('/create_site', async (req: Request, res: Response) => {
    try {
        const { name, description, address, latitude, longitude } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const newSite = {
            id: generateId(),
            name,
            description: description || null,
            address: address || null,
            latitude: latitude || null,
            longitude: longitude || null,
            metadata: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await db.insert(sites).values(newSite);
        res.json({ success: true, site: newSite });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create site' });
    }
});

// ============================================
// DEVICE MANAGEMENT TOOLS
// ============================================

/**
 * POST /api/v1/tools/list_devices
 * List devices with optional filters
 */
router.post('/list_devices', async (req: Request, res: Response) => {
    try {
        const { siteId, locationId, status, type, search, platform, limit = 100 } = req.body;

        let allDevices = await db.select().from(devices);

        // Apply filters
        if (locationId) {
            allDevices = allDevices.filter(d => d.locationId === locationId);
        }

        if (siteId) {
            const siteLocations = await db.select().from(locations).where(eq(locations.siteId, siteId));
            const locationIds = siteLocations.map(l => l.id);
            allDevices = allDevices.filter(d => d.locationId && locationIds.includes(d.locationId));
        }

        if (status) {
            allDevices = allDevices.filter(d => d.status === status);
        }

        if (type) {
            allDevices = allDevices.filter(d => d.type === type);
        }

        if (platform) {
            allDevices = allDevices.filter(d => d.platformType === platform);
        }

        if (search) {
            const searchLower = search.toLowerCase();
            allDevices = allDevices.filter(d =>
                d.name.toLowerCase().includes(searchLower) ||
                d.primaryIp?.toLowerCase().includes(searchLower) ||
                d.hostname?.toLowerCase().includes(searchLower)
            );
        }

        // Apply limit
        const limited = allDevices.slice(0, limit);

        res.json({ 
            success: true, 
            count: allDevices.length,
            returned: limited.length,
            devices: limited 
        });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list devices' });
    }
});

/**
 * POST /api/v1/tools/get_device
 * Get detailed information about a specific device
 */
router.post('/get_device', async (req: Request, res: Response) => {
    try {
        const { deviceId, name, ip, mac } = req.body;

        let device;
        if (deviceId) {
            const result = await db.select().from(devices).where(eq(devices.id, deviceId));
            device = result[0];
        } else if (name) {
            const result = await db.select().from(devices).where(like(devices.name, `%${name}%`));
            device = result[0];
        } else if (ip) {
            const result = await db.select().from(devices).where(like(devices.primaryIp, `%${ip}%`));
            device = result[0];
        } else if (mac) {
            const result = await db.select().from(devices).where(eq(devices.primaryMac, mac.toLowerCase()));
            device = result[0];
        } else {
            return res.status(400).json({ error: 'Provide deviceId, name, ip, or mac' });
        }

        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        // Get network connections
        const networkLinks = await db.select().from(deviceNetworkLinks).where(eq(deviceNetworkLinks.deviceId, device.id));

        // Get networks for each link
        const networksWithLinks = await Promise.all(
            networkLinks.map(async (link) => {
                const network = await db.select().from(networks).where(eq(networks.id, link.networkId));
                return {
                    ...link,
                    network: network[0] || null,
                };
            })
        );

        // Get access paths
        const paths = await db.select().from(accessPaths).where(eq(accessPaths.targetDeviceId, device.id));

        // Get hops for each path
        const pathsWithHops = await Promise.all(
            paths.map(async (path) => {
                const hops = await db.select().from(pathHops).where(eq(pathHops.pathId, path.id));
                return {
                    ...path,
                    hops: hops.sort((a, b) => a.order - b.order),
                };
            })
        );

        res.json({
            success: true,
            device,
            networks: networksWithLinks,
            accessPaths: pathsWithHops,
        });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get device' });
    }
});

// ============================================
// NETWORK MANAGEMENT TOOLS
// ============================================

/**
 * POST /api/v1/tools/list_networks
 * List all networks, optionally filtered
 */
router.post('/list_networks', async (req: Request, res: Response) => {
    try {
        const { topologyType, name, cidr } = req.body;

        let allNetworks = await db.select({
            network: networks,
            topology: topologies,
        }).from(networks).leftJoin(topologies, eq(networks.topologyId, topologies.id));

        if (topologyType) {
            allNetworks = allNetworks.filter(n => n.topology?.type === topologyType);
        }

        if (name) {
            const nameLower = name.toLowerCase();
            allNetworks = allNetworks.filter(n => n.network.name.toLowerCase().includes(nameLower));
        }

        if (cidr) {
            allNetworks = allNetworks.filter(n => n.network.cidr?.includes(cidr));
        }

        res.json({ 
            success: true, 
            count: allNetworks.length,
            networks: allNetworks.map(n => ({
                ...n.network,
                topologyName: n.topology?.name,
                topologyType: n.topology?.type,
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list networks' });
    }
});

/**
 * POST /api/v1/tools/get_zerotier_info
 * Get ZeroTier specific network information
 */
router.post('/get_zerotier_info', async (req: Request, res: Response) => {
    try {
        const { networkId, networkName } = req.body;

        // Get ZeroTier topology
        const ztTopology = await db.select().from(topologies).where(eq(topologies.type, 'zerotier'));
        
        if (ztTopology.length === 0) {
            return res.json({ success: true, message: 'No ZeroTier topology found', networks: [], devices: [] });
        }

        // Get ZeroTier networks
        let ztNetworks = await db.select().from(networks).where(eq(networks.topologyId, ztTopology[0].id));

        if (networkId) {
            ztNetworks = ztNetworks.filter(n => n.platformNetworkId === networkId || n.id === networkId);
        }

        if (networkName) {
            const nameLower = networkName.toLowerCase();
            ztNetworks = ztNetworks.filter(n => n.name.toLowerCase().includes(nameLower));
        }

        // Get devices on ZeroTier (platformType might vary)
        const allDevices = await db.select().from(devices);
        const ztDevices = allDevices.filter(d => 
            d.platformType === 'zerotier' || 
            d.notes?.includes('zerotier') ||
            d.primaryIp?.startsWith('10.147') ||
            d.primaryIp?.startsWith('192.168.195') ||
            d.primaryIp?.startsWith('10.242') ||
            d.primaryIp?.startsWith('172.25') ||
            d.primaryIp?.startsWith('10.244')
        );

        res.json({
            success: true,
            topology: ztTopology[0],
            networks: ztNetworks,
            devices: ztDevices,
            summary: {
                totalNetworks: ztNetworks.length,
                totalDevices: ztDevices.length,
                onlineDevices: ztDevices.filter(d => d.status === 'online').length,
            }
        });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get ZeroTier info' });
    }
});

// ============================================
// ACCESS PATH TOOLS
// ============================================

/**
 * POST /api/v1/tools/get_access_path
 * Get the access path(s) to reach a device
 */
router.post('/get_access_path', async (req: Request, res: Response) => {
    try {
        const { deviceId, deviceName } = req.body;

        let targetDeviceId = deviceId;
        if (!targetDeviceId && deviceName) {
            const result = await db.select().from(devices).where(like(devices.name, `%${deviceName}%`));
            if (result.length > 0) {
                targetDeviceId = result[0].id;
            }
        }

        if (!targetDeviceId) {
            return res.status(400).json({ error: 'Provide deviceId or deviceName' });
        }

        const paths = await db.select().from(accessPaths).where(eq(accessPaths.targetDeviceId, targetDeviceId));

        const pathsWithHops = await Promise.all(
            paths.map(async (path) => {
                const hops = await db.select().from(pathHops).where(eq(pathHops.pathId, path.id));

                // Get device info for each hop that has a host device
                const hopsWithDevices = await Promise.all(
                    hops.sort((a, b) => a.order - b.order).map(async (hop) => {
                        let hostDevice = null;
                        if (hop.hostDeviceId) {
                            const dev = await db.select().from(devices).where(eq(devices.id, hop.hostDeviceId));
                            hostDevice = dev[0] || null;
                        }
                        return { ...hop, hostDevice };
                    })
                );

                return {
                    ...path,
                    hops: hopsWithDevices,
                };
            })
        );

        // Get target device info
        const targetDevice = await db.select().from(devices).where(eq(devices.id, targetDeviceId));

        res.json({
            success: true,
            targetDevice: targetDevice[0] || null,
            accessPaths: pathsWithHops,
        });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get access path' });
    }
});

// ============================================
// OVERVIEW TOOLS
// ============================================

/**
 * POST /api/v1/tools/get_network_overview
 * Get a high-level overview of the entire network infrastructure
 */
router.post('/get_network_overview', async (req: Request, res: Response) => {
    try {
        const allSites = await db.select().from(sites);
        const allLocations = await db.select().from(locations);
        const allDevices = await db.select().from(devices);
        const allNetworks = await db.select().from(networks);
        const allTopologies = await db.select().from(topologies);
        const allVehicles = await db.select().from(vehicles);
        const allPaths = await db.select().from(accessPaths);

        const devicesByStatus = {
            online: allDevices.filter(d => d.status === 'online').length,
            offline: allDevices.filter(d => d.status === 'offline').length,
            degraded: allDevices.filter(d => d.status === 'degraded').length,
            unknown: allDevices.filter(d => d.status === 'unknown').length,
        };

        const devicesByPlatform = {
            uisp: allDevices.filter(d => d.platformType === 'uisp').length,
            unifi: allDevices.filter(d => d.platformType === 'unifi').length,
            zerotier: allDevices.filter(d => d.platformType === 'zerotier').length,
            manual: allDevices.filter(d => d.platformType === 'manual').length,
            other: allDevices.filter(d => !['uisp', 'unifi', 'zerotier', 'manual'].includes(d.platformType || '')).length,
        };

        const topologyBreakdown = allTopologies.map(t => ({
            id: t.id,
            name: t.name,
            type: t.type,
            networkCount: allNetworks.filter(n => n.topologyId === t.id).length,
        }));

        res.json({
            success: true,
            summary: {
                sites: allSites.length,
                locations: allLocations.length,
                vehicles: allVehicles.length,
                devices: allDevices.length,
                networks: allNetworks.length,
                topologies: allTopologies.length,
                accessPaths: allPaths.length,
            },
            devicesByStatus,
            devicesByPlatform,
            topologyBreakdown,
            sites: allSites.map(s => ({
                id: s.id,
                name: s.name,
                locationCount: allLocations.filter(l => l.siteId === s.id).length,
            })),
        });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get network overview' });
    }
});

/**
 * POST /api/v1/tools/check_service_health
 * Check health of network services and platforms
 */
router.post('/check_service_health', async (req: Request, res: Response) => {
    try {
        // Get device status counts
        const allDevices = await db.select().from(devices);
        const online = allDevices.filter(d => d.status === 'online').length;
        const total = allDevices.length;
        
        // Calculate health score
        const healthScore = total > 0 ? Math.round((online / total) * 100) : 0;
        
        // Get platform status
        const platforms = {
            uisp: { 
                devices: allDevices.filter(d => d.platformType === 'uisp').length,
                online: allDevices.filter(d => d.platformType === 'uisp' && d.status === 'online').length,
            },
            zerotier: { 
                devices: allDevices.filter(d => d.platformType === 'zerotier' || d.primaryIp?.startsWith('192.168.195')).length,
                online: allDevices.filter(d => (d.platformType === 'zerotier' || d.primaryIp?.startsWith('192.168.195')) && d.status === 'online').length,
            },
            unifi: { 
                devices: allDevices.filter(d => d.platformType === 'unifi').length,
                online: allDevices.filter(d => d.platformType === 'unifi' && d.status === 'online').length,
            },
        };

        // Get networks status
        const allNetworks = await db.select().from(networks);
        const activeNetworks = allNetworks.filter(n => n.status === 'active').length;

        res.json({
            success: true,
            health: {
                score: healthScore,
                status: healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'degraded' : 'critical',
            },
            devices: {
                total,
                online,
                offline: allDevices.filter(d => d.status === 'offline').length,
            },
            networks: {
                total: allNetworks.length,
                active: activeNetworks,
            },
            platforms,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to check service health' });
    }
});

export default router;
