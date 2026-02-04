/**
 * Base connector interface for all platform integrations
 */

export interface PlatformDevice {
    platformId: string;
    name: string;
    type: string;
    ipAddress?: string;
    macAddress?: string;
    status: 'online' | 'offline' | 'degraded' | 'unknown';
    lastSeen?: Date;
    metadata: Record<string, unknown>;
}

export interface PlatformNetwork {
    platformId: string;
    name: string;
    cidr?: string;
    status: 'active' | 'inactive' | 'unknown';
    metadata: Record<string, unknown>;
}

export interface PlatformMember {
    platformId: string;
    name?: string;
    deviceId?: string;
    networkId: string;
    ipAddress?: string;
    macAddress?: string;
    authorized: boolean;
    online: boolean;
    metadata: Record<string, unknown>;
}

export interface SyncResult {
    success: boolean;
    devicesFound: number;
    devicesCreated: number;
    devicesUpdated: number;
    networksFound: number;
    networksCreated: number;
    networksUpdated: number;
    errors: string[];
}

/**
 * Base class for platform connectors
 */
export abstract class BaseConnector {
    protected name: string;
    protected type: 'zerotier' | 'unifi' | 'uisp' | 'protect' | 'starlink' | 'tailscale' | 'cloudflare' | 'other';

    constructor(name: string, type: BaseConnector['type']) {
        this.name = name;
        this.type = type;
    }

    /**
     * Test connection to the platform
     */
    abstract testConnection(): Promise<{ success: boolean; message: string }>;

    /**
     * Get all networks from the platform
     */
    abstract getNetworks(): Promise<PlatformNetwork[]>;

    /**
     * Get all devices/members from the platform
     */
    abstract getDevices(): Promise<PlatformDevice[]>;

    /**
     * Get members of a specific network
     */
    abstract getNetworkMembers(networkId: string): Promise<PlatformMember[]>;

    /**
     * Sync platform data to local database
     */
    abstract sync(): Promise<SyncResult>;

    /**
     * Get connector name
     */
    getName(): string {
        return this.name;
    }

    /**
     * Get connector type
     */
    getType(): BaseConnector['type'] {
        return this.type;
    }
}

/**
 * UniFi connector mode
 * - 'sitemanager': Official Site Manager API v1.0 via api.ui.com (cloud)
 * - 'local': Official Site Manager API v1.0 via direct UDM IP
 * - 'legacy': Legacy cookie-based API (original connector)
 */
export type UniFiMode = 'sitemanager' | 'local' | 'legacy';

/**
 * Configuration for platform connectors
 */
export interface ConnectorConfig {
    zerotier?: {
        apiToken: string;
        apiUrl?: string;
    };
    unifi?: {
        /** API mode: sitemanager (cloud), local (direct), or legacy (cookie auth) */
        mode?: UniFiMode;
        /** API key for sitemanager/local modes */
        apiKey?: string;
        /** UDM IP address for local mode */
        udmIp?: string;
        /** Console ID for sitemanager (cloud) mode */
        consoleId?: string;
        /** Controller URL for legacy mode */
        controllerUrl?: string;
        /** Username for legacy mode */
        username?: string;
        /** Password for legacy mode */
        password?: string;
    };
    uisp?: {
        url: string;
        apiToken: string;
    };
    protect?: {
        url: string;
        username: string;
        password: string;
    };
    starlink?: {
        ip: string;
    };
}
