import { randomUUID } from 'crypto';

/**
 * Generate a unique ID for database entities
 */
export function generateId(): string {
    return randomUUID();
}

/**
 * Get current timestamp as Date
 */
export function now(): Date {
    return new Date();
}

/**
 * Parse JSON safely, returning null on failure
 */
export function safeJsonParse<T>(json: string | null | undefined): T | null {
    if (!json) return null;
    try {
        return JSON.parse(json) as T;
    } catch {
        return null;
    }
}

/**
 * Format an IP address for display
 */
export function formatIpAddress(ip: string | null | undefined): string {
    return ip || 'N/A';
}

/**
 * Validate CIDR notation
 */
export function isValidCidr(cidr: string): boolean {
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
    if (!cidrRegex.test(cidr)) return false;

    const [ip, prefix] = cidr.split('/');
    const prefixNum = parseInt(prefix, 10);
    if (prefixNum < 0 || prefixNum > 32) return false;

    const octets = ip.split('.').map(Number);
    return octets.every(o => o >= 0 && o <= 255);
}

/**
 * Validate MAC address
 */
export function isValidMac(mac: string): boolean {
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    return macRegex.test(mac);
}

/**
 * Validate IPv4 address
 */
export function isValidIpv4(ip: string): boolean {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) return false;

    const octets = ip.split('.').map(Number);
    return octets.every(o => o >= 0 && o <= 255);
}
