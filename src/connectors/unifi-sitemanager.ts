/**
 * UniFi Site Manager API v1.0 Connector
 * 
 * Official Integration API for UniFi Network
 * Supports both cloud mode (via api.ui.com) and local mode (direct UDM access)
 * 
 * @see https://developer.ui.com
 * @see https://apidoc-cdn.ui.com/network/v10.0.162/integration.json
 */

import { BaseConnector, PlatformDevice, PlatformNetwork, PlatformMember, SyncResult } from './base.js';
import { db, generateId, topologies, networks, devices, sites as sitesTable } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { classifyTrustZone } from '../utils/helpers.js';

// ============================================================
// API Response Types (from OpenAPI spec)
// ============================================================

interface PagedResponse<T> {
    offset: number;
    limit: number;
    count: number;
    totalCount: number;
    data: T[];
}

interface SiteManagerSite {
    id: string;
    internalReference: string;
    name: string;
}

interface SiteManagerDevice {
    id: string;
    macAddress: string;
    ipAddress?: string;
    name?: string;
    model: string;
    state: 'ONLINE' | 'OFFLINE' | 'ADOPTING' | 'PENDING' | 'UPDATING' | 'RESTARTING';
    supported: boolean;
    firmwareVersion: string;
    firmwareUpdatable: boolean;
    features: Array<'accessPoint' | 'switching' | 'routing' | 'gateway'>;
    interfaces: Array<'ports' | 'radios'>;
}

interface SiteManagerDeviceStats {
    uptimeSec: number;
    lastHeartbeatAt: string;
    nextHeartbeatAt: string;
    loadAverage1Min?: number;
    loadAverage5Min?: number;
    loadAverage15Min?: number;
    cpuUtilizationPct?: number;
    memoryUtilizationPct?: number;
    uplink?: {
        txRateBps?: number;
        rxRateBps?: number;
    };
    interfaces?: {
        radios?: Array<{
            frequencyGHz: number;
            txRetriesPct?: number;
        }>;
    };
}

interface SiteManagerClient {
    type: 'WIRED' | 'WIRELESS' | 'VPN' | 'GUEST';
    id: string;
    name?: string;
    connectedAt: string;
    macAddress: string;
    ipAddress?: string;
    uplinkDeviceId?: string;
    access: {
        type: 'DEFAULT' | 'BLOCKED' | 'GUEST_AUTHORIZED';
    };
    // Wireless-specific
    wifiName?: string;
    signalDbm?: number;
    // Traffic stats
    rxBytes?: number;
    txBytes?: number;
}

interface SiteManagerWifiBroadcast {
    type: 'STANDARD' | 'GUEST' | 'IOT';
    id: string;
    name: string;
    enabled: boolean;
    metadata?: {
        origin: 'USER_DEFINED' | 'SYSTEM';
    };
    network: {
        type: 'NATIVE' | 'SPECIFIC';
        networkId?: string;
    };
    securityConfiguration: {
        type: 'OPEN' | 'WPA2_PERSONAL' | 'WPA3_PERSONAL' | 'WPA2_ENTERPRISE' | 'WPA3_ENTERPRISE';
    };
    broadcastingFrequenciesGHz: number[];
}

interface SiteManagerNetwork {
    id: string;
    name: string;
    enabled: boolean;
    vlanId?: number;
    management?: 'USER_DEFINED' | 'SYSTEM';
    metadata?: {
        origin: string;
    };
}

// ============================================================
// Extended Device Model (with stats + clients + SSIDs)
// ============================================================

interface ExtendedDeviceData extends PlatformDevice {
    metadata: {
        model: string;
        version: string;
        state: string;
        features: string[];
        interfaces: string[];
        // Stats data
        uptimeSec?: number;
        uptimeFormatted?: string;
        cpuUtilizationPct?: number;
        memoryUtilizationPct?: number;
        loadAverage1Min?: number;
        loadAverage5Min?: number;
        loadAverage15Min?: number;
        lastHeartbeatAt?: string;
        // Throughput
        uplinkTxBps?: number;
        uplinkRxBps?: number;
        // AP-specific
        clientCount?: number;
        ssids?: string[];
        radios?: Array<{ frequencyGHz: number; txRetriesPct?: number }>;
        // Switch-specific
        portCount?: number;
    };
}

