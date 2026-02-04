/**
 * UISP (Ubiquiti Internet Service Provider) Connector
 * 
 * Integrates with UISP NMS for network management
 * API Docs: Available at https://your-uisp-hostname/api-docs/
 */

import { BaseConnector, PlatformDevice, PlatformNetwork, PlatformMember, SyncResult } from './base.js';
import { db, generateId, topologies, networks, devices } from '../db/index.js';
import { eq } from 'drizzle-orm';

interface UISPDevice {
    identification: {
        id: string;
        name: string;
        hostname?: string;
        mac: string;
        model: string;
        type: string;
        category: string;
        firmwareVersion?: string;
    };
    overview: {
        status: string;
        lastSeen?: string;
        uptime?: number;
        cpu?: number;
        ram?: number;
        signal?: number;
        distance?: number;
    };
    ipAddress?: string;
    site?: {
        id: string;
        name: string;
    };
}

interface UISPSite {
    id: string;
    name: string;
    address?: {
        city?: string;
        country?: string;
    };
    location?: {
        latitude: number;
        longitude: number;
    };
}

interface UISPDataLink {
    id: string;
    from: {
        device: {
            identification: {
                id: string;
                name: string;
            };
        };
    };
    to: {
        device: {
            identification: {
                id: string;
                name: string;
            };
        };
    };
    state: string;
    frequency?: number;
    signal?: {
        local?: number;
        remote?: number;
    };
}

export class UISPConnector extends BaseConnector {
    private baseUrl: string;
    private apiToken: string;
    private topologyId: string | null = null;

    constructor(baseUrl: string, apiToken: string) {
        super('UISP', 'uisp');
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.apiToken = apiToken;
    }

    private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
        const response = await fetch(`${this.baseUrl}/nms/api/v2.1${endpoint}`, {
            ...options,
            headers: {
                'x-auth-token': this.apiToken,
                'Content-Type': 'application/json',
                ...options?.headers,
            },
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`UISP API error: ${response.status} - ${error}`);
        }

