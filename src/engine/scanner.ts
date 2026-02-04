/**
 * Network Scanner Service
 * 
 * Provides local network discovery capabilities:
 * - ARP scanning (fast local discovery)
 * - Port scanning (service detection)
 * - mDNS/Bonjour discovery
 * - SNMP device info
 * - MAC vendor lookup
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { networkInterfaces } from 'os';
import { db } from '../db/index.js';
import { networkScans, discoveredDevices, discoveredConnections, macVendors } from '../db/schema.js';
import { generateId } from '../utils/helpers.js';
import { eq, and, or, like } from 'drizzle-orm';

const execAsync = promisify(exec);

// MAC OUI vendor database (common vendors - in production, load full IEEE database)
const COMMON_MAC_VENDORS: Record<string, string> = {
    '00:50:56': 'VMware',
    '00:0C:29': 'VMware',
    '00:1C:42': 'Parallels',
    '00:16:3E': 'Xen',
    'AC:DE:48': 'Private',
    '00:1A:79': 'Ubiquiti',
    '00:27:22': 'Ubiquiti',
    '24:5A:4C': 'Ubiquiti',
    '78:8A:20': 'Ubiquiti',
    'DC:9F:DB': 'Ubiquiti',
    'E0:63:DA': 'Ubiquiti',
    'F0:9F:C2': 'Ubiquiti',
    '18:E8:29': 'Ubiquiti',
    '80:2A:A8': 'Ubiquiti',
    '74:83:C2': 'Ubiquiti',
    'B4:FB:E4': 'Ubiquiti',
    '44:D9:E7': 'Ubiquiti',
    '60:22:32': 'Ubiquiti',
    '68:D7:9A': 'Ubiquiti',
    '78:45:58': 'Ubiquiti',
    'AC:8B:A9': 'Ubiquiti',
    'D0:21:F9': 'Synology',
    '00:11:32': 'Synology',
    '00:1E:C9': 'Dell',
    '00:14:22': 'Dell',
    '00:21:9B': 'Dell',
    '14:FE:B5': 'Dell',
    '00:0D:3A': 'Microsoft',
    '00:15:5D': 'Microsoft Hyper-V',
    '00:17:F2': 'Apple',
    '00:1C:B3': 'Apple',
    '00:1D:4F': 'Apple',
    '00:21:E9': 'Apple',
    '00:23:12': 'Apple',
    '00:25:00': 'Apple',
    '00:26:08': 'Apple',
    '28:E0:2C': 'Apple',
    '3C:D0:F8': 'Apple',
    '40:6C:8F': 'Apple',
    '48:60:BC': 'Apple',
    '50:BC:96': 'Apple',
    '54:26:96': 'Apple',
    '60:03:08': 'Apple',
    '64:A3:CB': 'Apple',
    '68:5B:35': 'Apple',
    '70:56:81': 'Apple',
    '78:4F:43': 'Apple',
    '80:E6:50': 'Apple',
    '84:38:35': 'Apple',
    '88:66:A5': 'Apple',
    '8C:85:90': 'Apple',
    '9C:20:7B': 'Apple',
    'A4:83:E7': 'Apple',
    'A8:88:08': 'Apple',
    'AC:87:A3': 'Apple',
    'B8:17:C2': 'Apple',
    'B8:E8:56': 'Apple',
    'BC:54:36': 'Apple',
    'C8:69:CD': 'Apple',
    'D4:61:9D': 'Apple',
    'D8:30:62': 'Apple',
    'DC:A4:CA': 'Apple',
    'E0:B5:2D': 'Apple',
    'E4:25:E7': 'Apple',
    'F0:99:BF': 'Apple',
    'F4:5C:89': 'Apple',
    'F8:1E:DF': 'Apple',
    '00:1E:58': 'D-Link',
    '00:05:5D': 'D-Link',
    '00:0F:3D': 'D-Link',
    '00:13:46': 'D-Link',
    '00:17:9A': 'D-Link',
    '00:1B:11': 'D-Link',
    '00:40:05': 'Ani Communications',
    '00:E0:4C': 'Realtek',
    '00:00:00': 'Xerox',
    '08:00:20': 'Sun',
    '08:00:27': 'VirtualBox',
    '52:54:00': 'QEMU/KVM',
    'B8:27:EB': 'Raspberry Pi',
    'DC:A6:32': 'Raspberry Pi',
    'E4:5F:01': 'Raspberry Pi',
    '28:CD:C1': 'Raspberry Pi',
    '00:04:4B': 'Nvidia',
    '00:24:8C': 'Nvidia',
    '2C:26:17': 'Oculus',
    '00:09:0F': 'Fortinet',
    '00:60:6E': 'Davicom',
    '08:00:2B': 'DEC',
    'B0:5A:DA': 'TP-Link',
    '14:CC:20': 'TP-Link',
    '60:E3:27': 'TP-Link',
    'AC:84:C6': 'TP-Link',
    'C0:25:E9': 'TP-Link',
    'E8:94:F6': 'TP-Link',
    'F4:F2:6D': 'TP-Link',
    '00:1F:33': 'Netgear',
    '00:1E:2A': 'Netgear',
    '00:22:3F': 'Netgear',
    '00:24:B2': 'Netgear',
    '00:26:F2': 'Netgear',
    '2C:B0:5D': 'Netgear',
    '84:1B:5E': 'Netgear',
    'A4:2B:8C': 'Netgear',
    'C0:FF:D4': 'Netgear',
    'E0:91:F5': 'Netgear',
    '30:46:9C': 'Netgear',
    '00:18:4D': 'Netgear',
    '00:0F:B5': 'Netgear',
    '00:09:5B': 'Netgear',
    '00:14:6C': 'Netgear',
    '00:1B:2F': 'Netgear',
    '18:31:BF': 'Starlink',
    '66:48:e6': 'Starlink',
    '98:25:4A': 'Starlink',
    'E4:F0:42': 'Google',
    '94:EB:2C': 'Google',
    'F4:F5:D8': 'Google',
    '00:1A:11': 'Google',
    '54:60:09': 'Google Nest',
    'F8:0F:F9': 'Google Nest',
    '18:D6:C7': 'Google Nest',
    '1C:F2:9A': 'Google Nest',
    '54:C8:0F': 'TP-Link',
    'B0:A7:B9': 'TP-Link',
    '30:D3:2D': 'TP-Link',
    '74:DA:38': 'TP-Link',
    '3C:52:82': 'Hewlett Packard',
    '00:0A:57': 'Hewlett Packard',
    '00:1E:0B': 'Hewlett Packard',
    '2C:44:FD': 'Hewlett Packard',
    '3C:D9:2B': 'Hewlett Packard',
    '48:0F:CF': 'Hewlett Packard',
    '68:B5:99': 'Hewlett Packard',
    'A0:2B:B8': 'Hewlett Packard',
    'A4:5D:36': 'Hewlett Packard',
    'B4:B5:2F': 'Hewlett Packard',
    'C8:CB:B8': 'Hewlett Packard',
    'E4:11:5B': 'Hewlett Packard',
    'F4:39:09': 'Hewlett Packard',
    '00:50:C2': 'IEEE Registration Auth',
    'CE:8C:0E': 'QNAP',
    '00:08:9B': 'QNAP',
    '24:5E:BE': 'QNAP',
};

export interface ScanResult {
    ipAddress: string;
    macAddress?: string;
    hostname?: string;
    vendor?: string;
    responseTimeMs?: number;
    isAlive: boolean;
}

export interface ScanOptions {
    targetNetwork?: string;
    scanType: 'arp' | 'mdns' | 'port' | 'snmp' | 'full' | 'quick';
    portRange?: string; // e.g., "1-1000" or "22,80,443"
    timeout?: number; // ms
}

export class NetworkScanner {
    private activeScanId: string | null = null;

    /**
     * Get local network interfaces and their subnets
     */
    async getLocalNetworks(): Promise<{ interface: string; cidr: string; ip: string }[]> {
        const interfaces = networkInterfaces();
        const networks: { interface: string; cidr: string; ip: string }[] = [];

        for (const [name, addrs] of Object.entries(interfaces)) {
            if (!addrs) continue;

            for (const addr of addrs) {
                if (addr.family === 'IPv4' && !addr.internal) {
                    // Calculate network CIDR from IP and netmask
                    const cidr = this.ipToCidr(addr.address, addr.netmask);
                    networks.push({
                        interface: name,
                        cidr,
                        ip: addr.address,
                    });
                }
            }
        }

        return networks;
    }

    /**
     * Convert IP and netmask to CIDR notation
     */
    private ipToCidr(ip: string, netmask: string): string {
        const maskParts = netmask.split('.').map(Number);
        let bits = 0;
        for (const part of maskParts) {
            bits += (part >>> 0).toString(2).split('1').length - 1;
        }

        const ipParts = ip.split('.').map(Number);
        const maskBits = netmask.split('.').map(Number);
        const networkParts = ipParts.map((part, i) => part & maskBits[i]);

        return `${networkParts.join('.')}/${bits}`;
    }

    /**
     * Look up MAC vendor from OUI database
     */
    lookupMacVendor(mac: string): string | undefined {
        if (!mac) return undefined;

        const normalizedMac = mac.toUpperCase().replace(/[:-]/g, ':');
        const prefix = normalizedMac.substring(0, 8);

        return COMMON_MAC_VENDORS[prefix];
    }

    /**
     * Run ARP scan on local network (uses system arp command)
     */
    async scanArp(cidr?: string): Promise<ScanResult[]> {
        const results: ScanResult[] = [];

        try {
            // Use arp -a to get current ARP table (works on macOS)
            const { stdout } = await execAsync('arp -a', { timeout: 30000 });

            // Parse ARP output - macOS format: hostname (ip) at mac on interface
            const lines = stdout.split('\n');
            const arpRegex = /\(?(\d+\.\d+\.\d+\.\d+)\)?\s+at\s+([0-9a-f:]+)/gi;

            for (const line of lines) {
                const match = arpRegex.exec(line);
                if (match) {
                    const ip = match[1];
                    const mac = match[2];

                    if (mac && mac !== '(incomplete)') {
                        results.push({
                            ipAddress: ip,
                            macAddress: mac.toUpperCase(),
                            vendor: this.lookupMacVendor(mac),
                            isAlive: true,
                        });
                    }
                }
                arpRegex.lastIndex = 0; // Reset regex
            }

            // Also try to ping sweep to populate ARP cache
            if (cidr) {
                await this.pingSweep(cidr);
                // Re-scan ARP table after ping sweep
                const { stdout: newArp } = await execAsync('arp -a', { timeout: 30000 });
                const newLines = newArp.split('\n');

                for (const line of newLines) {
                    const match = arpRegex.exec(line);
                    if (match) {
                        const ip = match[1];
                        const mac = match[2];

                        if (mac && mac !== '(incomplete)' && !results.find(r => r.ipAddress === ip)) {
                            results.push({
                                ipAddress: ip,
                                macAddress: mac.toUpperCase(),
                                vendor: this.lookupMacVendor(mac),
                                isAlive: true,
                            });
                        }
                    }
                    arpRegex.lastIndex = 0;
                }
            }
        } catch (error) {
            console.error('ARP scan error:', error);
        }

        return results;
    }

    /**
     * Ping sweep a network range
     */
    private async pingSweep(cidr: string): Promise<void> {
        // Parse CIDR to get IP range
        const [baseIp, bits] = cidr.split('/');
        const prefixBits = parseInt(bits, 10);

        if (prefixBits < 24) {
            // Don't sweep networks larger than /24
            console.log('Network too large for ping sweep, limiting to first 254 hosts');
        }

        const baseParts = baseIp.split('.').map(Number);
        const promises: Promise<void>[] = [];

        // Ping first 254 addresses in the subnet
        for (let i = 1; i <= 254; i++) {
            const targetIp = `${baseParts[0]}.${baseParts[1]}.${baseParts[2]}.${i}`;
            promises.push(this.pingHost(targetIp));
        }

        // Run in parallel with concurrency limit
        const batchSize = 50;
        for (let i = 0; i < promises.length; i += batchSize) {
            await Promise.allSettled(promises.slice(i, i + batchSize));
        }
    }

    /**
     * Ping a single host
     */
    private async pingHost(ip: string): Promise<void> {
        try {
            // macOS ping with 1 packet, 500ms timeout
            await execAsync(`ping -c 1 -W 500 ${ip}`, { timeout: 2000 });
        } catch {
            // Ignore ping failures
        }
    }

    /**
     * Scan common ports on a host
     */
    async scanPorts(ip: string, ports: number[] = [22, 80, 443, 8080, 8443]): Promise<{ port: number; open: boolean }[]> {
        const results: { port: number; open: boolean }[] = [];

        for (const port of ports) {
            try {
                // Try to connect with netcat (nc)
                await execAsync(`nc -z -w 1 ${ip} ${port}`, { timeout: 2000 });
                results.push({ port, open: true });
            } catch {
                results.push({ port, open: false });
            }
        }

        return results;
    }

    /**
     * Start a full network scan
     */
    async startScan(options: ScanOptions): Promise<string> {
        // Get target network if not specified
        let targetNetwork = options.targetNetwork;
        if (!targetNetwork) {
            const networks = await this.getLocalNetworks();
            if (networks.length > 0) {
                targetNetwork = networks[0].cidr;
            } else {
                throw new Error('No local networks found');
            }
        }

        // Create scan record
        const scanId = generateId();
        const now = new Date();

        await db.insert(networkScans).values({
            id: scanId,
            scanType: options.scanType,
            targetNetwork,
            status: 'running',
            progress: 0,
            startedAt: now,
            createdAt: now,
            updatedAt: now,
        });

        this.activeScanId = scanId;

        // Run scan asynchronously
        this.runScan(scanId, targetNetwork, options).catch(async (error) => {
            console.error('Scan error:', error);
            await db.update(networkScans)
                .set({
                    status: 'failed',
                    errorMessage: error.message,
                    completedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(networkScans.id, scanId));
        });

        return scanId;
    }

    /**
     * Run the actual scan
     */
    private async runScan(scanId: string, targetNetwork: string, options: ScanOptions): Promise<void> {
        const now = new Date();
        let devicesFound = 0;
        let newDevicesFound = 0;

        try {
            // Update progress
            await db.update(networkScans)
                .set({ progress: 10, updatedAt: new Date() })
                .where(eq(networkScans.id, scanId));

            // Run ARP scan
            const arpResults = await this.scanArp(targetNetwork);

            await db.update(networkScans)
                .set({ progress: 50, updatedAt: new Date() })
                .where(eq(networkScans.id, scanId));

            // Process discovered devices
            for (const result of arpResults) {
                devicesFound++;

                // Check if device already exists
                const existing = await db.select()
                    .from(discoveredDevices)
                    .where(
                        or(
                            eq(discoveredDevices.macAddress, result.macAddress || ''),
                            eq(discoveredDevices.ipAddress, result.ipAddress)
                        )
                    );

                if (existing.length === 0) {
                    // New device discovered
                    newDevicesFound++;

                    await db.insert(discoveredDevices).values({
                        id: generateId(),
                        ipAddress: result.ipAddress,
                        macAddress: result.macAddress || null,
                        macVendor: result.vendor || null,
                        classification: 'unknown',
                        deviceType: this.guessDeviceType(result.vendor),
                        firstSeenAt: now,
                        lastSeenAt: now,
                        lastScanId: scanId,
                        responseTimeMs: result.responseTimeMs,
                        isReachable: result.isAlive,
                        createdAt: now,
                        updatedAt: now,
                    });
                } else {
                    // Update existing device
                    await db.update(discoveredDevices)
                        .set({
                            ipAddress: result.ipAddress,
                            macAddress: result.macAddress || existing[0].macAddress,
                            macVendor: result.vendor || existing[0].macVendor,
                            lastSeenAt: now,
                            lastScanId: scanId,
                            isReachable: result.isAlive,
                            updatedAt: now,
                        })
                        .where(eq(discoveredDevices.id, existing[0].id));
                }
            }

            // Port scan on interesting devices (if full scan)
            if (options.scanType === 'full' || options.scanType === 'port') {
                await db.update(networkScans)
                    .set({ progress: 70, updatedAt: new Date() })
                    .where(eq(networkScans.id, scanId));

                for (const result of arpResults) {
                    const ports = await this.scanPorts(result.ipAddress);
                    const openPorts = ports.filter(p => p.open).map(p => p.port);

                    if (openPorts.length > 0) {
                        await db.update(discoveredDevices)
                            .set({
                                openPorts: openPorts,
                                updatedAt: new Date(),
                            })
                            .where(eq(discoveredDevices.ipAddress, result.ipAddress));
                    }
                }
            }

            // Complete the scan
            const completedAt = new Date();
            await db.update(networkScans)
                .set({
                    status: 'completed',
                    progress: 100,
                    devicesFound,
                    newDevicesFound,
                    completedAt,
                    durationMs: completedAt.getTime() - now.getTime(),
                    updatedAt: completedAt,
                })
                .where(eq(networkScans.id, scanId));

        } catch (error) {
            throw error;
        } finally {
            this.activeScanId = null;
        }
    }

    /**
     * Guess device type from vendor
     */
    private guessDeviceType(vendor?: string): 'router' | 'switch' | 'access_point' | 'camera' | 'server' | 'workstation' | 'mobile' | 'iot' | 'printer' | 'nas' | 'unknown' {
        if (!vendor) return 'unknown';

        const v = vendor.toLowerCase();

        if (v.includes('ubiquiti')) return 'access_point';
        if (v.includes('synology') || v.includes('qnap')) return 'nas';
        if (v.includes('raspberry')) return 'iot';
        if (v.includes('apple')) return 'workstation';
        if (v.includes('vmware') || v.includes('microsoft') || v.includes('hyper-v') || v.includes('qemu') || v.includes('virtualbox')) return 'server';
        if (v.includes('netgear') || v.includes('tp-link') || v.includes('d-link')) return 'router';
        if (v.includes('hp') || v.includes('hewlett')) return 'workstation';
        if (v.includes('starlink')) return 'router';
        if (v.includes('google') || v.includes('nest')) return 'iot';

        return 'unknown';
    }

    /**
     * Get scan status
     */
    async getScanStatus(scanId: string) {
        const result = await db.select().from(networkScans).where(eq(networkScans.id, scanId));
        return result[0] || null;
    }

    /**
     * Get all discovered devices
     */
    async getDiscoveredDevices(filter?: { classification?: string; siteId?: string }) {
        let query = db.select().from(discoveredDevices);

        if (filter?.classification) {
            query = query.where(eq(discoveredDevices.classification, filter.classification as any)) as typeof query;
        }

        return query;
    }

    /**
     * Update device classification
     */
    async classifyDevice(deviceId: string, classification: 'known' | 'unknown' | 'suspicious' | 'authorized' | 'blocked', notes?: string) {
        await db.update(discoveredDevices)
            .set({
                classification,
                notes: notes || undefined,
                updatedAt: new Date(),
            })
            .where(eq(discoveredDevices.id, deviceId));
    }

    /**
     * Get network topology map data
     */
    async getNetworkMapData() {
        const devices = await db.select().from(discoveredDevices);
        const connections = await db.select().from(discoveredConnections);

        // Build topology structure
        const nodes = devices.map(d => ({
            id: d.id,
            label: d.hostname || d.ipAddress,
            ip: d.ipAddress,
            mac: d.macAddress,
            vendor: d.macVendor,
            type: d.deviceType,
            classification: d.classification,
            isReachable: d.isReachable,
            lastSeen: d.lastSeenAt,
            openPorts: d.openPorts,
        }));

        const edges = connections.map(c => ({
            source: c.sourceDeviceId,
            target: c.targetDeviceId,
            type: c.connectionType,
            confidence: c.confidence,
        }));

        return { nodes, edges };
    }

    /**
     * Get scan history
     */
    async getScanHistory(limit = 10) {
        return db.select()
            .from(networkScans)
            .orderBy(networkScans.createdAt)
            .limit(limit);
    }
}

// Export singleton instance
export const networkScanner = new NetworkScanner();
