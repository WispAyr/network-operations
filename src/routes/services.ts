/**
 * Services API Routes
 * 
 * Endpoints for Skynet service discovery and monitoring
 */

import { Router, Request, Response } from 'express';
import {
  getServices,
  getServiceById,
  getServiceByPM2Name,
  getServiceSummary,
  getServicesByType,
  refreshServices,
  ServiceDefinition,
} from '../services/service-discovery.js';

const router = Router();

/**
 * GET /api/v1/services
 * List all discovered services with optional filtering
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const { status, type, sort } = req.query;

    let services = getServices();

    // Filter by status
    if (status && typeof status === 'string') {
      services = services.filter(s => s.status === status);
    }

    // Filter by type
    if (type && typeof type === 'string') {
      services = services.filter(s => s.type === type);
    }

    // Sort
    if (sort === 'name') {
      services.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'port') {
      services.sort((a, b) => (a.port || 0) - (b.port || 0));
    } else if (sort === 'status') {
      const statusOrder = { online: 0, degraded: 1, unknown: 2, offline: 3 };
      services.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
    } else {
      // Default: sort by status (online first) then name
      const statusOrder = { online: 0, degraded: 1, unknown: 2, offline: 3 };
      services.sort((a, b) => {
        const statusDiff = statusOrder[a.status] - statusOrder[b.status];
        return statusDiff !== 0 ? statusDiff : a.name.localeCompare(b.name);
      });
    }

    const summary = getServiceSummary();

    res.json({
      count: services.length,
      summary: {
        total: summary.total,
        online: summary.online,
        offline: summary.offline,
        degraded: summary.degraded,
        unknown: summary.unknown,
        lastScan: summary.lastScan?.toISOString() || null,
      },
      services: services.map(formatService),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get services',
    });
  }
});

/**
 * GET /api/v1/services/summary
 * Get service summary statistics
 */
router.get('/summary', (req: Request, res: Response) => {
  try {
    const summary = getServiceSummary();
    const services = getServices();

    // Group by type
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    for (const service of services) {
      byType[service.type] = (byType[service.type] || 0) + 1;
      byStatus[service.status] = (byStatus[service.status] || 0) + 1;
    }

    res.json({
      total: summary.total,
      online: summary.online,
      offline: summary.offline,
      degraded: summary.degraded,
      unknown: summary.unknown,
      lastScan: summary.lastScan?.toISOString() || null,
      byType,
      byStatus,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get summary',
    });
  }
});

/**
 * GET /api/v1/services/grid
 * Get services formatted for dashboard grid display
 */
router.get('/grid', (req: Request, res: Response) => {
  try {
    const services = getServices();
    const summary = getServiceSummary();

    // Sort by status (online first) then by name
    const statusOrder = { online: 0, degraded: 1, unknown: 2, offline: 3 };
    services.sort((a, b) => {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      return statusDiff !== 0 ? statusDiff : a.name.localeCompare(b.name);
    });

    res.json({
      summary: {
        total: summary.total,
        online: summary.online,
        offline: summary.offline,
        lastScan: summary.lastScan?.toISOString() || null,
      },
      grid: services.map(s => ({
        id: s.id,
        name: s.name,
        port: s.port,
        type: s.type,
        status: s.status,
        pm2Status: s.pm2Status,
        responseTimeMs: s.responseTimeMs,
        memory: s.memory ? Math.round(s.memory / 1024 / 1024) : null, // Convert to MB
        cpu: s.cpu,
        uptime: s.uptime,
        restarts: s.restarts,
        url: s.port ? `http://localhost:${s.port}` : null,
        lastCheck: s.lastCheck?.toISOString() || null,
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get service grid',
    });
  }
});

/**
 * GET /api/v1/services/types
 * Get services grouped by type
 */
router.get('/types', (req: Request, res: Response) => {
  try {
    const grouped = getServicesByType();

    const result: Record<string, any[]> = {};
    for (const [type, services] of Object.entries(grouped)) {
      result[type] = services.map(formatService);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get services by type',
    });
  }
});

/**
 * POST /api/v1/services/refresh
 * Trigger immediate service discovery refresh
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const services = await refreshServices();
    const summary = getServiceSummary();

    res.json({
      message: 'Service discovery refresh completed',
      count: services.length,
      summary: {
        total: summary.total,
        online: summary.online,
        offline: summary.offline,
        lastScan: summary.lastScan?.toISOString() || null,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to refresh services',
    });
  }
});

/**
 * GET /api/v1/services/:id
 * Get a specific service by ID
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const service = getServiceById(req.params.id as string);

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json(formatServiceFull(service));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get service',
    });
  }
});

/**
 * GET /api/v1/services/pm2/:name
 * Get a service by its PM2 process name
 */
router.get('/pm2/:name', (req: Request, res: Response) => {
  try {
    const service = getServiceByPM2Name(req.params.name as string);

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json(formatServiceFull(service));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get service',
    });
  }
});

/**
 * Format service for list response (compact)
 */
function formatService(service: ServiceDefinition): Record<string, any> {
  return {
    id: service.id,
    name: service.name,
    pm2Name: service.pm2Name,
    port: service.port,
    host: service.host,
    type: service.type,
    status: service.status,
    pm2Status: service.pm2Status,
    responseTimeMs: service.responseTimeMs,
    lastCheck: service.lastCheck?.toISOString() || null,
    url: service.port ? `http://${service.host}:${service.port}` : null,
  };
}

/**
 * Format service for detail response (full)
 */
function formatServiceFull(service: ServiceDefinition): Record<string, any> {
  return {
    id: service.id,
    name: service.name,
    pm2Name: service.pm2Name,
    port: service.port,
    host: service.host,
    type: service.type,
    healthEndpoint: service.healthEndpoint,
    status: service.status,
    pm2Status: service.pm2Status,
    pid: service.pid,
    memory: service.memory,
    memoryMb: service.memory ? Math.round(service.memory / 1024 / 1024) : null,
    cpu: service.cpu,
    uptime: service.uptime,
    uptimeFormatted: service.uptime ? formatUptime(service.uptime) : null,
    restarts: service.restarts,
    lastCheck: service.lastCheck?.toISOString() || null,
    lastSeen: service.lastSeen?.toISOString() || null,
    responseTimeMs: service.responseTimeMs,
    version: service.version,
    url: service.port ? `http://${service.host}:${service.port}` : null,
    metadata: service.metadata,
  };
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export default router;