        return response.json() as Promise<T>;
    }

    async testConnection(): Promise<{ success: boolean; message: string }> {
        try {
            const devices = await this.fetch<UISPDevice[]>('/devices?count=1');
            return {
                success: true,
                message: 'Connected to UISP NMS successfully',
            };
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Connection failed',
            };
        }
    }

    /**
     * Get all sites
     */
    async getSites(): Promise<UISPSite[]> {
        return this.fetch<UISPSite[]>('/sites');
    }

    async getNetworks(): Promise<PlatformNetwork[]> {
        // UISP uses sites as the network organizational unit
        const sites = await this.getSites();

        return sites.map(site => ({
            platformId: site.id,
            name: site.name,
            cidr: undefined, // UISP sites don't have explicit CIDRs
            status: 'active' as const,
            metadata: {
                address: site.address,
                location: site.location,
            },
        }));
    }

    async getDevices(): Promise<PlatformDevice[]> {
        const devices = await this.fetch<UISPDevice[]>('/devices');

        return devices.map(dev => {
            let type: PlatformDevice['type'] = 'other';
            switch (dev.identification.category?.toLowerCase()) {
                case 'wireless': type = 'access_point'; break;
                case 'wired': type = 'switch'; break;
                case 'optical': type = 'other'; break;
            }

            let status: PlatformDevice['status'] = 'unknown';
            switch (dev.overview.status?.toLowerCase()) {
                case 'active': status = 'online'; break;
                case 'inactive':
                case 'disconnected': status = 'offline'; break;
                case 'disabled':
                case 'unauthorized': status = 'offline'; break;
            }

            return {
                platformId: dev.identification.id,
                name: dev.identification.name,
                type,
                ipAddress: dev.ipAddress,
                macAddress: dev.identification.mac,
                status,
                lastSeen: dev.overview.lastSeen ? new Date(dev.overview.lastSeen) : undefined,
                metadata: {
                    hostname: dev.identification.hostname,
                    model: dev.identification.model,
                    firmwareVersion: dev.identification.firmwareVersion,
                    site: dev.site,
                    uptime: dev.overview.uptime,
                    cpu: dev.overview.cpu,
                    ram: dev.overview.ram,
                    signal: dev.overview.signal,
                    distance: dev.overview.distance,
                },
            } as PlatformDevice;
        });
    }

    async getNetworkMembers(siteId: string): Promise<PlatformMember[]> {
        // Get devices at this site
        const allDevices = await this.fetch<UISPDevice[]>('/devices');
        const siteDevices = allDevices.filter(d => d.site?.id === siteId);

        return siteDevices.map(dev => ({
            platformId: dev.identification.id,
            name: dev.identification.name,
            networkId: siteId,
            ipAddress: dev.ipAddress,
            macAddress: dev.identification.mac,
            authorized: true,
            online: dev.overview.status?.toLowerCase() === 'active',
            metadata: {
                model: dev.identification.model,
                signal: dev.overview.signal,
            },
        }));
    }

    /**
     * Get data links (point-to-point connections)
     */
    async getDataLinks(): Promise<UISPDataLink[]> {
        return this.fetch<UISPDataLink[]>('/data-links');
    }

    /**
     * Restart a device
     */
    async restartDevice(deviceId: string): Promise<void> {
        await this.fetch(`/devices/${deviceId}/restart`, {
            method: 'POST',
        });
    }

    private async ensureTopology(): Promise<string> {
        if (this.topologyId) return this.topologyId;

        const existing = await db.select().from(topologies).where(eq(topologies.type, 'uisp'));

        if (existing.length > 0) {
            this.topologyId = existing[0].id;
            return this.topologyId!;
        }

        const newTopology = {
            id: generateId(),
            name: 'UISP',
            type: 'uisp' as const,
            description: 'UISP Network Management System',
            platformConfig: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await db.insert(topologies).values(newTopology);
        this.topologyId = newTopology.id;
        return this.topologyId;
    }

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

            // Sync networks (sites)
            const uispSites = await this.getNetworks();
            result.networksFound = uispSites.length;

            for (const site of uispSites) {
                try {
                    const existing = await db.select().from(networks)
                        .where(eq(networks.platformNetworkId, site.platformId));

                    if (existing.length === 0) {
                        await db.insert(networks).values({
                            id: generateId(),
                            topologyId,
                            name: site.name,
                            description: `UISP Site`,
                            cidr: null,
                            vlan: null,
                            platformNetworkId: site.platformId,
                            gatewayIp: null,
                            dnsServers: null,
                            status: site.status,
                            metadata: site.metadata,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        });
                        result.networksCreated++;
                    } else {
                        await db.update(networks).set({
                            name: site.name,
                            status: site.status,
                            metadata: site.metadata,
                            updatedAt: new Date(),
                        }).where(eq(networks.id, existing[0].id));
                        result.networksUpdated++;
                    }
                } catch (error) {
                    result.errors.push(`Site ${site.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Sync devices
            const uispDevices = await this.getDevices();
            result.devicesFound = uispDevices.length;

            for (const dev of uispDevices) {
                try {
                    const existing = await db.select().from(devices)
                        .where(eq(devices.platformDeviceId, dev.platformId));

                    const deviceType = dev.type === 'access_point' ? 'access_point' : 'other';

                    if (existing.length === 0) {
                        await db.insert(devices).values({
                            id: generateId(),
                            name: dev.name,
                            type: deviceType as any,
                            manufacturer: 'Ubiquiti',
                            model: (dev.metadata.model as string) || null,
                            serialNumber: null,
                            firmwareVersion: (dev.metadata.firmwareVersion as string) || null,
                            locationId: null,
                            vehicleId: null,
                            status: dev.status,
                            lastSeen: dev.lastSeen || null,
                            primaryIp: dev.ipAddress || null,
                            primaryMac: dev.macAddress || null,
                            hostname: (dev.metadata.hostname as string) || null,
                            managementUrl: dev.ipAddress ? `https://${dev.ipAddress}` : null,
                            sshPort: 22,
                            httpPort: 443,
                            platformType: 'uisp',
                            platformDeviceId: dev.platformId,
                            notes: null,
                            tags: null,
                            metadata: dev.metadata,
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
                            firmwareVersion: (dev.metadata.firmwareVersion as string) || null,
                            metadata: dev.metadata,
                            updatedAt: new Date(),
                        }).where(eq(devices.id, existing[0].id));
                        result.devicesUpdated++;
                    }
                } catch (error) {
                    result.errors.push(`Device ${dev.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

        } catch (error) {
            result.success = false;
            result.errors.push(error instanceof Error ? error.message : 'Unknown error');
        }

        return result;
    }
}