// ============================================================
// Connector Configuration
// ============================================================

export type UniFiSiteManagerMode = 'sitemanager' | 'local';

export interface UniFiSiteManagerConfig {
    mode: UniFiSiteManagerMode;
    apiKey: string;
    // For local mode
    udmIp?: string;
    // For cloud mode
    consoleId?: string;
}

// ============================================================
// UniFi Site Manager Connector
// ============================================================

export class UniFiSiteManagerConnector extends BaseConnector {
    private config: UniFiSiteManagerConfig;
    private baseUrl: string;
    private topologyId: string | null = null;
    private currentSiteId: string | null = null;

    constructor(config: UniFiSiteManagerConfig) {
        super('UniFi Site Manager', 'unifi');
        this.config = config;

        // Determine base URL based on mode
        if (config.mode === 'local') {
            if (!config.udmIp) {
                throw new Error('UniFi Site Manager local mode requires udmIp');
            }
            this.baseUrl = `https://${config.udmIp}/proxy/network/integration`;
        } else {
            if (!config.consoleId) {
                throw new Error('UniFi Site Manager cloud mode requires consoleId');
            }
            this.baseUrl = `https://api.ui.com/v1/connector/consoles/${config.consoleId}/proxy/network/integration`;
        }
    }

    /**
     * Make authenticated request to the Site Manager API
     */
    private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;
        
        const response = await fetch(url, {
            ...options,
            headers: {
                'X-API-KEY': this.config.apiKey,
                'Content-Type': 'application/json',
                ...options?.headers,
            },
        });

        if (!response.ok) {
            const errorBody = await response.text();
            let errorMessage: string;
            try {
                const errorJson = JSON.parse(errorBody);
                errorMessage = errorJson.error?.message || errorJson.message || errorBody;
            } catch {
                errorMessage = errorBody;
            }
            throw new Error(`UniFi API error ${response.status}: ${errorMessage}`);
        }

