/**
 * UniFi Network Controller Connector
 * 
 * Integrates with UniFi Network Controller (local or cloud)
 * Supports both official and community-documented API endpoints
 */

import { BaseConnector, PlatformDevice, PlatformNetwork, PlatformMember, SyncResult } from './base.js';
import { db, generateId, topologies, networks, devices, deviceNetworkLinks, sites, locations } from '../db/index.js';
import { eq } from 'drizzle-orm';

interface UniFiSite {
    _id: string;
    name: string;
    desc: string;
    role: string;
}

interface UniFiDevice {
    _id: string;
    mac: string;
    ip: string;
    name?: string;
    model: string;
    type: string;
    version: string;
    state: number;
    adopted: boolean;
    uptime: number;
    last_seen: number;
    satisfaction?: number;
}

interface UniFiClient {
    _id: string;
    mac: string;
    ip?: string;
    hostname?: string;
    name?: string;
    network: string;
    is_wired: boolean;
    last_seen: number;
}

interface UniFiNetwork {
    _id: string;
    name: string;
    purpose: string;
    subnet?: string;
    vlan?: number;
    dhcp_start?: string;
    dhcp_stop?: string;
    domain_name?: string;
    is_nat: boolean;
    enabled: boolean;
}

export class UniFiConnector extends BaseConnector {
    private controllerUrl: string;
    private username: string;
    private password: string;
    private session: string | null = null;
    private currentSite: string = 'default';
    private topologyId: string | null = null;

    constructor(controllerUrl: string, username: string, password: string) {
        super('UniFi', 'unifi');
        // Remove trailing slash
        this.controllerUrl = controllerUrl.replace(/\/$/, '');
        this.username = username;
        this.password = password;
    }

