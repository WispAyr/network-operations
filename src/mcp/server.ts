#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { db, initializeDatabase } from '../db/index.js';
import { sites, locations, devices, networks, topologies, accessPaths, pathHops, vehicles, deviceNetworkLinks, deployments, connectivityChains, chainLinks, networkScans, discoveredDevices } from '../db/schema.js';
import { eq, like, and, ne, desc } from 'drizzle-orm';
import { generateId } from '../utils/helpers.js';
import { perspectiveService } from '../engine/perspective.js';
import { networkScanner } from '../engine/scanner.js';

// Helper function for compass direction with arrows
function getCompassDirection(bearing: number): string {
    const directions = [
        { min: 337.5, max: 360, name: 'N', arrow: '↑' },
        { min: 0, max: 22.5, name: 'N', arrow: '↑' },
        { min: 22.5, max: 67.5, name: 'NE', arrow: '↗' },
        { min: 67.5, max: 112.5, name: 'E', arrow: '→' },
        { min: 112.5, max: 157.5, name: 'SE', arrow: '↘' },
        { min: 157.5, max: 202.5, name: 'S', arrow: '↓' },
        { min: 202.5, max: 247.5, name: 'SW', arrow: '↙' },
        { min: 247.5, max: 292.5, name: 'W', arrow: '←' },
        { min: 292.5, max: 337.5, name: 'NW', arrow: '↖' },
    ];
    for (const dir of directions) {
        if (bearing >= dir.min && bearing < dir.max) {
            return `${dir.arrow} ${dir.name}`;
        }
    }
    return '↑ N';
}

// Icons for visual representation
function getNodeIcon(type: string): string {
    const icons: Record<string, string> = {
        site: '🏢',
        location: '📍',
        vehicle: '🚐',
        device: '💻',
        router: '📡',
        switch: '🔀',
        access_point: '📶',
        server: '🖥️',
        camera: '📹',
        controller: '🎛️',
        gateway: '🌐',
    };
    return icons[type] || '⬡';
}

// Initialize the MCP server
const server = new Server(
    {
        name: 'netops',
        version: '0.1.0',
    },
    {
        capabilities: {
            resources: {},
            tools: {},
        },
    }
);

// ============================================
// RESOURCES
// ============================================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
        resources: [
            {
                uri: 'netops://sites',
                mimeType: 'application/json',
                name: 'All Sites',
                description: 'List of all sites in the network operations system',
            },
            {
                uri: 'netops://devices',
                mimeType: 'application/json',
                name: 'All Devices',
                description: 'List of all devices across all sites',
            },
            {
                uri: 'netops://networks',
                mimeType: 'application/json',
                name: 'All Networks',
                description: 'List of all networks and their topologies',
            },
            {
                uri: 'netops://topologies',
                mimeType: 'application/json',
                name: 'All Topologies',
                description: 'List of all network topology types (ZeroTier, UniFi, etc.)',
            },
        ],
    };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'netops://sites') {
        const allSites = await db.select().from(sites);
        return {
            contents: [
                {
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(allSites, null, 2),
                },
            ],
        };
    }

    if (uri === 'netops://devices') {
        const allDevices = await db.select().from(devices);
        return {
            contents: [
                {
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(allDevices, null, 2),
                },
            ],
        };
    }

    if (uri === 'netops://networks') {
        const allNetworks = await db.select().from(networks);
        return {
            contents: [
                {
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(allNetworks, null, 2),
                },
            ],
        };
    }

    if (uri === 'netops://topologies') {
        const allTopologies = await db.select().from(topologies);
        return {
            contents: [
                {
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(allTopologies, null, 2),
                },
            ],
        };
    }

    throw new Error(`Unknown resource: ${uri}`);
});

