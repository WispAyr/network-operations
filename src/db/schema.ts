import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ============================================
// PHYSICAL HIERARCHY
// ============================================

/**
 * Sites represent major physical or logical groupings
 * Examples: "Main Office", "Data Center", "Customer A", "NOC"
 * 
 * Site Roles:
 * - noc: Network Operations Center (primary monitoring hub)
 * - hq: Headquarters / main office
 * - remote: Remote site (camera sites, field offices)
 * - field: Field deployment location
 * - customer: Customer site
 * - datacenter: Data center / hosting
 */
export const sites = sqliteTable('sites', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),

    // Site classification
    role: text('role').$type<'noc' | 'hq' | 'remote' | 'field' | 'customer' | 'datacenter' | 'other'>().default('other'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).default(false), // Is this a primary/hub site?

    // Location
    address: text('address'),
    latitude: real('latitude'),
    longitude: real('longitude'),

    // Connectivity back to core
    primaryUplinkType: text('primary_uplink_type').$type<'fiber' | 'cellular' | 'starlink' | 'wireless' | 'vpn' | 'cloud_key' | 'other'>(),
    backupUplinkType: text('backup_uplink_type').$type<'fiber' | 'cellular' | 'starlink' | 'wireless' | 'vpn' | 'cloud_key' | 'other'>(),
    connectsToSiteId: text('connects_to_site_id'), // Which primary site this connects to (e.g., NOC)

    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/**
 * Locations are specific places within a site
 * Examples: "Server Room", "Gate House", "Parking Lot"
 */
