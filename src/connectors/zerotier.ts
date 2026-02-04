/**
 * ZeroTier Central API Connector
 * 
 * Integrates with ZeroTier's Central API for network management
 * API Docs: https://docs.zerotier.com/central/v1
 */

import { BaseConnector, PlatformDevice, PlatformNetwork, PlatformMember, SyncResult } from './base.js';
import { db, generateId, topologies, networks, devices, deviceNetworkLinks } from '../db/index.js';
import { eq } from 'drizzle-orm';

interface ZeroTierNetwork {
    id: string;
    config: {
        name: string;
        private: boolean;
        ipAssignmentPools: Array<{
            ipRangeStart: string;
            ipRangeEnd: string;
        }>;
        routes: Array<{
            target: string;
            via?: string;
        }>;
        v4AssignMode: { zt: boolean };
        v6AssignMode: { zt: boolean; rfc4193: boolean; '6plane': boolean };
        dns?: {
            domain: string;
            servers: string[];
        };
    };
    description?: string;
    onlineMemberCount: number;
    totalMemberCount: number;
    creationTime: number;
}

interface ZeroTierMember {
    nodeId: string;
    networkId: string;
    name?: string;
    description?: string;
    config: {
        authorized: boolean;
        ipAssignments: string[];
    };
    lastOnline: number;
    physicalAddress?: string;
    clientVersion?: string;
}

export class ZeroTierConnector extends BaseConnector {
    private apiToken: string;
    private apiUrl: string;
    private topologyId: string | null = null;

    constructor(apiToken: string, apiUrl: string = 'https://api.zerotier.com/api/v1') {
        super('ZeroTier', 'zerotier');
        this.apiToken = apiToken;
        this.apiUrl = apiUrl;
    }

    private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
        const response = await fetch(`${this.apiUrl}${endpoint}`, {
            ...options,
            headers: {
                'Authorization': `token ${this.apiToken}`,
                'Content-Type': 'application/json',
                ...options?.headers,
            },
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`ZeroTier API error: ${response.status} - ${error}`);
        }