// ============================================
// TOOLS
// ============================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            // Site Management
            {
                name: 'list_sites',
                description: 'List all sites with their locations and device counts',
                inputSchema: {
                    type: 'object',
                    properties: {
                        search: {
                            type: 'string',
                            description: 'Optional search term to filter sites by name',
                        },
                    },
                },
            },
            {
                name: 'create_site',
                description: 'Create a new site',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Name of the site' },
                        description: { type: 'string', description: 'Description of the site' },
                        address: { type: 'string', description: 'Physical address' },
                        latitude: { type: 'number', description: 'GPS latitude' },
                        longitude: { type: 'number', description: 'GPS longitude' },
                    },
                    required: ['name'],
                },
            },
            {
                name: 'create_location',
                description: 'Create a new location within a site',
                inputSchema: {
                    type: 'object',
                    properties: {
                        siteId: { type: 'string', description: 'ID of the parent site' },
                        name: { type: 'string', description: 'Name of the location' },
                        type: {
                            type: 'string',
                            enum: ['building', 'room', 'outdoor', 'cabinet', 'other'],
                            description: 'Type of location'
                        },
                        description: { type: 'string', description: 'Description of the location' },
                        floor: { type: 'string', description: 'Floor number or name' },
                    },
                    required: ['siteId', 'name'],
                },
            },

            // Device Management
            {
                name: 'list_devices',
                description: 'List devices with optional filters',
                inputSchema: {
                    type: 'object',
                    properties: {
                        siteId: { type: 'string', description: 'Filter by site ID' },
                        locationId: { type: 'string', description: 'Filter by location ID' },
                        status: {
                            type: 'string',
                            enum: ['online', 'offline', 'degraded', 'unknown'],
                            description: 'Filter by status'
                        },
                        type: { type: 'string', description: 'Filter by device type' },
                        search: { type: 'string', description: 'Search by name or IP' },
                    },
                },
            },
            {
                name: 'get_device',
                description: 'Get detailed information about a specific device including its network connections and access paths',
                inputSchema: {
                    type: 'object',
                    properties: {
                        deviceId: { type: 'string', description: 'ID of the device' },
                    },
                    required: ['deviceId'],
                },
            },
            {
                name: 'create_device',
                description: 'Register a new device in the system',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Name of the device' },
                        type: {
                            type: 'string',
                            enum: ['router', 'switch', 'access_point', 'gateway', 'server', 'camera', 'controller', 'sensor', 'iot', 'workstation', 'other'],
                            description: 'Type of device'
                        },
                        locationId: { type: 'string', description: 'ID of the location (optional if vehicleId is provided)' },
                        vehicleId: { type: 'string', description: 'ID of the vehicle (optional if locationId is provided)' },
                        manufacturer: { type: 'string', description: 'Device manufacturer' },
                        model: { type: 'string', description: 'Device model' },
                        primaryIp: { type: 'string', description: 'Primary IP address' },
                        primaryMac: { type: 'string', description: 'Primary MAC address' },
                        hostname: { type: 'string', description: 'Hostname' },
                        managementUrl: { type: 'string', description: 'URL for device management interface' },
                        sshPort: { type: 'number', description: 'SSH port (default: 22)' },
                        httpPort: { type: 'number', description: 'HTTP port (default: 80)' },
                        notes: { type: 'string', description: 'Additional notes' },
                        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
                    },
                    required: ['name', 'type'],
                },
            },
            {
                name: 'update_device',
                description: 'Update device properties',
                inputSchema: {
                    type: 'object',
                    properties: {
                        deviceId: { type: 'string', description: 'ID of the device to update' },
                        name: { type: 'string', description: 'New name' },
                        status: { type: 'string', enum: ['online', 'offline', 'degraded', 'unknown'], description: 'New status' },
                        primaryIp: { type: 'string', description: 'New primary IP' },
                        notes: { type: 'string', description: 'Updated notes' },
                        tags: { type: 'array', items: { type: 'string' }, description: 'Updated tags' },
                    },
                    required: ['deviceId'],
                },
            },

            // Network & Topology Management
            {
                name: 'list_networks',
                description: 'List all networks, optionally filtered by topology type',
                inputSchema: {
                    type: 'object',
                    properties: {
                        topologyType: {
                            type: 'string',
                            enum: ['zerotier', 'unifi', 'uisp', 'lan', 'wan', 'tailscale', 'wireguard', 'cloudflare', 'other'],
                            description: 'Filter by topology type'
                        },
                    },
                },
            },
            {
                name: 'create_topology',
                description: 'Create a new network topology (e.g., ZeroTier, UniFi)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Name of the topology' },
                        type: {
                            type: 'string',
                            enum: ['zerotier', 'unifi', 'uisp', 'lan', 'wan', 'tailscale', 'wireguard', 'cloudflare', 'other'],
                            description: 'Type of topology'
                        },
                        description: { type: 'string', description: 'Description' },
                    },
                    required: ['name', 'type'],
                },
            },
            {
                name: 'create_network',
                description: 'Create a new network within a topology',
                inputSchema: {
                    type: 'object',
                    properties: {
                        topologyId: { type: 'string', description: 'ID of the parent topology' },
                        name: { type: 'string', description: 'Name of the network' },
                        cidr: { type: 'string', description: 'CIDR notation (e.g., 192.168.1.0/24)' },
                        vlan: { type: 'number', description: 'VLAN ID' },
                        platformNetworkId: { type: 'string', description: 'ID from external platform (e.g., ZeroTier network ID)' },
                        gatewayIp: { type: 'string', description: 'Gateway IP address' },
                        description: { type: 'string', description: 'Description' },
                    },
                    required: ['topologyId', 'name'],
                },
            },
            {
                name: 'link_device_to_network',
                description: 'Connect a device to a network with its interface details',
                inputSchema: {
                    type: 'object',
                    properties: {
                        deviceId: { type: 'string', description: 'ID of the device' },
                        networkId: { type: 'string', description: 'ID of the network' },
                        ipAddress: { type: 'string', description: 'IP address on this network' },
                        macAddress: { type: 'string', description: 'MAC address of the interface' },
                        interfaceName: { type: 'string', description: 'Interface name (e.g., eth0, wlan0)' },
                        isManagementInterface: { type: 'boolean', description: 'Is this the primary management interface?' },
                    },
                    required: ['deviceId', 'networkId'],
                },
            },

            // Access Path Management
            {
                name: 'get_access_path',
                description: 'Get the access path(s) to reach a device, showing all hops and potential failure points',
                inputSchema: {
                    type: 'object',
                    properties: {
                        deviceId: { type: 'string', description: 'ID of the target device' },
                    },
                    required: ['deviceId'],
                },
            },
            {
                name: 'create_access_path',
                description: 'Create a new access path to reach a device through multiple hops',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Name for this access path' },
                        targetDeviceId: { type: 'string', description: 'ID of the device to reach' },
                        description: { type: 'string', description: 'Description of the path' },
                        isDefault: { type: 'boolean', description: 'Is this the default path to the device?' },
                        hops: {
                            type: 'array',
                            description: 'Ordered list of hops to reach the device',
                            items: {
                                type: 'object',
                                properties: {
                                    type: {
                                        type: 'string',
                                        enum: ['zerotier', 'unifi_vpn', 'ssh_tunnel', 'http_proxy', 'wireguard', 'tailscale', 'cloudflare_tunnel', 'direct', 'rdp', 'other'],
                                        description: 'Type of hop'
                                    },
                                    hostDeviceId: { type: 'string', description: 'ID of the device providing this hop (optional)' },
                                    targetAddress: { type: 'string', description: 'IP or hostname to connect to' },
                                    targetPort: { type: 'number', description: 'Port number' },
                                    config: { type: 'object', description: 'Additional configuration for this hop type' },
                                },
                                required: ['type', 'targetAddress'],
                            },
                        },
                    },
                    required: ['name', 'targetDeviceId', 'hops'],
                },
            },
            {
                name: 'test_access_path',
                description: 'Test connectivity through an access path and report status of each hop',
                inputSchema: {
                    type: 'object',
                    properties: {
                        pathId: { type: 'string', description: 'ID of the access path to test' },
                    },
                    required: ['pathId'],
                },
            },

            // Summary and Overview
            {
                name: 'get_network_overview',
                description: 'Get a high-level overview of the entire network infrastructure',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },

            // Perspective Tools (Location-Aware Visualization)
            {
                name: 'set_perspective',
                description: 'Set your current perspective/viewpoint for network visualization. The network map will reorient around your location.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        type: {
                            type: 'string',
                            enum: ['site', 'location', 'vehicle', 'coordinates', 'auto'],
                            description: 'Type of perspective to set',
                        },
                        id: {
                            type: 'string',
                            description: 'ID of the site, location, or vehicle (when type is site/location/vehicle)',
                        },
                        latitude: {
                            type: 'number',
                            description: 'GPS latitude (when type is coordinates)',
                        },
                        longitude: {
                            type: 'number',
                            description: 'GPS longitude (when type is coordinates)',
                        },
                        name: {
                            type: 'string',
                            description: 'Optional name for the location (when type is coordinates)',
                        },
                    },
                    required: ['type'],
                },
            },
            {
                name: 'get_perspective',
                description: 'Get the current perspective/viewpoint being used for network visualization',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'get_view_from_here',
                description: 'Get a visual representation of the network from the current perspective, showing nodes sorted by distance and reachability',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeDevices: {
                            type: 'boolean',
                            description: 'Include individual devices in the view (default: false)',
                        },
                        maxDistance: {
                            type: 'number',
                            description: 'Maximum distance in km to include (default: all)',
                        },
                    },
                },
            },

            // Deployment Management
            {
                name: 'create_deployment',
                description: 'Create a new deployment (festival, event, MACC, temporary site)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Deployment name' },
                        type: {
                            type: 'string',
                            enum: ['festival', 'event', 'emergency', 'construction', 'temporary', 'macc', 'other'],
                            description: 'Type of deployment'
                        },
                        vehicleId: { type: 'string', description: 'Vehicle being deployed (optional)' },
                        siteId: { type: 'string', description: 'Site where deployed (optional)' },
                        latitude: { type: 'number', description: 'GPS latitude (if custom location)' },
                        longitude: { type: 'number', description: 'GPS longitude (if custom location)' },
                        address: { type: 'string', description: 'Address of deployment' },
                        scheduledStart: { type: 'string', description: 'ISO date for scheduled start' },
                        scheduledEnd: { type: 'string', description: 'ISO date for scheduled end' },
                        monitoredByDeploymentId: { type: 'string', description: 'ID of deployment monitoring this one (e.g., MACC)' },
                    },
                    required: ['name', 'type'],
                },
            },
            {
                name: 'list_deployments',
                description: 'List all deployments with optional status filter',
                inputSchema: {
                    type: 'object',
                    properties: {
                        status: {
                            type: 'string',
                            enum: ['planned', 'active', 'standby', 'completed', 'cancelled'],
                            description: 'Filter by status'
                        },
                        type: { type: 'string', description: 'Filter by deployment type' },
                        includeCompleted: { type: 'boolean', description: 'Include completed deployments' },
                    },
                },
            },
            {
                name: 'update_deployment_status',
                description: 'Update a deployment status (activate, standby, complete)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        deploymentId: { type: 'string', description: 'Deployment ID' },
                        status: {
                            type: 'string',
                            enum: ['planned', 'active', 'standby', 'completed', 'cancelled'],
                            description: 'New status'
                        },
                    },
                    required: ['deploymentId', 'status'],
                },
            },

            // Connectivity Chain Management
            {
                name: 'create_connectivity_chain',
                description: 'Create a connectivity chain showing how something reaches core infrastructure',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Chain name (e.g., "Van to NOC via Starlink")' },
                        sourceType: { type: 'string', enum: ['device', 'network', 'vehicle', 'deployment'] },
                        sourceId: { type: 'string', description: 'ID of the source' },
                        targetType: { type: 'string', enum: ['network', 'site', 'device'] },
                        targetId: { type: 'string', description: 'ID of the target (usually NOC or core network)' },
                        links: {
                            type: 'array',
                            description: 'Array of links in the chain',
                            items: {
                                type: 'object',
                                properties: {
                                    linkType: { type: 'string', description: 'Type: starlink, cellular_4g, zerotier, etc.' },
                                    label: { type: 'string', description: 'Human readable label' },
                                    deviceId: { type: 'string' },
                                    networkId: { type: 'string' },
                                },
                            },
                        },
                    },
                    required: ['name', 'sourceType', 'sourceId', 'targetType', 'targetId'],
                },
            },
            {
                name: 'get_connectivity_chain',
                description: 'Get a visual representation of how something connects to core',
                inputSchema: {
                    type: 'object',
                    properties: {
                        chainId: { type: 'string', description: 'Chain ID' },
                        sourceType: { type: 'string', description: 'Or lookup by source type' },
                        sourceId: { type: 'string', description: 'And source ID' },
                    },
                },
            },

            // Trust Zone Queries
            {
                name: 'get_trust_status',
                description: 'Get current trust zone status - are you on friendly or hostile network?',
                inputSchema: {
                    type: 'object',
                    properties: {
                        deviceId: { type: 'string', description: 'Check from specific device perspective' },
                        networkId: { type: 'string', description: 'Check specific network trust' },
                    },
                },
            },
            {
                name: 'list_networks_by_trust',
                description: 'List all networks grouped by trust zone',
                inputSchema: {
                    type: 'object',
                    properties: {
                        trustZone: {
                            type: 'string',
                            enum: ['trusted', 'untrusted', 'semi-trusted'],
                            description: 'Filter to specific trust zone'
                        },
                    },
                },
            },

            // Enhanced Overview
            {
                name: 'get_infrastructure_map',
                description: 'Get complete infrastructure map showing sites, trust zones, connectivity, and status',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeOffline: { type: 'boolean', description: 'Include offline devices' },
                        groupBy: {
                            type: 'string',
                            enum: ['site', 'trust', 'topology', 'status'],
                            description: 'How to group the map'
                        },
                    },
                },
            },

            // ========== NETWORK SCANNER TOOLS ==========
            {
                name: 'get_local_networks',
                description: 'Get list of local network interfaces and their subnets (what networks can we scan?)',
                inputSchema: { type: 'object', properties: {} },
            },
            {
                name: 'start_network_scan',
                description: 'Start a network discovery scan (ARP, port scan, etc.) - discovers devices on local network',
                inputSchema: {
                    type: 'object',
                    properties: {
                        scanType: {
                            type: 'string',
                            enum: ['arp', 'mdns', 'port', 'snmp', 'full', 'quick'],
                            description: 'Type of scan: arp (fast), full (comprehensive), quick (arp + common ports)',
                        },
                        targetNetwork: {
                            type: 'string',
                            description: 'CIDR to scan (e.g., 192.168.1.0/24). Leave empty for auto-detect',
                        },
                    },
                    required: ['scanType'],
                },
            },
            {
                name: 'get_scan_status',
                description: 'Get the status and progress of a network scan',
                inputSchema: {
                    type: 'object',
                    properties: {
                        scanId: { type: 'string', description: 'Scan ID to check' },
                    },
                    required: ['scanId'],
                },
            },
            {
                name: 'list_discovered_devices',
                description: 'List devices discovered from network scans with classification status',
                inputSchema: {
                    type: 'object',
                    properties: {
                        classification: {
                            type: 'string',
                            enum: ['known', 'unknown', 'suspicious', 'authorized', 'blocked'],
                            description: 'Filter by classification',
                        },
                        showOnlyNew: {
                            type: 'boolean',
                            description: 'Only show newly discovered (unknown) devices',
                        },
                    },
                },
            },
            {
                name: 'classify_device',
                description: 'Mark a discovered device as known, suspicious, authorized, or blocked',
                inputSchema: {
                    type: 'object',
                    properties: {
                        deviceId: { type: 'string', description: 'Discovered device ID' },
                        classification: {
                            type: 'string',
                            enum: ['known', 'unknown', 'suspicious', 'authorized', 'blocked'],
                            description: 'New classification',
                        },
                        notes: { type: 'string', description: 'Optional notes about this device' },
                        linkToDeviceId: { type: 'string', description: 'Link to a known device in inventory' },
                    },
                    required: ['deviceId', 'classification'],
                },
            },
            {
                name: 'get_network_map',
                description: 'Get visual network topology map data showing all discovered devices and connections',
                inputSchema: {
                    type: 'object',
                    properties: {
                        format: {
                            type: 'string',
                            enum: ['visual', 'json', 'mermaid'],
                            description: 'Output format',
                        },
                    },
                },
            },
            {
                name: 'get_scan_history',
                description: 'Get history of network scans performed',
                inputSchema: {
                    type: 'object',
                    properties: {
                        limit: { type: 'number', description: 'Number of scans to return (default 10)' },
                    },
                },
            },
        ],
    };
});