        return response.json() as Promise<T>;
    }

    /**
     * Fetch all pages of a paginated endpoint
     */
    private async fetchAllPages<T>(endpoint: string, limit: number = 100): Promise<T[]> {
        const results: T[] = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const separator = endpoint.includes('?') ? '&' : '?';
            const pagedEndpoint = `${endpoint}${separator}offset=${offset}&limit=${limit}`;
            const response = await this.fetch<PagedResponse<T>>(pagedEndpoint);
            
            results.push(...response.data);
            offset += response.count;
            hasMore = offset < response.totalCount;
        }

        return results;
    }

    /**
     * Test connection to the API
     */
    async testConnection(): Promise<{ success: boolean; message: string }> {
        try {
            const info = await this.fetch<{ applicationVersion: string }>('/v1/info');
            const sites = await this.getSites();
            return {
                success: true,
                message: `Connected to UniFi Network v${info.applicationVersion}. Found ${sites.length} site(s).`,
            };
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Connection failed',
            };
        }
    }

    // ============================================================
    // API Endpoints
    // ============================================================

    /**
     * GET /v1/sites - List all sites
     */
    async getSites(): Promise<SiteManagerSite[]> {
        return this.fetchAllPages<SiteManagerSite>('/v1/sites');
    }

    /**
     * GET /v1/sites/{siteId}/devices - List devices in a site
     */
    async getSiteDevices(siteId: string): Promise<SiteManagerDevice[]> {
        return this.fetchAllPages<SiteManagerDevice>(`/v1/sites/${siteId}/devices`);
    }

    /**
     * GET /v1/sites/{siteId}/devices/{deviceId}/statistics/latest - Get device stats
     */
    async getDeviceStats(siteId: string, deviceId: string): Promise<SiteManagerDeviceStats | null> {
        try {
            return await this.fetch<SiteManagerDeviceStats>(
                `/v1/sites/${siteId}/devices/${deviceId}/statistics/latest`
            );
        } catch (error) {
            // Stats may not be available for all devices (e.g., offline)
            console.warn(`[UniFi SM] Failed to get stats for device ${deviceId}:`, error);
            return null;
        }
    }

    /**
     * GET /v1/sites/{siteId}/clients - List connected clients
     */
    async getSiteClients(siteId: string): Promise<SiteManagerClient[]> {
        return this.fetchAllPages<SiteManagerClient>(`/v1/sites/${siteId}/clients`);
    }

    /**
     * GET /v1/sites/{siteId}/wifi/broadcasts - List WiFi SSIDs
     */
    async getSiteWifiBroadcasts(siteId: string): Promise<SiteManagerWifiBroadcast[]> {
        return this.fetchAllPages<SiteManagerWifiBroadcast>(`/v1/sites/${siteId}/wifi/broadcasts`);
    }

    /**
     * GET /v1/sites/{siteId}/networks - List networks
     */
    async getSiteNetworks(siteId: string): Promise<SiteManagerNetwork[]> {
        return this.fetchAllPages<SiteManagerNetwork>(`/v1/sites/${siteId}/networks`);
    }

    // ============================================================
    // BaseConnector Interface Implementation
    // ============================================================

    /**
     * Set the current site for operations
     */
    setSite(siteId: string): void {
        this.currentSiteId = siteId;
    }

    /**
     * Get networks for the current site
     */
    async getNetworks(): Promise<PlatformNetwork[]> {
        const siteId = this.currentSiteId || (await this.getDefaultSiteId());
        const networks = await this.getSiteNetworks(siteId);

        return networks.map(net => ({
            platformId: net.id,
            name: net.name,
            status: net.enabled ? 'active' : 'inactive',
            metadata: {
                vlan: net.vlanId,
                management: net.management,
                origin: net.metadata?.origin,
            },
        }));
    }

    /**
     * Get devices with extended stats for the current site
     */
    async getDevices(): Promise<PlatformDevice[]> {
        const siteId = this.currentSiteId || (await this.getDefaultSiteId());
        
        // Fetch devices, clients, and SSIDs in parallel
        const [deviceList, clients, ssids] = await Promise.all([
            this.getSiteDevices(siteId),
            this.getSiteClients(siteId),
            this.getSiteWifiBroadcasts(siteId),
        ]);

        // Build client count per device
        const clientsByDevice = new Map<string, SiteManagerClient[]>();
        for (const client of clients) {
            if (client.uplinkDeviceId) {
                const existing = clientsByDevice.get(client.uplinkDeviceId) || [];
                existing.push(client);
                clientsByDevice.set(client.uplinkDeviceId, existing);
            }
        }

        // Enabled SSIDs list
        const enabledSsids = ssids.filter(s => s.enabled).map(s => s.name);

        // Fetch stats for each device (batch with controlled concurrency)
        const devices: ExtendedDeviceData[] = [];
        
        for (const dev of deviceList) {
            // Map device type from features
            let type: PlatformDevice['type'] = 'other';
            if (dev.features.includes('accessPoint')) type = 'access_point';
            else if (dev.features.includes('switching')) type = 'switch';
            else if (dev.features.includes('gateway') || dev.features.includes('routing')) type = 'router';

            // Map status
            let status: PlatformDevice['status'] = 'unknown';
            switch (dev.state) {
                case 'ONLINE': status = 'online'; break;
                case 'OFFLINE': status = 'offline'; break;
                case 'ADOPTING':
                case 'PENDING':
                case 'UPDATING':
                case 'RESTARTING': status = 'degraded'; break;
            }

            // Get stats for this device
            const stats = dev.state === 'ONLINE' ? await this.getDeviceStats(siteId, dev.id) : null;

            // Get client count for this device
            const deviceClients = clientsByDevice.get(dev.id) || [];
            const clientCount = deviceClients.length;

            const deviceData: ExtendedDeviceData = {
                platformId: dev.id,
                name: dev.name || `${dev.model} (${dev.macAddress})`,
                type,
                ipAddress: dev.ipAddress,
                macAddress: dev.macAddress,
                status,
                lastSeen: stats?.lastHeartbeatAt ? new Date(stats.lastHeartbeatAt) : undefined,
                metadata: {
                    model: dev.model,
                    version: dev.firmwareVersion,
                    state: dev.state,
                    features: dev.features,
                    interfaces: dev.interfaces,
                    // Stats
                    uptimeSec: stats?.uptimeSec,
                    uptimeFormatted: stats?.uptimeSec ? this.formatUptime(stats.uptimeSec) : undefined,
                    cpuUtilizationPct: stats?.cpuUtilizationPct,
                    memoryUtilizationPct: stats?.memoryUtilizationPct,
                    loadAverage1Min: stats?.loadAverage1Min,
                    loadAverage5Min: stats?.loadAverage5Min,
                    loadAverage15Min: stats?.loadAverage15Min,
                    lastHeartbeatAt: stats?.lastHeartbeatAt,
                    // Throughput
                    uplinkTxBps: stats?.uplink?.txRateBps,
                    uplinkRxBps: stats?.uplink?.rxRateBps,
                    // AP-specific
                    clientCount: type === 'access_point' ? clientCount : undefined,
                    ssids: type === 'access_point' ? enabledSsids : undefined,
                    radios: stats?.interfaces?.radios,
                },
            };

            devices.push(deviceData);
        }

        return devices;
    }

    /**
     * Get network members (clients) for a specific network
     */
    async getNetworkMembers(networkId: string): Promise<PlatformMember[]> {
        const siteId = this.currentSiteId || (await this.getDefaultSiteId());
        const clients = await this.getSiteClients(siteId);

        // Note: The v1.0 API doesn't directly associate clients with networks
        // We return all clients here; filtering by network would require additional logic
        return clients.map(client => ({
            platformId: client.id,
            name: client.name,
            networkId,
            ipAddress: client.ipAddress,
            macAddress: client.macAddress,
            authorized: client.access.type !== 'BLOCKED',
            online: true, // Only connected clients are returned
            metadata: {
                type: client.type,
                connectedAt: client.connectedAt,
                uplinkDeviceId: client.uplinkDeviceId,
                accessType: client.access.type,
                wifiName: client.wifiName,
                signalDbm: client.signalDbm,
                rxBytes: client.rxBytes,
                txBytes: client.txBytes,
            },
        }));
    }

    /**
     * Get the default site ID (first site found)
     */
    private async getDefaultSiteId(): Promise<string> {
        if (this.currentSiteId) return this.currentSiteId;
        
        const sites = await this.getSites();
        if (sites.length === 0) {
            throw new Error('No UniFi sites found');
        }
        
        this.currentSiteId = sites[0].id;
        return this.currentSiteId;
    }

    /**
     * Format uptime seconds to human-readable string
     */
    private formatUptime(seconds: number): string {
        if (!seconds) return 'Unknown';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
    }

    /**
     * Ensure topology exists in database
     */
    private async ensureTopology(): Promise<string> {
        if (this.topologyId) return this.topologyId;

        const existing = await db.select().from(topologies).where(eq(topologies.type, 'unifi'));

        if (existing.length > 0) {
            this.topologyId = existing[0].id;
            return this.topologyId!;
        }

        const newTopology = {
            id: generateId(),
            name: 'UniFi',
            type: 'unifi' as const,
            description: 'UniFi Network (Site Manager API)',
            platformConfig: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await db.insert(topologies).values(newTopology);
        this.topologyId = newTopology.id;
        return this.topologyId;
    }

    /**
     * Sync all data to local database
     */
    async sync(): Promise<SyncResult> {
        const result: SyncResult = {
            success: true,
            devicesFound: 0,
            devicesCreated: 0,
            devicesUpdated: 0,
            networksFound: 0,
            networksCreated: 0,
            networksUpdated: 0,
            errors: [],
        };

        try {
            const topologyId = await this.ensureTopology();

            // Get all sites
            const unifiSites = await this.getSites();
            console.log(`[UniFi SM] Found ${unifiSites.length} sites`);

            for (const site of unifiSites) {
                this.setSite(site.id);

                // Sync networks for this site
                try {
                    const siteNetworks = await this.getNetworks();
                    result.networksFound += siteNetworks.length;

                    for (const net of siteNetworks) {
                        try {
                            const existing = await db.select().from(networks)
                                .where(eq(networks.platformNetworkId, net.platformId));

                            const trustZone = classifyTrustZone({
                                name: net.name,
                                description: 'UniFi Network',
                                topologyType: 'unifi',
                                metadata: net.metadata,
                            });

                            if (existing.length === 0) {
                                await db.insert(networks).values({
                                    id: generateId(),
                                    topologyId,
                                    name: net.name,
                                    description: `UniFi Network (${site.name})`,
                                    cidr: net.cidr || null,
                                    vlan: (net.metadata.vlan as number) || null,
                                    platformNetworkId: net.platformId,
                                    gatewayIp: null,
                                    dnsServers: null,
                                    status: net.status,
                                    trustZone,
                                    metadata: { ...net.metadata, siteId: site.id, siteName: site.name },
                                    createdAt: new Date(),
                                    updatedAt: new Date(),
                                });
                                result.networksCreated++;
                            } else {
                                await db.update(networks).set({
                                    name: net.name,
                                    vlan: (net.metadata.vlan as number) || null,
                                    status: net.status,
                                    trustZone,
                                    metadata: { ...net.metadata, siteId: site.id, siteName: site.name },
                                    updatedAt: new Date(),
                                }).where(eq(networks.id, existing[0].id));
                                result.networksUpdated++;
                            }
                        } catch (error) {
                            result.errors.push(`Network ${net.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        }
                    }
                } catch (error) {
                    result.errors.push(`Site ${site.name} networks: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }

                // Sync devices for this site
                try {
                    const siteDevices = await this.getDevices();
                    result.devicesFound += siteDevices.length;

                    for (const dev of siteDevices) {
                        try {
                            const existing = await db.select().from(devices)
                                .where(eq(devices.platformDeviceId, dev.platformId));

                            const deviceType = dev.type === 'access_point' ? 'access_point'
                                : dev.type === 'switch' ? 'switch'
                                    : dev.type === 'router' ? 'router'
                                        : 'other';

                            if (existing.length === 0) {
                                await db.insert(devices).values({
                                    id: generateId(),
                                    name: dev.name,
                                    type: deviceType as any,
                                    manufacturer: 'Ubiquiti',
                                    model: (dev.metadata.model as string) || null,
                                    serialNumber: null,
                                    firmwareVersion: (dev.metadata.version as string) || null,
                                    locationId: null,
                                    vehicleId: null,
                                    status: dev.status,
                                    lastSeen: dev.lastSeen || null,
                                    primaryIp: dev.ipAddress || null,
                                    primaryMac: dev.macAddress || null,
                                    hostname: null,
                                    managementUrl: dev.ipAddress ? `https://${dev.ipAddress}` : null,
                                    sshPort: 22,
                                    httpPort: 443,
                                    platformType: 'unifi',
                                    platformDeviceId: dev.platformId,
                                    notes: null,
                                    tags: null,
                                    metadata: { ...dev.metadata, siteId: site.id, siteName: site.name, apiVersion: 'v1.0' },
                                    createdAt: new Date(),
                                    updatedAt: new Date(),
                                });
                                result.devicesCreated++;
                            } else {
                                await db.update(devices).set({
                                    name: dev.name,
                                    status: dev.status,
                                    lastSeen: dev.lastSeen || null,
                                    primaryIp: dev.ipAddress || null,
                                    firmwareVersion: (dev.metadata.version as string) || null,
                                    metadata: { ...dev.metadata, siteId: site.id, siteName: site.name, apiVersion: 'v1.0' },
                                    updatedAt: new Date(),
                                }).where(eq(devices.id, existing[0].id));
                                result.devicesUpdated++;
                            }
                        } catch (error) {
                            result.errors.push(`Device ${dev.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        }
                    }
                } catch (error) {
                    result.errors.push(`Site ${site.name} devices: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

        } catch (error) {
            result.success = false;
            result.errors.push(error instanceof Error ? error.message : 'Unknown error');
        }

        return result;
    }
}