    /**
     * Login to UniFi Controller and get session cookie
     */
    private async login(): Promise<void> {
        if (this.session) return;

        const response = await fetch(`${this.controllerUrl}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: this.username,
                password: this.password,
            }),
        });

        if (!response.ok) {
            throw new Error(`UniFi login failed: ${response.status}`);
        }

        // Extract session cookie
        const cookies = response.headers.get('set-cookie');
        if (cookies) {
            const match = cookies.match(/unifises=([^;]+)/);
            if (match) {
                this.session = match[1];
            }
        }

        if (!this.session) {
            throw new Error('Failed to extract UniFi session cookie');
        }
    }

    private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
        await this.login();

        const response = await fetch(`${this.controllerUrl}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `unifises=${this.session}`,
                ...options?.headers,
            },
        });

        if (response.status === 401) {
            // Session expired, try to login again
            this.session = null;
            await this.login();
            return this.fetch(endpoint, options);
        }

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`UniFi API error: ${response.status} - ${error}`);
        }

        const data = await response.json() as { data: T };
        return data.data;
    }

    /**
     * Set the current site for API calls
     */
    setSite(site: string): void {
        this.currentSite = site;
    }

    async testConnection(): Promise<{ success: boolean; message: string }> {
        try {
            await this.login();
            const sites = await this.getSites();
            return {
                success: true,
                message: `Connected to UniFi Controller. Found ${sites.length} site(s).`,
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
    async getSites(): Promise<UniFiSite[]> {
        return this.fetch<UniFiSite[]>('/api/self/sites');
    }

    async getNetworks(): Promise<PlatformNetwork[]> {
        const networks = await this.fetch<UniFiNetwork[]>(`/api/s/${this.currentSite}/rest/networkconf`);

        return networks.map(net => ({
            platformId: net._id,
            name: net.name,
            cidr: net.subnet,
            status: net.enabled ? 'active' : 'inactive',
            metadata: {
                purpose: net.purpose,
                vlan: net.vlan,
                dhcpRange: net.dhcp_start && net.dhcp_stop ? `${net.dhcp_start} - ${net.dhcp_stop}` : undefined,
                domainName: net.domain_name,
                isNat: net.is_nat,
            },
        })) as PlatformNetwork[];
    }

    async getDevices(): Promise<PlatformDevice[]> {
        const devices = await this.fetch<UniFiDevice[]>(`/api/s/${this.currentSite}/stat/device`);

        return devices.map(dev => {
            let type: PlatformDevice['type'] = 'other';
            switch (dev.type) {
                case 'ugw': type = 'router'; break;
                case 'usw': type = 'switch'; break;
                case 'uap': type = 'access_point'; break;
                default: type = 'other';
            }

            return {
                platformId: dev._id,
                name: dev.name || `UniFi ${dev.model}`,
                type,
                ipAddress: dev.ip,
                macAddress: dev.mac,
                status: dev.state === 1 ? 'online' : 'offline',
                lastSeen: new Date(dev.last_seen * 1000),
                metadata: {
                    model: dev.model,
                    version: dev.version,
                    adopted: dev.adopted,
                    uptime: dev.uptime,
                    satisfaction: dev.satisfaction,
                },
            } as PlatformDevice;
        });
    }

    /**
     * Get all clients connected to the network
     */
    async getClients(): Promise<UniFiClient[]> {
        return this.fetch<UniFiClient[]>(`/api/s/${this.currentSite}/stat/sta`);
    }

    async getNetworkMembers(networkId: string): Promise<PlatformMember[]> {
        const clients = await this.getClients();

        return clients
            .filter(client => client.network === networkId)
            .map(client => ({
                platformId: client._id,
                name: client.name || client.hostname,
                networkId,
                ipAddress: client.ip,
                macAddress: client.mac,
                authorized: true, // UniFi clients are implicitly authorized when connected
                online: Date.now() - (client.last_seen * 1000) < 300000,
                metadata: {
                    hostname: client.hostname,
                    isWired: client.is_wired,
                    lastSeen: client.last_seen * 1000,
                },
            }));
    }

    /**
     * Restart a device
     */
    async restartDevice(mac: string): Promise<void> {
        await this.fetch(`/api/s/${this.currentSite}/cmd/devmgr`, {
            method: 'POST',
            body: JSON.stringify({
                cmd: 'restart',
                mac,
            }),
        });
    }

    /**
     * Force provision a device
     */
    async forceProvision(mac: string): Promise<void> {
        await this.fetch(`/api/s/${this.currentSite}/cmd/devmgr`, {
            method: 'POST',
            body: JSON.stringify({
                cmd: 'force-provision',
                mac,
            }),
        });
    }

    /**
     * Block a client
     */
    async blockClient(mac: string): Promise<void> {
        await this.fetch(`/api/s/${this.currentSite}/cmd/stamgr`, {
            method: 'POST',
            body: JSON.stringify({
                cmd: 'block-sta',
                mac,
            }),
        });
    }

    /**
     * Unblock a client
     */
    async unblockClient(mac: string): Promise<void> {
        await this.fetch(`/api/s/${this.currentSite}/cmd/stamgr`, {
            method: 'POST',
            body: JSON.stringify({
                cmd: 'unblock-sta',
                mac,
            }),
        });
    }

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
            description: 'UniFi Network Controller',
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

            // Sync networks
            const unifiNetworks = await this.getNetworks();
            result.networksFound = unifiNetworks.length;

            for (const net of unifiNetworks) {
                try {
                    const existing = await db.select().from(networks)
                        .where(eq(networks.platformNetworkId, net.platformId));

                    if (existing.length === 0) {
                        await db.insert(networks).values({
                            id: generateId(),
                            topologyId,
                            name: net.name,
                            description: `UniFi Network`,
                            cidr: net.cidr || null,
                            vlan: (net.metadata.vlan as number) || null,
                            platformNetworkId: net.platformId,
                            gatewayIp: null,
                            dnsServers: null,
                            status: net.status,
                            metadata: net.metadata,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        });
                        result.networksCreated++;
                    } else {
                        await db.update(networks).set({
                            name: net.name,
                            cidr: net.cidr || null,
                            vlan: (net.metadata.vlan as number) || null,
                            status: net.status,
                            metadata: net.metadata,
                            updatedAt: new Date(),
                        }).where(eq(networks.id, existing[0].id));
                        result.networksUpdated++;
                    }
                } catch (error) {
                    result.errors.push(`Network ${net.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Sync devices
            const unifiDevices = await this.getDevices();
            result.devicesFound = unifiDevices.length;

            for (const dev of unifiDevices) {
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
                            firmwareVersion: (dev.metadata.version as string) || null,
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