// Tool implementation handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            // ========== SITE MANAGEMENT ==========
            case 'list_sites': {
                const search = (args as { search?: string }).search;
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

                return {
                    content: [{ type: 'text', text: JSON.stringify(sitesWithDetails, null, 2) }],
                };
            }

            case 'create_site': {
                const { name: siteName, description, address, latitude, longitude } = args as {
                    name: string;
                    description?: string;
                    address?: string;
                    latitude?: number;
                    longitude?: number;
                };

                const newSite = {
                    id: generateId(),
                    name: siteName,
                    description: description || null,
                    address: address || null,
                    latitude: latitude || null,
                    longitude: longitude || null,
                    metadata: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                await db.insert(sites).values(newSite);

                return {
                    content: [{ type: 'text', text: JSON.stringify({ success: true, site: newSite }, null, 2) }],
                };
            }

            case 'create_location': {
                const { siteId, name: locName, type, description, floor } = args as {
                    siteId: string;
                    name: string;
                    type?: string;
                    description?: string;
                    floor?: string;
                };

                const newLocation = {
                    id: generateId(),
                    siteId,
                    name: locName,
                    type: (type || 'other') as 'building' | 'room' | 'outdoor' | 'cabinet' | 'other',
                    description: description || null,
                    floor: floor || null,
                    coordinates: null,
                    metadata: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                await db.insert(locations).values(newLocation);

                return {
                    content: [{ type: 'text', text: JSON.stringify({ success: true, location: newLocation }, null, 2) }],
                };
            }

            // ========== DEVICE MANAGEMENT ==========
            case 'list_devices': {
                const { siteId, locationId, status, type, search } = args as {
                    siteId?: string;
                    locationId?: string;
                    status?: string;
                    type?: string;
                    search?: string;
                };

                let allDevices = await db.select().from(devices);

                // Apply filters
                if (locationId) {
                    allDevices = allDevices.filter(d => d.locationId === locationId);
                }

                if (siteId) {
                    // Get all locations in this site
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

                if (search) {
                    const searchLower = search.toLowerCase();
                    allDevices = allDevices.filter(d =>
                        d.name.toLowerCase().includes(searchLower) ||
                        d.primaryIp?.toLowerCase().includes(searchLower) ||
                        d.hostname?.toLowerCase().includes(searchLower)
                    );
                }

                return {
                    content: [{ type: 'text', text: JSON.stringify(allDevices, null, 2) }],
                };
            }

            case 'get_device': {
                const { deviceId } = args as { deviceId: string };

                const device = await db.select().from(devices).where(eq(devices.id, deviceId));
                if (device.length === 0) {
                    return {
                        content: [{ type: 'text', text: JSON.stringify({ error: 'Device not found' }) }],
                    };
                }

                // Get network connections
                const networkLinks = await db.select().from(deviceNetworkLinks).where(eq(deviceNetworkLinks.deviceId, deviceId));

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
                const paths = await db.select().from(accessPaths).where(eq(accessPaths.targetDeviceId, deviceId));

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

                // Get location info
                let location = null;
                if (device[0].locationId) {
                    const loc = await db.select().from(locations).where(eq(locations.id, device[0].locationId));
                    location = loc[0] || null;
                }

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            device: device[0],
                            location,
                            networks: networksWithLinks,
                            accessPaths: pathsWithHops,
                        }, null, 2),
                    }],
                };
            }

            case 'create_device': {
                const deviceArgs = args as {
                    name: string;
                    type: string;
                    locationId?: string;
                    vehicleId?: string;
                    manufacturer?: string;
                    model?: string;
                    primaryIp?: string;
                    primaryMac?: string;
                    hostname?: string;
                    managementUrl?: string;
                    sshPort?: number;
                    httpPort?: number;
                    notes?: string;
                    tags?: string[];
                };

                const newDevice = {
                    id: generateId(),
                    name: deviceArgs.name,
                    type: deviceArgs.type as any,
                    manufacturer: deviceArgs.manufacturer || null,
                    model: deviceArgs.model || null,
                    serialNumber: null,
                    firmwareVersion: null,
                    locationId: deviceArgs.locationId || null,
                    vehicleId: deviceArgs.vehicleId || null,
                    status: 'unknown' as const,
                    lastSeen: null,
                    primaryIp: deviceArgs.primaryIp || null,
                    primaryMac: deviceArgs.primaryMac || null,
                    hostname: deviceArgs.hostname || null,
                    managementUrl: deviceArgs.managementUrl || null,
                    sshPort: deviceArgs.sshPort || null,
                    httpPort: deviceArgs.httpPort || null,
                    platformType: 'manual' as const,
                    platformDeviceId: null,
                    notes: deviceArgs.notes || null,
                    tags: deviceArgs.tags || null,
                    metadata: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                await db.insert(devices).values(newDevice);

                return {
                    content: [{ type: 'text', text: JSON.stringify({ success: true, device: newDevice }, null, 2) }],
                };
            }

            case 'update_device': {
                const { deviceId, ...updates } = args as {
                    deviceId: string;
                    name?: string;
                    status?: string;
                    primaryIp?: string;
                    notes?: string;
                    tags?: string[];
                };

                const updateData: Record<string, unknown> = { updatedAt: new Date() };
                if (updates.name) updateData.name = updates.name;
                if (updates.status) updateData.status = updates.status;
                if (updates.primaryIp) updateData.primaryIp = updates.primaryIp;
                if (updates.notes !== undefined) updateData.notes = updates.notes;
                if (updates.tags) updateData.tags = updates.tags;

                await db.update(devices).set(updateData).where(eq(devices.id, deviceId));

                const updated = await db.select().from(devices).where(eq(devices.id, deviceId));

                return {
                    content: [{ type: 'text', text: JSON.stringify({ success: true, device: updated[0] }, null, 2) }],
                };
            }

            // ========== NETWORK MANAGEMENT ==========
            case 'list_networks': {
                const { topologyType } = args as { topologyType?: string };

                let allNetworks = await db.select({
                    network: networks,
                    topology: topologies,
                }).from(networks).leftJoin(topologies, eq(networks.topologyId, topologies.id));

                if (topologyType) {
                    allNetworks = allNetworks.filter(n => n.topology?.type === topologyType);
                }

                return {
                    content: [{ type: 'text', text: JSON.stringify(allNetworks, null, 2) }],
                };
            }

            case 'create_topology': {
                const { name: topoName, type: topoType, description } = args as {
                    name: string;
                    type: string;
                    description?: string;
                };

                const newTopology = {
                    id: generateId(),
                    name: topoName,
                    type: topoType as any,
                    description: description || null,
                    platformConfig: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                await db.insert(topologies).values(newTopology);

                return {
                    content: [{ type: 'text', text: JSON.stringify({ success: true, topology: newTopology }, null, 2) }],
                };
            }

            case 'create_network': {
                const networkArgs = args as {
                    topologyId: string;
                    name: string;
                    cidr?: string;
                    vlan?: number;
                    platformNetworkId?: string;
                    gatewayIp?: string;
                    description?: string;
                };

                const newNetwork = {
                    id: generateId(),
                    topologyId: networkArgs.topologyId,
                    name: networkArgs.name,
                    description: networkArgs.description || null,
                    cidr: networkArgs.cidr || null,
                    vlan: networkArgs.vlan || null,
                    platformNetworkId: networkArgs.platformNetworkId || null,
                    gatewayIp: networkArgs.gatewayIp || null,
                    dnsServers: null,
                    status: 'unknown' as const,
                    metadata: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                await db.insert(networks).values(newNetwork);

                return {
                    content: [{ type: 'text', text: JSON.stringify({ success: true, network: newNetwork }, null, 2) }],
                };
            }

            case 'link_device_to_network': {
                const linkArgs = args as {
                    deviceId: string;
                    networkId: string;
                    ipAddress?: string;
                    macAddress?: string;
                    interfaceName?: string;
                    isManagementInterface?: boolean;
                };

                const newLink = {
                    id: generateId(),
                    deviceId: linkArgs.deviceId,
                    networkId: linkArgs.networkId,
                    ipAddress: linkArgs.ipAddress || null,
                    macAddress: linkArgs.macAddress || null,
                    interfaceName: linkArgs.interfaceName || null,
                    isManagementInterface: linkArgs.isManagementInterface || false,
                    platformMemberId: null,
                    status: 'unknown' as const,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                await db.insert(deviceNetworkLinks).values(newLink);

                return {
                    content: [{ type: 'text', text: JSON.stringify({ success: true, link: newLink }, null, 2) }],
                };
            }

            // ========== ACCESS PATH MANAGEMENT ==========
            case 'get_access_path': {
                const { deviceId } = args as { deviceId: string };

                const paths = await db.select().from(accessPaths).where(eq(accessPaths.targetDeviceId, deviceId));

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
                const targetDevice = await db.select().from(devices).where(eq(devices.id, deviceId));

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            targetDevice: targetDevice[0] || null,
                            accessPaths: pathsWithHops,
                        }, null, 2),
                    }],
                };
            }

            case 'create_access_path': {
                const pathArgs = args as {
                    name: string;
                    targetDeviceId: string;
                    description?: string;
                    isDefault?: boolean;
                    hops: Array<{
                        type: string;
                        hostDeviceId?: string;
                        targetAddress: string;
                        targetPort?: number;
                        config?: Record<string, unknown>;
                    }>;
                };

                const pathId = generateId();

                // Create the access path
                const newPath = {
                    id: pathId,
                    name: pathArgs.name,
                    description: pathArgs.description || null,
                    targetDeviceId: pathArgs.targetDeviceId,
                    isDefault: pathArgs.isDefault || false,
                    lastTestedAt: null,
                    lastTestStatus: 'unknown' as const,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                await db.insert(accessPaths).values(newPath);

                // Create the hops
                const createdHops = [];
                for (let i = 0; i < pathArgs.hops.length; i++) {
                    const hop = pathArgs.hops[i];
                    const newHop = {
                        id: generateId(),
                        pathId,
                        order: i + 1,
                        type: hop.type as any,
                        hostDeviceId: hop.hostDeviceId || null,
                        targetAddress: hop.targetAddress,
                        targetPort: hop.targetPort || null,
                        config: hop.config || null,
                        status: 'unknown' as const,
                        lastCheckedAt: null,
                        lastLatencyMs: null,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    await db.insert(pathHops).values(newHop);
                    createdHops.push(newHop);
                }

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            accessPath: { ...newPath, hops: createdHops },
                        }, null, 2),
                    }],
                };
            }

            case 'test_access_path': {
                const { pathId } = args as { pathId: string };

                // Get the path and its hops
                const path = await db.select().from(accessPaths).where(eq(accessPaths.id, pathId));
                if (path.length === 0) {
                    return {
                        content: [{ type: 'text', text: JSON.stringify({ error: 'Access path not found' }) }],
                    };
                }

                const hops = await db.select().from(pathHops).where(eq(pathHops.pathId, pathId));
                const sortedHops = hops.sort((a, b) => a.order - b.order);

                // In a real implementation, this would actually test connectivity
                // For now, we return a simulated result
                const hopResults = sortedHops.map((hop, index) => ({
                    order: hop.order,
                    type: hop.type,
                    targetAddress: hop.targetAddress,
                    targetPort: hop.targetPort,
                    status: 'unknown' as const,
                    latencyMs: null,
                    message: 'Connectivity testing not yet implemented - requires network access',
                }));

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            pathId,
                            pathName: path[0].name,
                            testTime: new Date().toISOString(),
                            overallStatus: 'unknown',
                            hops: hopResults,
                            note: 'Full connectivity testing requires implementation of network probing utilities',
                        }, null, 2),
                    }],
                };
            }

            // ========== OVERVIEW ==========
            case 'get_network_overview': {
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

                const topologyBreakdown = allTopologies.map(t => ({
                    name: t.name,
                    type: t.type,
                    networkCount: allNetworks.filter(n => n.topologyId === t.id).length,
                }));

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
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
                            topologyBreakdown,
                            sites: allSites.map(s => ({
                                id: s.id,
                                name: s.name,
                                locationCount: allLocations.filter(l => l.siteId === s.id).length,
                            })),
                        }, null, 2),
                    }],
                };
            }

            // ========== PERSPECTIVE TOOLS ==========
            case 'set_perspective': {
                const { type, id, latitude, longitude, name: locName } = args as {
                    type: 'site' | 'location' | 'vehicle' | 'coordinates' | 'auto';
                    id?: string;
                    latitude?: number;
                    longitude?: number;
                    name?: string;
                };

                let perspective;

                switch (type) {
                    case 'site':
                        if (!id) throw new Error('Site ID required');
                        perspective = await perspectiveService.setPerspectiveToSite(id);
                        break;
                    case 'location':
                        if (!id) throw new Error('Location ID required');
                        perspective = await perspectiveService.setPerspectiveToLocation(id);
                        break;
                    case 'vehicle':
                        if (!id) throw new Error('Vehicle ID required');
                        perspective = await perspectiveService.setPerspectiveToVehicle(id);
                        break;
                    case 'coordinates':
                        if (latitude === undefined || longitude === undefined) {
                            throw new Error('Latitude and longitude required for coordinates');
                        }
                        perspective = perspectiveService.setPerspectiveToCoordinates(
                            latitude, longitude, locName
                        );
                        break;
                    case 'auto':
                        perspective = await perspectiveService.autoDetectPerspective(
                            undefined,
                            latitude && longitude ? { latitude, longitude } : undefined
                        );
                        break;
                    default:
                        throw new Error(`Unknown perspective type: ${type}`);
                }

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            message: `Perspective set to: ${perspective.name}`,
                            perspective,
                        }, null, 2),
                    }],
                };
            }

            case 'get_perspective': {
                const perspective = perspectiveService.getCurrentPerspective();

                if (!perspective) {
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                message: 'No perspective set. Use set_perspective to establish your viewpoint.',
                                suggestion: 'Try: set_perspective with type "auto" to auto-detect, or specify a site/location/vehicle',
                            }, null, 2),
                        }],
                    };
                }

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            perspective,
                            description: perspectiveService.describePerspective(),
                        }, null, 2),
                    }],
                };
            }

            case 'get_view_from_here': {
                const { includeDevices, maxDistance } = args as {
                    includeDevices?: boolean;
                    maxDistance?: number;
                };

                const perspective = perspectiveService.getCurrentPerspective();
                if (!perspective) {
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                error: 'No perspective set',
                                message: 'Use set_perspective first to establish your viewpoint',
                            }, null, 2),
                        }],
                    };
                }

                let nodes = await perspectiveService.getNodesFromPerspective();

                // Filter by max distance if specified
                if (maxDistance !== undefined) {
                    nodes = nodes.filter(n =>
                        n.distance === undefined || n.distance <= maxDistance
                    );
                }

                // Build the view with rich visual data
                const view = {
                    // Header with perspective info
                    perspective: {
                        icon: getNodeIcon(perspective.type),
                        name: perspective.name,
                        type: perspective.type,
                        coordinates: perspective.coordinates,
                        timestamp: new Date().toISOString(),
                    },

                    // Visual banner
                    banner: `
┌────────────────────────────────────────────────────────────────┐
│  📍 YOU ARE HERE: ${perspective.name.padEnd(43)}│
│     ${perspective.coordinates
                            ? `GPS: ${perspective.coordinates.latitude.toFixed(4)}°, ${perspective.coordinates.longitude.toFixed(4)}°`
                            : 'No GPS coordinates'}${' '.repeat(perspective.coordinates ? 24 : 36)}│
└────────────────────────────────────────────────────────────────┘`,

                    // Radar-style zone breakdown
                    radarZones: {
                        innerRing: {
                            label: '🔴 IMMEDIATE (< 10km)',
                            nodes: nodes.filter(n => n.distance !== undefined && n.distance < 10)
                                .map(n => `${getNodeIcon(n.type)} ${n.name}`),
                        },
                        midRing: {
                            label: '🟡 NEARBY (10-50km)',
                            nodes: nodes.filter(n => n.distance !== undefined && n.distance >= 10 && n.distance < 50)
                                .map(n => `${getNodeIcon(n.type)} ${n.name}`),
                        },
                        outerRing: {
                            label: '🟢 REGIONAL (50-100km)',
                            nodes: nodes.filter(n => n.distance !== undefined && n.distance >= 50 && n.distance < 100)
                                .map(n => `${getNodeIcon(n.type)} ${n.name}`),
                        },
                        distant: {
                            label: '🔵 DISTANT (> 100km)',
                            nodes: nodes.filter(n => n.distance !== undefined && n.distance >= 100)
                                .map(n => `${getNodeIcon(n.type)} ${n.name} (${n.distance?.toFixed(0)}km)`),
                        },
                    },

                    // Detailed node list sorted by distance
                    networkNodes: nodes.map(node => {
                        const distStr = node.distance !== undefined
                            ? `${node.distance.toFixed(1)} km`
                            : 'unknown';
                        const bearingStr = node.bearing !== undefined
                            ? getCompassDirection(node.bearing)
                            : '○';

                        return {
                            icon: getNodeIcon(node.type),
                            name: node.name,
                            type: node.type,
                            id: node.id,
                            compass: bearingStr,
                            distance: distStr,
                            distanceKm: node.distance,
                            reachability: node.reachability,
                            visual: `${getNodeIcon(node.type)} ${bearingStr} ${node.name} ── ${distStr}`,
                        };
                    }),

                    // Quick stats
                    stats: {
                        totalNodes: nodes.length,
                        immediate: nodes.filter(n => n.distance !== undefined && n.distance < 10).length,
                        nearby: nodes.filter(n => n.distance !== undefined && n.distance >= 10 && n.distance < 50).length,
                        regional: nodes.filter(n => n.distance !== undefined && n.distance >= 50 && n.distance < 100).length,
                        distant: nodes.filter(n => n.distance !== undefined && n.distance >= 100).length,
                    },
                };

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(view, null, 2),
                    }],
                };
            }

            // ========== DEPLOYMENT MANAGEMENT ==========
            case 'create_deployment': {
                const { name: depName, type: depType, vehicleId, siteId, latitude, longitude, address, scheduledStart, scheduledEnd, monitoredByDeploymentId } = args as {
                    name: string;
                    type: 'festival' | 'event' | 'emergency' | 'construction' | 'temporary' | 'macc' | 'other';
                    vehicleId?: string;
                    siteId?: string;
                    latitude?: number;
                    longitude?: number;
                    address?: string;
                    scheduledStart?: string;
                    scheduledEnd?: string;
                    monitoredByDeploymentId?: string;
                };

                const deployment = {
                    id: generateId(),
                    name: depName,
                    type: depType,
                    vehicleId: vehicleId || null,
                    siteId: siteId || null,
                    latitude: latitude || null,
                    longitude: longitude || null,
                    address: address || null,
                    status: 'planned' as const,
                    scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
                    scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
                    monitoredByDeploymentId: monitoredByDeploymentId || null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                await db.insert(deployments).values(deployment);

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            message: `🚀 Deployment "${depName}" created`,
                            deployment,
                            visual: `
┌─────────────────────────────────────────────────────────────┐
│  🎪 NEW DEPLOYMENT: ${depName.padEnd(38)}│
│  Type: ${depType.padEnd(51)}│
│  Status: 📋 PLANNED                                         │
└─────────────────────────────────────────────────────────────┘`,
                        }, null, 2),
                    }],
                };
            }

            case 'list_deployments': {
                const { status, type: depType, includeCompleted } = args as {
                    status?: string;
                    type?: string;
                    includeCompleted?: boolean;
                };

                let query = db.select().from(deployments);

                if (status) {
                    query = query.where(eq(deployments.status, status as any)) as typeof query;
                } else if (!includeCompleted) {
                    query = query.where(ne(deployments.status, 'completed')) as typeof query;
                }

                const result = await query;

                const grouped = {
                    active: result.filter(d => d.status === 'active'),
                    planned: result.filter(d => d.status === 'planned'),
                    standby: result.filter(d => d.status === 'standby'),
                    completed: result.filter(d => d.status === 'completed'),
                };

                const statusIcons: Record<string, string> = {
                    active: '🟢',
                    planned: '📋',
                    standby: '🟡',
                    completed: '✅',
                    cancelled: '❌',
                };

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            summary: {
                                total: result.length,
                                active: grouped.active.length,
                                planned: grouped.planned.length,
                                standby: grouped.standby.length,
                            },
                            deployments: result.map(d => ({
                                ...d,
                                statusIcon: statusIcons[d.status || 'planned'],
                                visual: `${statusIcons[d.status || 'planned']} ${d.name} (${d.type})`,
                            })),
                        }, null, 2),
                    }],
                };
            }

            case 'update_deployment_status': {
                const { deploymentId, status: newStatus } = args as {
                    deploymentId: string;
                    status: 'planned' | 'active' | 'standby' | 'completed' | 'cancelled';
                };

                const now = new Date();
                const updateData: Record<string, any> = {
                    status: newStatus,
                    updatedAt: now,
                };

                if (newStatus === 'active') {
                    updateData.actualStart = now;
                } else if (newStatus === 'completed' || newStatus === 'cancelled') {
                    updateData.actualEnd = now;
                }

                await db.update(deployments)
                    .set(updateData)
                    .where(eq(deployments.id, deploymentId));

                const updated = await db.select().from(deployments).where(eq(deployments.id, deploymentId));

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            message: `Deployment status updated to ${newStatus}`,
                            deployment: updated[0],
                        }, null, 2),
                    }],
                };
            }

            // ========== CONNECTIVITY CHAINS ==========
            case 'create_connectivity_chain': {
                const { name: chainName, sourceType, sourceId, targetType, targetId, links } = args as {
                    name: string;
                    sourceType: 'device' | 'network' | 'vehicle' | 'deployment';
                    sourceId: string;
                    targetType: 'network' | 'site' | 'device';
                    targetId: string;
                    links?: Array<{
                        linkType: string;
                        label?: string;
                        deviceId?: string;
                        networkId?: string;
                    }>;
                };

                const chainId = generateId();

                await db.insert(connectivityChains).values({
                    id: chainId,
                    name: chainName,
                    sourceType,
                    sourceId,
                    targetType,
                    targetId,
                    status: 'unknown',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });

                if (links && links.length > 0) {
                    for (let i = 0; i < links.length; i++) {
                        await db.insert(chainLinks).values({
                            id: generateId(),
                            chainId,
                            order: i + 1,
                            linkType: links[i].linkType as any,
                            label: links[i].label || null,
                            deviceId: links[i].deviceId || null,
                            networkId: links[i].networkId || null,
                            status: 'unknown',
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        });
                    }
                }

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            chainId,
                            name: chainName,
                            linksCreated: links?.length || 0,
                        }, null, 2),
                    }],
                };
            }

            case 'get_connectivity_chain': {
                const { chainId, sourceType, sourceId } = args as {
                    chainId?: string;
                    sourceType?: string;
                    sourceId?: string;
                };

                let chain;
                if (chainId) {
                    const result = await db.select().from(connectivityChains).where(eq(connectivityChains.id, chainId));
                    chain = result[0];
                } else if (sourceType && sourceId) {
                    const result = await db.select().from(connectivityChains)
                        .where(and(
                            eq(connectivityChains.sourceType, sourceType as any),
                            eq(connectivityChains.sourceId, sourceId)
                        ));
                    chain = result[0];
                }

                if (!chain) {
                    return {
                        content: [{ type: 'text', text: JSON.stringify({ error: 'Chain not found' }) }],
                    };
                }

                const links = await db.select().from(chainLinks)
                    .where(eq(chainLinks.chainId, chain.id));

                const linkIcons: Record<string, string> = {
                    starlink: '🛰️',
                    cellular_4g: '📶',
                    cellular_5g: '📶',
                    fiber: '🔵',
                    zerotier: '🔒',
                    wireguard: '🔐',
                    tailscale: '🔗',
                    cloudflare_tunnel: '☁️',
                    direct: '→',
                };

                const visualChain = links
                    .sort((a, b) => a.order - b.order)
                    .map(l => `${linkIcons[l.linkType] || '○'} ${l.label || l.linkType}`)
                    .join(' → ');

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            chain,
                            links: links.sort((a, b) => a.order - b.order),
                            visual: `
┌─────────────────────────────────────────────────────────────┐
│  🔗 CONNECTIVITY CHAIN: ${chain.name.padEnd(33)}│
├─────────────────────────────────────────────────────────────┤
│  ${visualChain.padEnd(57)}│
└─────────────────────────────────────────────────────────────┘`,
                        }, null, 2),
                    }],
                };
            }

            // ========== TRUST ZONE QUERIES ==========
            case 'get_trust_status': {
                const { deviceId, networkId } = args as { deviceId?: string; networkId?: string };

                let trustInfo: any = { zones: { trusted: [], untrusted: [], semiTrusted: [] } };

                if (networkId) {
                    const network = await db.select().from(networks).where(eq(networks.id, networkId));
                    if (network[0]) {
                        trustInfo = {
                            network: network[0],
                            trustZone: network[0].trustZone,
                            isFriendly: network[0].trustZone === 'trusted',
                            isHostile: network[0].trustZone === 'untrusted',
                        };
                    }
                } else {
                    const allNetworks = await db.select().from(networks);
                    trustInfo.zones.trusted = allNetworks.filter(n => n.trustZone === 'trusted').map(n => n.name);
                    trustInfo.zones.untrusted = allNetworks.filter(n => n.trustZone === 'untrusted').map(n => n.name);
                    trustInfo.zones.semiTrusted = allNetworks.filter(n => n.trustZone === 'semi-trusted').map(n => n.name);

                    trustInfo.summary = {
                        trusted: trustInfo.zones.trusted.length,
                        untrusted: trustInfo.zones.untrusted.length,
                        semiTrusted: trustInfo.zones.semiTrusted.length,
                    };
                }

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            ...trustInfo,
                            visual: `
┌─────────────────────────────────────────────────────────────┐
│  🛡️ TRUST ZONE STATUS                                       │
├─────────────────────────────────────────────────────────────┤
│  🟢 TRUSTED:      ${String(trustInfo.summary?.trusted || 0).padEnd(40)}│
│  🟡 SEMI-TRUSTED: ${String(trustInfo.summary?.semiTrusted || 0).padEnd(40)}│
│  🔴 UNTRUSTED:    ${String(trustInfo.summary?.untrusted || 0).padEnd(40)}│
└─────────────────────────────────────────────────────────────┘`,
                        }, null, 2),
                    }],
                };
            }

            case 'list_networks_by_trust': {
                const { trustZone } = args as { trustZone?: 'trusted' | 'untrusted' | 'semi-trusted' };

                let query = db.select().from(networks);
                if (trustZone) {
                    query = query.where(eq(networks.trustZone, trustZone)) as typeof query;
                }

                const result = await query;

                const grouped = {
                    trusted: result.filter(n => n.trustZone === 'trusted'),
                    untrusted: result.filter(n => n.trustZone === 'untrusted'),
                    semiTrusted: result.filter(n => n.trustZone === 'semi-trusted'),
                    unknown: result.filter(n => !n.trustZone || n.trustZone === 'unknown'),
                };

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            grouped,
                            summary: {
                                trusted: grouped.trusted.length,
                                untrusted: grouped.untrusted.length,
                                semiTrusted: grouped.semiTrusted.length,
                                unknown: grouped.unknown.length,
                            },
                        }, null, 2),
                    }],
                };
            }

            // ========== INFRASTRUCTURE MAP ==========
            case 'get_infrastructure_map': {
                const { includeOffline, groupBy } = args as { includeOffline?: boolean; groupBy?: string };

                const allSites = await db.select().from(sites);
                const allDevices = await db.select().from(devices);
                const allNetworks = await db.select().from(networks);
                const allVehicles = await db.select().from(vehicles);
                const allDeployments = await db.select().from(deployments);

                const nocSites = allSites.filter(s => s.role === 'noc');
                const remoteSites = allSites.filter(s => s.role === 'remote');
                const onlineDevices = allDevices.filter(d => d.status === 'online');
                const offlineDevices = allDevices.filter(d => d.status === 'offline');
                const trustedNetworks = allNetworks.filter(n => n.trustZone === 'trusted');
                const activeDeployments = allDeployments.filter(d => d.status === 'active');

                const map = {
                    banner: `
╔═══════════════════════════════════════════════════════════════╗
║  🌐 NETOPS INFRASTRUCTURE MAP                                 ║
║  Generated: ${new Date().toISOString().padEnd(46)}║
╠═══════════════════════════════════════════════════════════════╣
║  🏢 Sites: ${String(allSites.length).padEnd(8)} 📡 Devices: ${String(allDevices.length).padEnd(8)} 🔗 Networks: ${String(allNetworks.length).padEnd(4)}║
║  🚐 Vehicles: ${String(allVehicles.length).padEnd(5)} 🎪 Deployments: ${String(activeDeployments.length).padEnd(15)}║
╚═══════════════════════════════════════════════════════════════╝`,

                    hierarchy: {
                        noc: nocSites.map(s => ({
                            icon: '🏢',
                            name: s.name,
                            id: s.id,
                            role: 'NOC (Primary Hub)',
                        })),
                        remoteSites: remoteSites.map(s => ({
                            icon: '📹',
                            name: s.name,
                            id: s.id,
                            uplink: s.primaryUplinkType,
                            connectsTo: s.connectsToSiteId,
                        })),
                        vehicles: allVehicles.map(v => ({
                            icon: '🚐',
                            name: v.name,
                            id: v.id,
                            type: v.type,
                            currentSite: v.currentSiteId,
                        })),
                        activeDeployments: activeDeployments.map(d => ({
                            icon: '🎪',
                            name: d.name,
                            id: d.id,
                            type: d.type,
                            vehicle: d.vehicleId,
                        })),
                    },

                    trustZones: {
                        trusted: trustedNetworks.map(n => `🟢 ${n.name}`),
                        untrusted: allNetworks.filter(n => n.trustZone === 'untrusted').map(n => `🔴 ${n.name}`),
                        semiTrusted: allNetworks.filter(n => n.trustZone === 'semi-trusted').map(n => `🟡 ${n.name}`),
                    },

                    health: {
                        devicesOnline: onlineDevices.length,
                        devicesOffline: offlineDevices.length,
                        healthPercentage: allDevices.length > 0
                            ? Math.round((onlineDevices.length / allDevices.length) * 100)
                            : 100,
                    },

                    stats: {
                        sites: allSites.length,
                        devices: allDevices.length,
                        networks: allNetworks.length,
                        vehicles: allVehicles.length,
                        deployments: allDeployments.length,
                        activeDeployments: activeDeployments.length,
                    },
                };

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(map, null, 2),
                    }],
                };
            }

            // ========== NETWORK SCANNER HANDLERS ==========
            case 'get_local_networks': {
                const networks = await networkScanner.getLocalNetworks();

                const banner = `
╔═══════════════════════════════════════════════════════════════╗
║  🔍 LOCAL NETWORK INTERFACES                                  ║
╚═══════════════════════════════════════════════════════════════╝
`;
                const output = networks.map(n =>
                    `  ${n.interface.padEnd(12)} │ ${n.cidr.padEnd(20)} │ IP: ${n.ip}`
                ).join('\n');

                return {
                    content: [{
                        type: 'text',
                        text: banner + output + '\n\n💡 Use start_network_scan with any of these CIDRs',
                    }],
                };
            }

            case 'start_network_scan': {
                const { scanType, targetNetwork } = args as {
                    scanType: 'arp' | 'mdns' | 'port' | 'snmp' | 'full' | 'quick';
                    targetNetwork?: string;
                };

                const scanId = await networkScanner.startScan({
                    scanType,
                    targetNetwork,
                });

                const banner = `
╔═══════════════════════════════════════════════════════════════╗
║  🚀 NETWORK SCAN STARTED                                      ║
╚═══════════════════════════════════════════════════════════════╝

  Scan ID:      ${scanId}
  Type:         ${scanType.toUpperCase()}
  Target:       ${targetNetwork || 'Auto-detect'}
  Status:       RUNNING...
  
  💡 Use get_scan_status to monitor progress
  📋 Use list_discovered_devices to see results
`;

                return {
                    content: [{ type: 'text', text: banner }],
                };
            }

            case 'get_scan_status': {
                const { scanId } = args as { scanId: string };
                const scan = await networkScanner.getScanStatus(scanId);

                if (!scan) {
                    return {
                        content: [{ type: 'text', text: '❌ Scan not found' }],
                    };
                }

                const statusLookup: Record<string, string> = {
                    pending: '⏳',
                    running: '🔄',
                    completed: '✅',
                    failed: '❌',
                    cancelled: '🚫',
                };
                const statusIcon = statusLookup[scan.status || 'pending'] || '❓';

                const progressBar = '█'.repeat(Math.floor((scan.progress || 0) / 5)) +
                    '░'.repeat(20 - Math.floor((scan.progress || 0) / 5));

                const output = `
╔═══════════════════════════════════════════════════════════════╗
║  📊 SCAN STATUS                                               ║
╚═══════════════════════════════════════════════════════════════╝

  ID:           ${scan.id}
  Type:         ${scan.scanType.toUpperCase()}
  Target:       ${scan.targetNetwork || 'Auto'}
  Status:       ${statusIcon} ${(scan.status || 'pending').toUpperCase()}
  
  Progress:     [${progressBar}] ${scan.progress}%
  
  Devices Found:     ${scan.devicesFound || 0}
  New Devices:       ${scan.newDevicesFound || 0}
  
  Started:      ${scan.startedAt?.toISOString() || 'N/A'}
  Completed:    ${scan.completedAt?.toISOString() || 'In progress...'}
  Duration:     ${scan.durationMs ? `${scan.durationMs}ms` : 'N/A'}
  ${scan.errorMessage ? `\n  ⚠️ Error: ${scan.errorMessage}` : ''}
`;

                return {
                    content: [{ type: 'text', text: output }],
                };
            }

            case 'list_discovered_devices': {
                const { classification, showOnlyNew } = args as {
                    classification?: string;
                    showOnlyNew?: boolean;
                };

                let query = db.select().from(discoveredDevices);
                if (classification || showOnlyNew) {
                    query = query.where(eq(discoveredDevices.classification, (classification || 'unknown') as any)) as typeof query;
                }

                const allDevices = await query;

                const classificationIcons: Record<string, string> = {
                    known: '🟢',
                    unknown: '🔴',
                    suspicious: '⚠️',
                    authorized: '✅',
                    blocked: '🚫',
                };

                const typeIcons: Record<string, string> = {
                    router: '📡',
                    switch: '🔀',
                    access_point: '📶',
                    camera: '📹',
                    server: '🖥️',
                    workstation: '💻',
                    mobile: '📱',
                    iot: '🔌',
                    printer: '🖨️',
                    nas: '💾',
                    unknown: '❓',
                };

                const unknown = allDevices.filter(d => d.classification === 'unknown');
                const known = allDevices.filter(d => d.classification === 'known' || d.classification === 'authorized');
                const suspicious = allDevices.filter(d => d.classification === 'suspicious');
                const blocked = allDevices.filter(d => d.classification === 'blocked');

                let output = `
╔═══════════════════════════════════════════════════════════════════════════════╗
║  🔍 DISCOVERED DEVICES                                                        ║
╚═══════════════════════════════════════════════════════════════════════════════╝

  Total: ${allDevices.length}  │  🔴 Unknown: ${unknown.length}  │  🟢 Known: ${known.length}  │  ⚠️ Suspicious: ${suspicious.length}

`;

                if (unknown.length > 0) {
                    output += '\n  ┌─ 🔴 UNKNOWN DEVICES (NEEDS CLASSIFICATION) ─────────────────────────────┐\n';
                    for (const device of unknown.slice(0, 20)) {
                        const icon = typeIcons[device.deviceType || 'unknown'] || '❓';
                        const ports = device.openPorts ? ` [${(device.openPorts as number[]).join(',')}]` : '';
                        output += `  │ ${icon} ${device.ipAddress.padEnd(16)} ${(device.macAddress || '').padEnd(18)} ${(device.macVendor || 'Unknown vendor').padEnd(20)}${ports}\n`;
                        output += `  │   └─ ID: ${device.id}  │  Last seen: ${device.lastSeenAt?.toISOString().slice(0, 16) || 'N/A'}\n`;
                    }
                    output += '  └──────────────────────────────────────────────────────────────────────────┘\n';
                }

                if (known.length > 0 && !showOnlyNew) {
                    output += '\n  ┌─ 🟢 KNOWN/AUTHORIZED DEVICES ───────────────────────────────────────────┐\n';
                    for (const device of known.slice(0, 15)) {
                        const icon = typeIcons[device.deviceType || 'unknown'] || '✅';
                        output += `  │ ${icon} ${device.ipAddress.padEnd(16)} ${(device.macAddress || '').padEnd(18)} ${(device.macVendor || 'Unknown').padEnd(20)} ${device.hostname || ''}\n`;
                    }
                    output += '  └──────────────────────────────────────────────────────────────────────────┘\n';
                }

                if (suspicious.length > 0) {
                    output += '\n  ┌─ ⚠️ SUSPICIOUS DEVICES ──────────────────────────────────────────────────┐\n';
                    for (const device of suspicious) {
                        output += `  │ ⚠️ ${device.ipAddress.padEnd(16)} ${(device.macAddress || '').padEnd(18)} ${device.notes || 'Flagged for review'}\n`;
                    }
                    output += '  └──────────────────────────────────────────────────────────────────────────┘\n';
                }

                output += '\n💡 Use classify_device to mark devices as known/suspicious/authorized/blocked';

                return {
                    content: [{ type: 'text', text: output }],
                };
            }

            case 'classify_device': {
                const { deviceId, classification, notes, linkToDeviceId } = args as {
                    deviceId: string;
                    classification: 'known' | 'unknown' | 'suspicious' | 'authorized' | 'blocked';
                    notes?: string;
                    linkToDeviceId?: string;
                };

                await networkScanner.classifyDevice(deviceId, classification, notes);

                if (linkToDeviceId) {
                    await db.update(discoveredDevices)
                        .set({ linkedDeviceId: linkToDeviceId })
                        .where(eq(discoveredDevices.id, deviceId));
                }

                const icons: Record<string, string> = {
                    known: '🟢',
                    unknown: '🔴',
                    suspicious: '⚠️',
                    authorized: '✅',
                    blocked: '🚫',
                };

                return {
                    content: [{
                        type: 'text',
                        text: `${icons[classification]} Device ${deviceId} classified as ${classification.toUpperCase()}${notes ? `\n📝 Notes: ${notes}` : ''}`,
                    }],
                };
            }

            case 'get_network_map': {
                const { format } = args as { format?: 'visual' | 'json' | 'mermaid' };
                const mapData = await networkScanner.getNetworkMapData();

                if (format === 'json') {
                    return {
                        content: [{ type: 'text', text: JSON.stringify(mapData, null, 2) }],
                    };
                }

                if (format === 'mermaid') {
                    let mermaid = 'graph TD\n';

                    // Add gateway first (assume first known router)
                    const gateways = mapData.nodes.filter(n => n.type === 'router' && n.classification !== 'unknown');
                    const gateway = gateways[0];

                    for (const node of mapData.nodes) {
                        const shape = node.classification === 'unknown' ? '{{' : '(';
                        const endShape = node.classification === 'unknown' ? '}}' : ')';
                        const label = node.label || node.ip;
                        mermaid += `    ${node.id}${shape}"${label}"${endShape}\n`;
                    }

                    // Connect all to gateway
                    if (gateway) {
                        for (const node of mapData.nodes.filter(n => n.id !== gateway.id)) {
                            const style = node.classification === 'unknown' ? '-.->|?|' : '-->';
                            mermaid += `    ${gateway.id} ${style} ${node.id}\n`;
                        }
                    }

                    return {
                        content: [{ type: 'text', text: '```mermaid\n' + mermaid + '```' }],
                    };
                }

                // Visual ASCII map
                const classificationIcons: Record<string, string> = {
                    known: '🟢',
                    unknown: '🔴',
                    suspicious: '⚠️',
                    authorized: '✅',
                    blocked: '🚫',
                };

                const typeIcons: Record<string, string> = {
                    router: '📡',
                    switch: '🔀',
                    access_point: '📶',
                    camera: '📹',
                    server: '🖥️',
                    workstation: '💻',
                    mobile: '📱',
                    iot: '🔌',
                    printer: '🖨️',
                    nas: '💾',
                    unknown: '❓',
                };

                const gateways = mapData.nodes.filter(n => n.type === 'router');
                const others = mapData.nodes.filter(n => n.type !== 'router');

                let visual = `
╔═══════════════════════════════════════════════════════════════════════════════╗
║  🗺️ NETWORK TOPOLOGY MAP                                                      ║
╚═══════════════════════════════════════════════════════════════════════════════╝

`;

                // Show gateway/router at top
                if (gateways.length > 0) {
                    visual += '                           ┌───────────────────┐\n';
                    for (const gw of gateways) {
                        const icon = classificationIcons[gw.classification || 'unknown'];
                        visual += `                           │ 📡 ${gw.ip.padEnd(15)} │ ${icon}\n`;
                    }
                    visual += '                           └─────────┬─────────┘\n';
                    visual += '                                     │\n';
                    visual += '                    ┌────────────────┼────────────────┐\n';
                    visual += '                    │                │                │\n';
                }

                // Group by type
                const byType: Record<string, typeof others> = {};
                for (const node of others) {
                    const type = node.type || 'unknown';
                    if (!byType[type]) byType[type] = [];
                    byType[type].push(node);
                }

                for (const [type, nodes] of Object.entries(byType)) {
                    const icon = typeIcons[type] || '❓';
                    visual += `\n    ${icon} ${type.toUpperCase()} (${nodes.length})\n`;
                    visual += '    ├──────────────────────────────────────────────────────────────────\n';
                    for (const node of nodes.slice(0, 10)) {
                        const status = classificationIcons[node.classification || 'unknown'];
                        const vendor = node.vendor ? ` (${node.vendor})` : '';
                        const hostname = node.label !== node.ip ? ` - ${node.label}` : '';
                        visual += `    │  ${status} ${node.ip.padEnd(16)} ${(node.mac || '').padEnd(18)}${vendor}${hostname}\n`;
                    }
                    if (nodes.length > 10) {
                        visual += `    │  ... and ${nodes.length - 10} more\n`;
                    }
                }

                visual += `
────────────────────────────────────────────────────────────────────────────────
Legend: 🟢 Known  🔴 Unknown  ⚠️ Suspicious  ✅ Authorized  🚫 Blocked
`;

                return {
                    content: [{ type: 'text', text: visual }],
                };
            }

            case 'get_scan_history': {
                const { limit } = args as { limit?: number };
                const history = await networkScanner.getScanHistory(limit || 10);

                if (history.length === 0) {
                    return {
                        content: [{ type: 'text', text: '📋 No scan history yet. Use start_network_scan to begin.' }],
                    };
                }

                const statusIcons: Record<string, string> = {
                    pending: '⏳',
                    running: '🔄',
                    completed: '✅',
                    failed: '❌',
                    cancelled: '🚫',
                };

                let output = `
╔═══════════════════════════════════════════════════════════════════════════════╗
║  📋 SCAN HISTORY                                                              ║
╚═══════════════════════════════════════════════════════════════════════════════╝

`;

                for (const scan of history) {
                    const icon = statusIcons[scan.status || 'pending'] || '❓';
                    const date = scan.createdAt?.toISOString().slice(0, 16) || 'Unknown';
                    output += `  ${icon} ${scan.id.slice(0, 8)}...  │  ${scan.scanType.padEnd(6)}  │  ${scan.targetNetwork?.padEnd(18) || 'Auto'.padEnd(18)}  │  Found: ${String(scan.devicesFound || 0).padStart(3)}  │  ${date}\n`;
                }

                return {
                    content: [{ type: 'text', text: output }],
                };
            }

            default:
                return {
                    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            content: [{ type: 'text', text: `Error executing ${name}: ${message}` }],
            isError: true,
        };
    }
});

// Main entry point
async function main() {
    // Initialize database
    await initializeDatabase();

    // Start MCP server
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('[NetOps MCP] Server running');
}

main().catch(console.error);