export const locations = sqliteTable('locations', {
    id: text('id').primaryKey(),
    siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').$type<'building' | 'room' | 'outdoor' | 'cabinet' | 'other'>().default('other'),
    description: text('description'),
    floor: text('floor'),
    coordinates: text('coordinates'), // e.g., "A3" for a grid reference
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/**
 * Vehicles are mobile locations that can move between sites
 * Examples: "Service Van 1", "Company Car"
 */
export const vehicles = sqliteTable('vehicles', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    type: text('type').$type<'van' | 'car' | 'truck' | 'trailer' | 'other'>().default('other'),
    registration: text('registration'),
    currentSiteId: text('current_site_id').references(() => sites.id),
    lastKnownLatitude: real('last_known_latitude'),
    lastKnownLongitude: real('last_known_longitude'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ============================================
// NETWORK TOPOLOGY
// ============================================

/**
 * Network topologies represent different networking technologies
 * Examples: ZeroTier, UniFi, UISP, LAN, WAN
 */
export const topologies = sqliteTable('topologies', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull().$type<'zerotier' | 'unifi' | 'uisp' | 'lan' | 'wan' | 'tailscale' | 'wireguard' | 'cloudflare' | 'other'>(),
    description: text('description'),
    platformConfig: text('platform_config', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/**
 * Networks are logical network segments within a topology
 * Examples: "192.168.1.0/24", "ZeroTier Office Network"
 * 
 * Network Roles:
 * - core: Always-on backbone networks (ZeroTier, WireGuard VPNs)
 * - local: Networks provided locally (Starlink, site WiFi)
 * - edge: Edge networks at deployment sites (festival WiFi)
 * - transit: Networks used for transport/backhaul only
 */
export const networks = sqliteTable('networks', {
    id: text('id').primaryKey(),
    topologyId: text('topology_id').notNull().references(() => topologies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),

    // Network classification
    role: text('role').$type<'core' | 'local' | 'edge' | 'transit'>().default('local'),
    scope: text('scope').$type<'global' | 'site' | 'vehicle' | 'temporary'>().default('site'),

    // Trust zone - security classification
    // trusted: Internal/friendly networks (ZeroTier, office LAN, VPNs)
    // untrusted: Hostile networks (public internet, coffee shop WiFi)
    // semi-trusted: Partially trusted (customer networks, guest WiFi)
    trustZone: text('trust_zone').$type<'trusted' | 'untrusted' | 'semi-trusted' | 'unknown'>().default('unknown'),
    requiresVpn: integer('requires_vpn', { mode: 'boolean' }).default(false), // Must traverse VPN to reach trusted

    // Provider relationship - which device/vehicle provides this network
    providerDeviceId: text('provider_device_id').references(() => devices.id),
    providerVehicleId: text('provider_vehicle_id').references(() => vehicles.id),

    // Upstream connectivity - how this network reaches the core
    upstreamNetworkId: text('upstream_network_id'), // References another network for backhaul
    upstreamType: text('upstream_type').$type<'starlink' | 'cellular' | 'fiber' | 'wireless_bridge' | 'vpn' | 'direct' | 'other'>(),

    // Standard network properties
    cidr: text('cidr'), // e.g., "192.168.1.0/24"
    vlan: integer('vlan'),
    platformNetworkId: text('platform_network_id'), // ID from external platform (ZeroTier network ID, etc.)
    gatewayIp: text('gateway_ip'),
    dnsServers: text('dns_servers', { mode: 'json' }).$type<string[]>(),
    status: text('status').$type<'active' | 'inactive' | 'degraded' | 'unknown'>().default('unknown'),

    // Capacity and monitoring
    maxClients: integer('max_clients'),
    currentClients: integer('current_clients'),
    bandwidthMbps: integer('bandwidth_mbps'),

    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ============================================
// DEVICES
// ============================================

/**
 * Devices are network-connected equipment
 * Examples: "Barrier Controller", "Cloud Key", "Router", "Camera"
 */
export const devices = sqliteTable('devices', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull().$type<
        'router' | 'switch' | 'access_point' | 'gateway' | 'server' |
        'camera' | 'controller' | 'sensor' | 'iot' | 'workstation' | 'other'
    >(),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    firmwareVersion: text('firmware_version'),

    // Location (either in a fixed location or a vehicle, but not both)
    locationId: text('location_id').references(() => locations.id),
    vehicleId: text('vehicle_id').references(() => vehicles.id),

    // Status
    status: text('status').$type<'online' | 'offline' | 'degraded' | 'unknown'>().default('unknown'),
    lastSeen: integer('last_seen', { mode: 'timestamp' }),

    // Primary connection info
    primaryIp: text('primary_ip'),
    primaryMac: text('primary_mac'),
    hostname: text('hostname'),

    // Access configuration
    managementUrl: text('management_url'), // e.g., "https://192.168.1.1"
    sshPort: integer('ssh_port'),
    httpPort: integer('http_port'),

    // Platform integration
    platformType: text('platform_type').$type<'zerotier' | 'unifi' | 'uisp' | 'manual' | 'other'>(),
    platformDeviceId: text('platform_device_id'), // ID from external platform

    // Metadata
    notes: text('notes'),
    tags: text('tags', { mode: 'json' }).$type<string[]>(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/**
 * Links between devices and networks (many-to-many)
 * A device can have interfaces on multiple networks
 */
export const deviceNetworkLinks = sqliteTable('device_network_links', {
    id: text('id').primaryKey(),
    deviceId: text('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    networkId: text('network_id').notNull().references(() => networks.id, { onDelete: 'cascade' }),
    ipAddress: text('ip_address'),
    macAddress: text('mac_address'),
    interfaceName: text('interface_name'), // e.g., "eth0", "wlan0"
    isManagementInterface: integer('is_management_interface', { mode: 'boolean' }).default(false),
    platformMemberId: text('platform_member_id'), // ID from external platform
    status: text('status').$type<'active' | 'inactive' | 'unknown'>().default('unknown'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ============================================
// ACCESS PATHS
// ============================================

/**
 * Access paths define how to reach a device through multiple hops
 * This is the key feature for visualizing complex access chains
 */
export const accessPaths = sqliteTable('access_paths', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    targetDeviceId: text('target_device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    isDefault: integer('is_default', { mode: 'boolean' }).default(false),
    lastTestedAt: integer('last_tested_at', { mode: 'timestamp' }),
    lastTestStatus: text('last_test_status').$type<'success' | 'partial' | 'failed' | 'unknown'>().default('unknown'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/**
 * Individual hops within an access path
 * Ordered sequence of steps to reach the target device
 */
export const pathHops = sqliteTable('path_hops', {
    id: text('id').primaryKey(),
    pathId: text('path_id').notNull().references(() => accessPaths.id, { onDelete: 'cascade' }),
    order: integer('order').notNull(), // 1, 2, 3, etc.

    // Type of hop
    type: text('type').notNull().$type<
        'zerotier' | 'unifi_vpn' | 'ssh_tunnel' | 'http_proxy' |
        'wireguard' | 'tailscale' | 'cloudflare_tunnel' | 'direct' | 'rdp' | 'other'
    >(),

    // Connection details
    hostDeviceId: text('host_device_id').references(() => devices.id), // Device providing this hop
    targetAddress: text('target_address').notNull(), // IP or hostname
    targetPort: integer('target_port'),

    // Hop-specific configuration
    config: text('config', { mode: 'json' }).$type<{
        // SSH tunnel specific
        sshUser?: string;
        sshKeyPath?: string;
        localPort?: number;
        remotePort?: number;

        // HTTP proxy specific
        proxyPath?: string;

        // VPN specific
        networkId?: string;

        // Generic
        timeout?: number;
        [key: string]: unknown;
    }>(),

    // Status
    status: text('status').$type<'up' | 'down' | 'unknown'>().default('unknown'),
    lastCheckedAt: integer('last_checked_at', { mode: 'timestamp' }),
    lastLatencyMs: integer('last_latency_ms'),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ============================================
// DEPLOYMENTS (Temporary/Hybrid Scenarios)
// ============================================

/**
 * Deployments represent temporary network setups
 * Examples: Festival site, pop-up event, disaster response
 * 
 * A vehicle can be "deployed" to a site, bringing its own networks
 * that become part of that site's infrastructure temporarily
 */
export const deployments = sqliteTable('deployments', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),

    // What's being deployed
    vehicleId: text('vehicle_id').references(() => vehicles.id),

    // Where it's deployed
    siteId: text('site_id').references(() => sites.id),
    locationId: text('location_id').references(() => locations.id),

    // Or custom location
    latitude: real('latitude'),
    longitude: real('longitude'),
    address: text('address'),

    // Deployment type
    type: text('type').$type<'festival' | 'event' | 'emergency' | 'construction' | 'temporary' | 'macc' | 'other'>().default('temporary'),

    // Status and timing
    status: text('status').$type<'planned' | 'active' | 'standby' | 'completed' | 'cancelled'>().default('planned'),
    scheduledStart: integer('scheduled_start', { mode: 'timestamp' }),
    scheduledEnd: integer('scheduled_end', { mode: 'timestamp' }),
    actualStart: integer('actual_start', { mode: 'timestamp' }),
    actualEnd: integer('actual_end', { mode: 'timestamp' }),

    // Monitoring relationship (e.g., MACC monitors this deployment)
    monitoredByDeploymentId: text('monitored_by_deployment_id'),

    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/**
 * Connectivity chains show how a network/device reaches the core
 * Useful for visualizing: Van → Starlink → Internet → ZeroTier → Core
 */
export const connectivityChains = sqliteTable('connectivity_chains', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),

    // Source (where the chain starts)
    sourceType: text('source_type').$type<'device' | 'network' | 'vehicle' | 'deployment'>().notNull(),
    sourceId: text('source_id').notNull(),

    // Target (where it needs to reach)
    targetType: text('target_type').$type<'network' | 'site' | 'device'>().notNull(),
    targetId: text('target_id').notNull(),

    // Chain status
    status: text('status').$type<'connected' | 'degraded' | 'disconnected' | 'unknown'>().default('unknown'),
    lastTestedAt: integer('last_tested_at', { mode: 'timestamp' }),

    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/**
 * Individual links in a connectivity chain
 */
export const chainLinks = sqliteTable('chain_links', {
    id: text('id').primaryKey(),
    chainId: text('chain_id').notNull().references(() => connectivityChains.id, { onDelete: 'cascade' }),
    order: integer('order').notNull(),

    // What this link represents
    linkType: text('link_type').$type<
        'starlink' | 'cellular_4g' | 'cellular_5g' | 'fiber' | 'dsl' |
        'wireless_bridge' | 'zerotier' | 'wireguard' | 'tailscale' |
        'unifi_vpn' | 'cloudflare_tunnel' | 'direct' | 'other'
    >().notNull(),

    // Through what device/network
    deviceId: text('device_id').references(() => devices.id),
    networkId: text('network_id').references(() => networks.id),

    // Link properties
    label: text('label'), // e.g., "Starlink Terminal", "ZeroTier Overlay"
    latencyMs: integer('latency_ms'),
    bandwidthMbps: integer('bandwidth_mbps'),
    status: text('status').$type<'up' | 'degraded' | 'down' | 'unknown'>().default('unknown'),

    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ============================================
// RELATIONS
// ============================================

export const sitesRelations = relations(sites, ({ many }) => ({
    locations: many(locations),
    vehicles: many(vehicles),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
    site: one(sites, { fields: [locations.siteId], references: [sites.id] }),
    devices: many(devices),
}));

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
    currentSite: one(sites, { fields: [vehicles.currentSiteId], references: [sites.id] }),
    devices: many(devices),
}));

export const topologiesRelations = relations(topologies, ({ many }) => ({
    networks: many(networks),
}));

export const networksRelations = relations(networks, ({ one, many }) => ({
    topology: one(topologies, { fields: [networks.topologyId], references: [topologies.id] }),
    deviceLinks: many(deviceNetworkLinks),
}));

export const devicesRelations = relations(devices, ({ one, many }) => ({
    location: one(locations, { fields: [devices.locationId], references: [locations.id] }),
    vehicle: one(vehicles, { fields: [devices.vehicleId], references: [vehicles.id] }),
    networkLinks: many(deviceNetworkLinks),
    accessPaths: many(accessPaths),
}));

export const deviceNetworkLinksRelations = relations(deviceNetworkLinks, ({ one }) => ({
    device: one(devices, { fields: [deviceNetworkLinks.deviceId], references: [devices.id] }),
    network: one(networks, { fields: [deviceNetworkLinks.networkId], references: [networks.id] }),
}));

export const accessPathsRelations = relations(accessPaths, ({ one, many }) => ({
    targetDevice: one(devices, { fields: [accessPaths.targetDeviceId], references: [devices.id] }),
    hops: many(pathHops),
}));

export const pathHopsRelations = relations(pathHops, ({ one }) => ({
    path: one(accessPaths, { fields: [pathHops.pathId], references: [accessPaths.id] }),
    hostDevice: one(devices, { fields: [pathHops.hostDeviceId], references: [devices.id] }),
}));

// ============================================
// TYPE EXPORTS
// ============================================

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

export type Topology = typeof topologies.$inferSelect;
export type NewTopology = typeof topologies.$inferInsert;

export type Network = typeof networks.$inferSelect;
export type NewNetwork = typeof networks.$inferInsert;

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;

export type DeviceNetworkLink = typeof deviceNetworkLinks.$inferSelect;
export type NewDeviceNetworkLink = typeof deviceNetworkLinks.$inferInsert;

export type AccessPath = typeof accessPaths.$inferSelect;
export type NewAccessPath = typeof accessPaths.$inferInsert;

export type PathHop = typeof pathHops.$inferSelect;
export type NewPathHop = typeof pathHops.$inferInsert;

export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;

export type ConnectivityChain = typeof connectivityChains.$inferSelect;
export type NewConnectivityChain = typeof connectivityChains.$inferInsert;

export type ChainLink = typeof chainLinks.$inferSelect;
export type NewChainLink = typeof chainLinks.$inferInsert;

// ============================================
// NETWORK SCANNING & DISCOVERY
// ============================================

/**
 * Network scans track individual scan operations
 * Includes ARP, mDNS, port scans, etc.
 */
export const networkScans = sqliteTable('network_scans', {
    id: text('id').primaryKey(),

    // Scan parameters
    scanType: text('scan_type').$type<'arp' | 'mdns' | 'port' | 'snmp' | 'full' | 'quick'>().notNull(),
    targetNetwork: text('target_network'), // CIDR to scan, e.g., "192.168.1.0/24"
    targetNetworkId: text('target_network_id').references(() => networks.id),

    // Scan source - where was scan initiated from
    sourceDeviceId: text('source_device_id').references(() => devices.id),
    sourceSiteId: text('source_site_id').references(() => sites.id),

    // Status and results
    status: text('status').$type<'pending' | 'running' | 'completed' | 'failed' | 'cancelled'>().default('pending'),
    progress: integer('progress').default(0), // 0-100
    devicesFound: integer('devices_found').default(0),
    newDevicesFound: integer('new_devices_found').default(0),

    // Timing
    startedAt: integer('started_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    durationMs: integer('duration_ms'),

    // Error info
    errorMessage: text('error_message'),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/**
 * Discovered devices from network scans
 * These are raw discoveries - may or may not be linked to known devices
 */
export const discoveredDevices = sqliteTable('discovered_devices', {
    id: text('id').primaryKey(),

    // Discovery info
    ipAddress: text('ip_address').notNull(),
    macAddress: text('mac_address'), // May be unavailable for devices on different subnets
    hostname: text('hostname'),

    // MAC vendor info (from OUI database)
    macVendor: text('mac_vendor'),
    macVendorFull: text('mac_vendor_full'),

    // Classification
    classification: text('classification').$type<'known' | 'unknown' | 'suspicious' | 'authorized' | 'blocked'>().default('unknown'),
    deviceType: text('device_type').$type<'router' | 'switch' | 'access_point' | 'camera' | 'server' | 'workstation' | 'mobile' | 'iot' | 'printer' | 'nas' | 'unknown'>().default('unknown'),

    // Link to known device (if matched)
    linkedDeviceId: text('linked_device_id').references(() => devices.id),

    // Network context
    networkId: text('network_id').references(() => networks.id),
    siteId: text('site_id').references(() => sites.id),
    vlan: integer('vlan'),

    // Discovery details
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull(),
    lastScanId: text('last_scan_id').references(() => networkScans.id),

    // Response data
    responseTimeMs: integer('response_time_ms'),
    isReachable: integer('is_reachable', { mode: 'boolean' }).default(true),

    // Open ports (from port scan)
    openPorts: text('open_ports', { mode: 'json' }).$type<number[]>(),
    services: text('services', { mode: 'json' }).$type<{ port: number; service: string; version?: string }[]>(),

    // mDNS/Bonjour info
    mdnsName: text('mdns_name'),
    mdnsServices: text('mdns_services', { mode: 'json' }).$type<string[]>(),

    // SNMP info
    snmpSysName: text('snmp_sys_name'),
    snmpSysDescr: text('snmp_sys_descr'),
    snmpSysContact: text('snmp_sys_contact'),
    snmpSysLocation: text('snmp_sys_location'),

    // User notes
    notes: text('notes'),
    tags: text('tags', { mode: 'json' }).$type<string[]>(),

    // Alerts
    alertOnDisappear: integer('alert_on_disappear', { mode: 'boolean' }).default(false),
    alertOnNewDevice: integer('alert_on_new_device', { mode: 'boolean' }).default(true),

    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/**
 * MAC vendor database for OUI lookups
 * Populated from IEEE OUI database
 */
export const macVendors = sqliteTable('mac_vendors', {
    id: text('id').primaryKey(), // The OUI prefix, e.g., "00:1A:2B"
    vendorShort: text('vendor_short').notNull(), // Short name
    vendorFull: text('vendor_full'), // Full company name

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/**
 * Network topology connections discovered from scanning
 * Maps relationships between discovered devices
 */
export const discoveredConnections = sqliteTable('discovered_connections', {
    id: text('id').primaryKey(),

    // Connection endpoints
    sourceDeviceId: text('source_device_id').notNull().references(() => discoveredDevices.id, { onDelete: 'cascade' }),
    targetDeviceId: text('target_device_id').notNull().references(() => discoveredDevices.id, { onDelete: 'cascade' }),

    // Connection type
    connectionType: text('connection_type').$type<'gateway' | 'peer' | 'switch' | 'wireless' | 'vpn' | 'unknown'>().default('unknown'),

    // Confidence (0-100) based on evidence
    confidence: integer('confidence').default(50),

    // Evidence for the connection
    evidence: text('evidence', { mode: 'json' }).$type<{
        arpTable?: boolean;
        traceroute?: boolean;
        sameSubnet?: boolean;
        lldp?: boolean;
        cdp?: boolean;
    }>(),

    lastVerifiedAt: integer('last_verified_at', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Type exports for new scanner tables
export type NetworkScan = typeof networkScans.$inferSelect;
export type NewNetworkScan = typeof networkScans.$inferInsert;

export type DiscoveredDevice = typeof discoveredDevices.$inferSelect;
export type NewDiscoveredDevice = typeof discoveredDevices.$inferInsert;

export type MacVendor = typeof macVendors.$inferSelect;
export type NewMacVendor = typeof macVendors.$inferInsert;

export type DiscoveredConnection = typeof discoveredConnections.$inferSelect;
export type NewDiscoveredConnection = typeof discoveredConnections.$inferInsert;
