/**
 * NetOps - Network Operations Management Platform
 * 
 * Main entry point for the REST API server
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { eq } from 'drizzle-orm';
import { initializeDatabase, db, devices, networks, topologies, sites, locations } from './db/index.js';
import { createConnectors, getConnectorConfigFromEnv } from './connectors/index.js';
import sitesRouter from './routes/sites.js';
import syncRoutes from './routes/sync.js';
import servicesRouter from './routes/services.js';
import mcpToolsRouter from './routes/mcp-tools.js';
import devicesRouter from './routes/devices.js';
import { syncService } from './services/sync-service.js';
import { startServiceDiscovery, stopServiceDiscovery, getServiceSummary, getServices } from './services/service-discovery.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3850', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/v1/sites', sitesRouter);
app.use('/api/v1/devices', devicesRouter);
app.use('/api/v1/sync', syncRoutes);
app.use('/api/v1/services', servicesRouter);
app.use('/api/v1/tools', mcpToolsRouter);

// API status
app.get('/api/v1/status', (req, res) => {
    const syncStatuses = syncService.getAllStatuses();
    const config = syncService.getConfig();
    const serviceSummary = getServiceSummary();
    
    res.json({
        name: 'NetOps',
        version: '0.3.0',
        description: 'Network Operations Management Platform',
        sync: {
            enabled: config.enabled,
            intervalMinutes: Math.round(config.intervalMs / 60000),
            platforms: syncStatuses.map(s => ({
                platform: s.platform,
                status: s.status,
                lastSync: s.lastSync?.toISOString() || null,
            })),
        },
        services: {
            total: serviceSummary.total,
            online: serviceSummary.online,
            offline: serviceSummary.offline,
            lastScan: serviceSummary.lastScan?.toISOString() || null,
        },
        endpoints: {
            mcp: 'Run with: npm run dev:mcp',
            api: `http://${HOST}:${PORT}/api/v1`,
            sites: `http://${HOST}:${PORT}/api/v1/sites`,
            sync: `http://${HOST}:${PORT}/api/v1/sync/status`,
            services: `http://${HOST}:${PORT}/api/v1/services`,
            servicesGrid: `http://${HOST}:${PORT}/api/v1/services/grid`,
            dashboard: `http://${HOST}:${PORT}/api/v1/dashboard`,
        },
    });
});

// Device routes - handled by devicesRouter (includes /topology, /stats, etc.)

// Network routes
app.get('/api/v1/networks', async (req, res) => {
    try {
        const allNetworks = await db.select().from(networks);
        res.json({ count: allNetworks.length, networks: allNetworks });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get networks' });
    }
});

// Topology routes
app.get('/api/v1/topologies', async (req, res) => {
    try {
        const allTopologies = await db.select().from(topologies);
        res.json({ count: allTopologies.length, topologies: allTopologies });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get topologies' });
    }
});

// Dashboard summary - THE KEY ENDPOINT FOR UI
app.get('/api/v1/dashboard', async (req, res) => {
    try {
        const allDevices = await db.select().from(devices);
        const allNetworks = await db.select().from(networks);
        const allTopologies = await db.select().from(topologies);
        const allSites = await db.select().from(sites);
        const syncStatuses = syncService.getAllStatuses();
        const config = syncService.getConfig();
        const serviceSummary = getServiceSummary();
        const allServices = getServices();

        const online = allDevices.filter(d => d.status === 'online').length;
        const offline = allDevices.filter(d => d.status === 'offline').length;
        const unknown = allDevices.filter(d => d.status === 'unknown').length;

        // Sort services by status for grid display
        const statusOrder: Record<string, number> = { online: 0, degraded: 1, unknown: 2, offline: 3 };
        const sortedServices = allServices
            .sort((a, b) => {
                const statusDiff = statusOrder[a.status] - statusOrder[b.status];
                return statusDiff !== 0 ? statusDiff : a.name.localeCompare(b.name);
            })
            .slice(0, 25); // Top 25 for dashboard

        res.json({
            summary: {
                totalDevices: allDevices.length,
                onlineDevices: online,
                offlineDevices: offline,
                unknownDevices: unknown,
                totalNetworks: allNetworks.length,
                totalTopologies: allTopologies.length,
                totalSites: allSites.length,
                totalServices: serviceSummary.total,
                servicesOnline: serviceSummary.online,
                servicesOffline: serviceSummary.offline,
            },
            services: {
                summary: {
                    total: serviceSummary.total,
                    online: serviceSummary.online,
                    offline: serviceSummary.offline,
                    degraded: serviceSummary.degraded,
                    lastScan: serviceSummary.lastScan?.toISOString() || null,
                },
                grid: sortedServices.map(s => ({
                    id: s.id,
                    name: s.name,
                    port: s.port,
                    type: s.type,
                    status: s.status,
                    pm2Status: s.pm2Status,
                    responseTimeMs: s.responseTimeMs,
                    memory: s.memory ? Math.round(s.memory / 1024 / 1024) : null,
                    cpu: s.cpu,
                    restarts: s.restarts,
                    url: s.port ? `http://localhost:${s.port}` : null,
                    lastCheck: s.lastCheck?.toISOString() || null,
                })),
            },
            sync: {
                enabled: config.enabled,
                intervalMinutes: Math.round(config.intervalMs / 60000),
                platforms: syncStatuses.map(s => ({
                    platform: s.platform,
                    type: s.platform.toLowerCase(),
                    status: s.status,
                    lastSync: s.lastSync?.toISOString() || null,
                    nextSync: s.nextSync?.toISOString() || null,
                    lastResult: s.lastResult ? {
                        success: s.lastResult.success,
                        devicesFound: s.lastResult.devicesFound,
                        devicesCreated: s.lastResult.devicesCreated,
                        devicesUpdated: s.lastResult.devicesUpdated,
                        networksFound: s.lastResult.networksFound,
                        errors: s.lastResult.errors.length,
                    } : null,
                    error: s.error,
                })),
            },
            byPlatform: {
                uisp: allDevices.filter(d => d.platformType === 'uisp').length,
                unifi: allDevices.filter(d => d.platformType === 'unifi').length,
                manual: allDevices.filter(d => d.platformType === 'manual').length,
                other: allDevices.filter(d => !['uisp', 'unifi', 'manual'].includes(d.platformType || '')).length,
            },
            recentDevices: allDevices
                .sort((a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0))
                .slice(0, 10)
                .map(d => ({
                    id: d.id,
                    name: d.name,
                    type: d.type,
                    status: d.status,
                    platform: d.platformType,
                    ip: d.primaryIp,
                    mac: d.primaryMac,
                    model: d.model,
                    lastSeen: d.lastSeen?.toISOString(),
                    updatedAt: d.updatedAt?.toISOString(),
                })),
        });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get dashboard data' });
    }
});

// Initialize and start
async function main() {
    console.log('[NetOps] Initializing...');

    // Initialize database
    await initializeDatabase();

    // Load connector configuration
    const connectorConfig = getConnectorConfigFromEnv();
    const connectors = createConnectors(connectorConfig);

    console.log(`[NetOps] Loaded ${connectors.length} platform connector(s)`);

    // Check if auto-sync is enabled via environment
    const autoSync = process.env.NETOPS_AUTO_SYNC !== 'false';
    const syncInterval = parseInt(process.env.NETOPS_SYNC_INTERVAL_MINUTES || '5', 10);

    if (autoSync) {
        // Configure sync interval
        syncService.setConfig({
            enabled: true,
            intervalMs: syncInterval * 60 * 1000,
        });

        // Start sync timers
        console.log(`[NetOps] Starting auto-sync (interval: ${syncInterval} minutes)`);
        syncService.startAllSyncTimers();
    } else {
        console.log('[NetOps] Auto-sync disabled. Use POST /api/v1/sync/start to enable.');
    }

    // Start service discovery
    const serviceDiscoveryEnabled = process.env.NETOPS_SERVICE_DISCOVERY !== 'false';
    if (serviceDiscoveryEnabled) {
        console.log('[NetOps] Starting service discovery...');
        await startServiceDiscovery();
    } else {
        console.log('[NetOps] Service discovery disabled.');
    }

    // Start server
    app.listen(PORT, HOST, () => {
        console.log(`[NetOps] ✓ API server running at http://${HOST}:${PORT}`);
        console.log(`[NetOps] ✓ Dashboard: http://${HOST}:${PORT}/api/v1/dashboard`);
        console.log(`[NetOps] ✓ Sync Status: http://${HOST}:${PORT}/api/v1/sync/status`);
        console.log(`[NetOps] ✓ Services: http://${HOST}:${PORT}/api/v1/services`);
        console.log(`[NetOps] ✓ Services Grid: http://${HOST}:${PORT}/api/v1/services/grid`);
        console.log(`[NetOps] ✓ Devices: http://${HOST}:${PORT}/api/v1/devices`);
        console.log('[NetOps] MCP server: npm run dev:mcp');
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('[NetOps] Shutting down...');
        stopServiceDiscovery();
        process.exit(0);
    });
}

main().catch(console.error);
