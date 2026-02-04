/**
 * Sync API Routes
 * 
 * Endpoints for managing platform sync operations
 */

import { Router, Request, Response } from 'express';
import { syncService, type SyncConfig } from '../services/sync-service.js';

const router = Router();

/**
 * GET /api/v1/sync/status
 * Get sync status for all platforms
 */
router.get('/status', (req: Request, res: Response) => {
    const statuses = syncService.getAllStatuses();
    const config = syncService.getConfig();
    
    res.json({
        enabled: config.enabled,
        intervalMs: config.intervalMs,
        intervalHuman: `${Math.round(config.intervalMs / 1000 / 60)} minutes`,
        platforms: statuses.map(s => ({
            ...s,
            lastSync: s.lastSync?.toISOString() || null,
            nextSync: s.nextSync?.toISOString() || null,
        })),
    });
});

/**
 * GET /api/v1/sync/config
 * Get current sync configuration
 */
router.get('/config', (req: Request, res: Response) => {
    res.json(syncService.getConfig());
});

/**
 * PATCH /api/v1/sync/config
 * Update sync configuration
 */
router.patch('/config', (req: Request, res: Response) => {
    try {
        const updates: Partial<SyncConfig> = {};

        if (req.body.enabled !== undefined) {
            updates.enabled = Boolean(req.body.enabled);
        }

        if (req.body.intervalMs !== undefined) {
            const interval = parseInt(req.body.intervalMs, 10);
            if (interval < 30000) { // Minimum 30 seconds
                return res.status(400).json({ error: 'Interval must be at least 30000ms (30 seconds)' });
            }
            updates.intervalMs = interval;
        }

        // Also accept intervalMinutes for convenience
        if (req.body.intervalMinutes !== undefined) {
            const minutes = parseInt(req.body.intervalMinutes, 10);
            if (minutes < 1) {
                return res.status(400).json({ error: 'Interval must be at least 1 minute' });
            }
            updates.intervalMs = minutes * 60 * 1000;
        }

        if (req.body.platforms !== undefined) {
            updates.platforms = {
                uisp: req.body.platforms.uisp ?? syncService.getConfig().platforms.uisp,
                unifi: req.body.platforms.unifi ?? syncService.getConfig().platforms.unifi,
                zerotier: req.body.platforms.zerotier ?? syncService.getConfig().platforms.zerotier,
            };
        }

        syncService.setConfig(updates);

        // If enabled state changed, start/stop timers
        if (updates.enabled !== undefined) {
            if (updates.enabled) {
                syncService.startAllSyncTimers();
            } else {
                syncService.stopAllSyncTimers();
            }
        }

        res.json({
            success: true,
            config: syncService.getConfig(),
        });
    } catch (error) {
        res.status(500).json({ 
            error: error instanceof Error ? error.message : 'Failed to update config' 
        });
    }
});

/**
 * POST /api/v1/sync/trigger
 * Trigger sync for a specific platform or all platforms
 */
router.post('/trigger', async (req: Request, res: Response) => {
    try {
        const { platform } = req.body;

        if (platform) {
            // Sync specific platform
            const result = await syncService.syncPlatform(platform);
            if (!result) {
                return res.status(404).json({ error: `Platform ${platform} not found` });
            }
            res.json({
                success: result.success,
                platform,
                result,
            });
        } else {
            // Sync all platforms
            const results = await syncService.syncAll();
            const response: any = { success: true, results: {} };
            
            for (const [p, r] of results) {
                response.results[p] = r;
                if (r && !r.success) {
                    response.success = false;
                }
            }
            
            res.json(response);
        }
    } catch (error) {
        res.status(500).json({ 
            error: error instanceof Error ? error.message : 'Sync failed' 
        });
    }
});

/**
 * POST /api/v1/sync/merge
 * Trigger device merge manually
 */
router.post('/merge', async (req: Request, res: Response) => {
    try {
        const result = await syncService.mergeDevices();
        res.json({
            success: result.errors.length === 0,
            ...result,
        });
    } catch (error) {
        res.status(500).json({ 
            error: error instanceof Error ? error.message : 'Merge failed' 
        });
    }
});

/**
 * GET /api/v1/sync/cross-platform
 * Get devices that appear in multiple platforms
 */
router.get('/cross-platform', async (req: Request, res: Response) => {
    try {
        const crossPlatformDevices = await syncService.getCrossPlatformDevices();
        res.json({
            count: crossPlatformDevices.length,
            devices: crossPlatformDevices,
        });
    } catch (error) {
        res.status(500).json({ 
            error: error instanceof Error ? error.message : 'Failed to get cross-platform devices' 
        });
    }
});

/**
 * POST /api/v1/sync/start
 * Start automatic sync timers
 */
router.post('/start', (req: Request, res: Response) => {
    try {
        syncService.setConfig({ enabled: true });
        syncService.startAllSyncTimers();
        res.json({
            success: true,
            message: 'Sync timers started',
            config: syncService.getConfig(),
        });
    } catch (error) {
        res.status(500).json({ 
            error: error instanceof Error ? error.message : 'Failed to start sync' 
        });
    }
});

/**
 * POST /api/v1/sync/stop
 * Stop automatic sync timers
 */
router.post('/stop', (req: Request, res: Response) => {
    try {
        syncService.stopAllSyncTimers();
        syncService.setConfig({ enabled: false });
        res.json({
            success: true,
            message: 'Sync timers stopped',
            config: syncService.getConfig(),
        });
    } catch (error) {
        res.status(500).json({ 
            error: error instanceof Error ? error.message : 'Failed to stop sync' 
        });
    }
});

export default router;