        return response.json() as Promise<T>;
    }

    async testConnection(): Promise<{ success: boolean; message: string }> {
        try {
            const status = await this.fetch<{ online: boolean }>('/status');
            return {
                success: true,
                message: `Connected to ZeroTier Central API`,
            };
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Connection failed',
            };
        }
    }

    async getNetworks(): Promise<PlatformNetwork[]> {
        const ztNetworks = await this.fetch<ZeroTierNetwork[]>('/network');

        return ztNetworks.map(net => ({
            platformId: net.id,
            name: net.config.name || net.id,
            cidr: net.config.routes[0]?.target,
            status: 'active' as const,
            metadata: {
                private: net.config.private,
                onlineMemberCount: net.onlineMemberCount,
                totalMemberCount: net.totalMemberCount,
                dns: net.config.dns,
            },
        }));
    }

    async getDevices(): Promise<PlatformDevice[]> {
        // ZeroTier devices are network members, so we need to get all networks first
        const ztNetworks = await this.fetch<ZeroTierNetwork[]>('/network');
        const allDevices: PlatformDevice[] = [];

        for (const network of ztNetworks) {
            const members = await this.getNetworkMembers(network.id);
            members.forEach(member => {
                // Check if device already exists in our list
                const existing = allDevices.find(d => d.platformId === member.platformId);
                if (!existing) {
                    allDevices.push({
                        platformId: member.platformId,
                        name: member.name || `ZT Node ${member.platformId.substring(0, 8)}`,
                        type: 'other',
                        ipAddress: member.ipAddress,
                        macAddress: member.macAddress,
                        status: member.online ? 'online' : 'offline',
                        lastSeen: member.metadata.lastOnline ? new Date(member.metadata.lastOnline as number) : undefined,
                        metadata: member.metadata,
                    });
                }
            });
        }

        return allDevices;
    }

    async getNetworkMembers(networkId: string): Promise<PlatformMember[]> {
        const members = await this.fetch<ZeroTierMember[]>(`/network/${networkId}/member`);

        return members.map(member => ({
            platformId: member.nodeId,
            name: member.name || member.description,
            networkId: member.networkId,
            ipAddress: member.config.ipAssignments[0],
            macAddress: undefined, // ZeroTier uses node IDs, not MACs
            authorized: member.config.authorized,
            online: Date.now() - member.lastOnline < 300000, // Online if seen in last 5 minutes
            metadata: {
                nodeId: member.nodeId,
                description: member.description,
                allIpAssignments: member.config.ipAssignments,
                physicalAddress: member.physicalAddress,
                clientVersion: member.clientVersion,
                lastOnline: member.lastOnline,
            },
        }));
    }

    /**
     * Authorize a member on a network
     */
    async authorizeMember(networkId: string, memberId: string): Promise<void> {
        await this.fetch(`/network/${networkId}/member/${memberId}`, {
            method: 'POST',
            body: JSON.stringify({
                config: { authorized: true },
            }),
        });
    }

    /**
     * Deauthorize a member on a network
     */
    async deauthorizeMember(networkId: string, memberId: string): Promise<void> {
        await this.fetch(`/network/${networkId}/member/${memberId}`, {
            method: 'POST',
            body: JSON.stringify({
                config: { authorized: false },
            }),
        });
    }

    /**
     * Get or create the ZeroTier topology in the database
     */
    private async ensureTopology(): Promise<string> {
        if (this.topologyId) return this.topologyId;

        // Check if ZeroTier topology exists
        const existing = await db.select().from(topologies).where(eq(topologies.type, 'zerotier'));

        if (existing.length > 0) {
            this.topologyId = existing[0].id;
            return this.topologyId!;
        }

        // Create new topology
        const newTopology = {
            id: generateId(),
            name: 'ZeroTier',
            type: 'zerotier' as const,
            description: 'ZeroTier Virtual Networks',
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
            const ztNetworks = await this.getNetworks();
            result.networksFound = ztNetworks.length;

            for (const ztNet of ztNetworks) {
                try {
                    // Check if network exists
                    const existing = await db.select().from(networks)
                        .where(eq(networks.platformNetworkId, ztNet.platformId));

                    if (existing.length === 0) {
                        // Create new network
                        await db.insert(networks).values({
                            id: generateId(),
                            topologyId,
                            name: ztNet.name,
                            description: `ZeroTier Network: ${ztNet.platformId}`,
                            cidr: ztNet.cidr || null,
                            vlan: null,
                            platformNetworkId: ztNet.platformId,
                            gatewayIp: null,
                            dnsServers: (ztNet.metadata.dns as any)?.servers || null,
                            status: ztNet.status,
                            metadata: ztNet.metadata,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        });
                        result.networksCreated++;
                    } else {
                        // Update existing network
                        await db.update(networks).set({
                            name: ztNet.name,
                            cidr: ztNet.cidr || null,
                            status: ztNet.status,
                            metadata: ztNet.metadata,
                            updatedAt: new Date(),
                        }).where(eq(networks.id, existing[0].id));
                        result.networksUpdated++;
                    }
                } catch (error) {
                    result.errors.push(`Network ${ztNet.platformId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Sync devices (members)
            const ztDevices = await this.getDevices();
            result.devicesFound = ztDevices.length;

            for (const ztDev of ztDevices) {
                try {
                    // Check if device exists
                    const existing = await db.select().from(devices)
                        .where(eq(devices.platformDeviceId, ztDev.platformId));

                    if (existing.length === 0) {
                        // Create new device
                        const newDeviceId = generateId();
                        await db.insert(devices).values({
                            id: newDeviceId,
                            name: ztDev.name,
                            type: 'other',
                            manufacturer: null,
                            model: null,
                            serialNumber: null,
                            firmwareVersion: null,
                            locationId: null,
                            vehicleId: null,
                            status: ztDev.status,
                            lastSeen: ztDev.lastSeen || null,
                            primaryIp: ztDev.ipAddress || null,
                            primaryMac: ztDev.macAddress || null,
                            hostname: null,
                            managementUrl: null,
                            sshPort: null,
                            httpPort: null,
                            platformType: 'zerotier',
                            platformDeviceId: ztDev.platformId,
                            notes: null,
                            tags: null,
                            metadata: ztDev.metadata,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        });
                        result.devicesCreated++;
                    } else {
                        // Update existing device
                        await db.update(devices).set({
                            name: ztDev.name,
                            status: ztDev.status,
                            lastSeen: ztDev.lastSeen || null,
                            primaryIp: ztDev.ipAddress || null,
                            metadata: ztDev.metadata,
                            updatedAt: new Date(),
                        }).where(eq(devices.id, existing[0].id));
                        result.devicesUpdated++;
                    }
                } catch (error) {
                    result.errors.push(`Device ${ztDev.platformId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

        } catch (error) {
            result.success = false;
            result.errors.push(error instanceof Error ? error.message : 'Unknown error');
        }

        return result;
    }
}
