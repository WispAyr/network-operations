/**
 * Perspective Service
 * 
 * Provides location-aware context for network visualization.
 * The network view reorients based on where the user currently is -
 * home, office, van, or anywhere in the world.
 */

import { db } from '../db/index.js';
import { sites, locations, vehicles } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface GeoCoordinates {
    latitude: number;
    longitude: number;
    accuracy?: number; // meters
}

export interface PerspectiveContext {
    type: 'site' | 'location' | 'vehicle' | 'coordinates' | 'auto';
    id?: string;           // ID of site, location, or vehicle
    name: string;          // Human-readable name
    coordinates?: GeoCoordinates;
    detectedAt: Date;
    detectionMethod: 'gps' | 'ip' | 'wifi' | 'manual' | 'auto';
}

export interface PerspectiveView {
    center: PerspectiveContext;
    nearbyNodes: NearbyNode[];
    pathsFromHere: PathFromPerspective[];
}

export interface NearbyNode {
    type: 'site' | 'location' | 'vehicle' | 'device';
    id: string;
    name: string;
    distance?: number;      // km from perspective center
    bearing?: number;       // degrees from north
    reachability: 'direct' | 'routed' | 'tunneled' | 'unreachable' | 'unknown';
    hopCount?: number;      // network hops to reach
}

export interface PathFromPerspective {
    targetId: string;
    targetName: string;
    targetType: 'device' | 'location' | 'site';
    hops: PerspectiveHop[];
    totalLatency?: number;
    status: 'up' | 'degraded' | 'down' | 'unknown';
}

export interface PerspectiveHop {
    order: number;
    type: string;
    name: string;
    status: 'up' | 'down' | 'unknown';
    latency?: number;
}

/**
 * Calculate distance between two coordinates using Haversine formula
 */
export function calculateDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number
): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Calculate bearing between two coordinates
 */
export function calculateBearing(
    lat1: number, lon1: number,
    lat2: number, lon2: number
): number {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;

    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
        Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360; // Normalize to 0-360
}

/**
 * PerspectiveService manages the user's current viewpoint
 */
export class PerspectiveService {
    private currentPerspective: PerspectiveContext | null = null;

    /**
     * Set perspective manually to a specific site
     */
    async setPerspectiveToSite(siteId: string): Promise<PerspectiveContext> {
        const site = await db.select().from(sites).where(eq(sites.id, siteId));
        if (site.length === 0) {
            throw new Error(`Site not found: ${siteId}`);
        }

        this.currentPerspective = {
            type: 'site',
            id: siteId,
            name: site[0].name,
            coordinates: site[0].latitude && site[0].longitude ? {
                latitude: site[0].latitude,
                longitude: site[0].longitude,
            } : undefined,
            detectedAt: new Date(),
            detectionMethod: 'manual',
        };

        return this.currentPerspective;
    }

    /**
     * Set perspective manually to a specific location
     */
    async setPerspectiveToLocation(locationId: string): Promise<PerspectiveContext> {
        const location = await db.select({
            location: locations,
            site: sites,
        }).from(locations)
            .leftJoin(sites, eq(locations.siteId, sites.id))
            .where(eq(locations.id, locationId));

        if (location.length === 0) {
            throw new Error(`Location not found: ${locationId}`);
        }

        const loc = location[0].location;
        const site = location[0].site;

        this.currentPerspective = {
            type: 'location',
            id: locationId,
            name: `${loc.name}${site ? ` @ ${site.name}` : ''}`,
            coordinates: site?.latitude && site?.longitude ? {
                latitude: site.latitude,
                longitude: site.longitude,
            } : undefined,
            detectedAt: new Date(),
            detectionMethod: 'manual',
        };

        return this.currentPerspective;
    }

    /**
     * Set perspective to a vehicle (mobile perspective)
     */
    async setPerspectiveToVehicle(vehicleId: string): Promise<PerspectiveContext> {
        const vehicle = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
        if (vehicle.length === 0) {
            throw new Error(`Vehicle not found: ${vehicleId}`);
        }

        const v = vehicle[0];

        this.currentPerspective = {
            type: 'vehicle',
            id: vehicleId,
            name: v.name,
            coordinates: v.lastKnownLatitude && v.lastKnownLongitude ? {
                latitude: v.lastKnownLatitude,
                longitude: v.lastKnownLongitude,
            } : undefined,
            detectedAt: new Date(),
            detectionMethod: 'manual',
        };

        return this.currentPerspective;
    }

    /**
     * Set perspective to specific GPS coordinates
     */
    setPerspectiveToCoordinates(
        latitude: number,
        longitude: number,
        name: string = 'Current Location'
    ): PerspectiveContext {
        this.currentPerspective = {
            type: 'coordinates',
            name,
            coordinates: { latitude, longitude },
            detectedAt: new Date(),
            detectionMethod: 'gps',
        };

        return this.currentPerspective;
    }

    /**
     * Auto-detect perspective based on IP geolocation
     * Returns closest known site/location or raw coordinates
     */
    async autoDetectPerspective(
        ipAddress?: string,
        gpsCoords?: GeoCoordinates
    ): Promise<PerspectiveContext> {
        let coords: GeoCoordinates | undefined = gpsCoords;
        let method: PerspectiveContext['detectionMethod'] = 'auto';

        // If GPS coordinates provided, use those (most accurate)
        if (gpsCoords) {
            method = 'gps';
            coords = gpsCoords;
        }
        // Otherwise, try IP geolocation (would integrate with real service)
        else if (ipAddress) {
            method = 'ip';
            // TODO: Integrate with IP geolocation service
            // For now, return null coords
            coords = undefined;
        }

        // If we have coordinates, find the nearest known site
        if (coords) {
            const nearestSite = await this.findNearestSite(coords);

            if (nearestSite && nearestSite.distance < 1) { // Within 1km
                this.currentPerspective = {
                    type: 'site',
                    id: nearestSite.siteId,
                    name: nearestSite.siteName,
                    coordinates: coords,
                    detectedAt: new Date(),
                    detectionMethod: method,
                };
            } else {
                // Not near any known site, use raw coordinates
                this.currentPerspective = {
                    type: 'coordinates',
                    name: nearestSite
                        ? `Near ${nearestSite.siteName} (${nearestSite.distance.toFixed(1)}km)`
                        : 'Current Location',
                    coordinates: coords,
                    detectedAt: new Date(),
                    detectionMethod: method,
                };
            }
        } else {
            // No location data available
            this.currentPerspective = {
                type: 'auto',
                name: 'Unknown Location',
                detectedAt: new Date(),
                detectionMethod: 'auto',
            };
        }

        return this.currentPerspective;
    }

    /**
     * Find the nearest site to given coordinates
     */
    async findNearestSite(coords: GeoCoordinates): Promise<{
        siteId: string;
        siteName: string;
        distance: number;
    } | null> {
        const allSites = await db.select().from(sites);

        let nearest: { siteId: string; siteName: string; distance: number } | null = null;

        for (const site of allSites) {
            if (site.latitude && site.longitude) {
                const distance = calculateDistance(
                    coords.latitude, coords.longitude,
                    site.latitude, site.longitude
                );

                if (!nearest || distance < nearest.distance) {
                    nearest = {
                        siteId: site.id,
                        siteName: site.name,
                        distance,
                    };
                }
            }
        }

        return nearest;
    }

    /**
     * Get current perspective
     */
    getCurrentPerspective(): PerspectiveContext | null {
        return this.currentPerspective;
    }

    /**
     * Get nodes sorted by distance from current perspective
     */
    async getNodesFromPerspective(): Promise<NearbyNode[]> {
        if (!this.currentPerspective?.coordinates) {
            // Without coordinates, just return all sites unsorted
            const allSites = await db.select().from(sites);
            return allSites.map(s => ({
                type: 'site' as const,
                id: s.id,
                name: s.name,
                reachability: 'unknown' as const,
            }));
        }

        const { latitude, longitude } = this.currentPerspective.coordinates;
        const allSites = await db.select().from(sites);

        const nodes: NearbyNode[] = allSites
            .filter(s => s.latitude && s.longitude)
            .map(s => ({
                type: 'site' as const,
                id: s.id,
                name: s.name,
                distance: calculateDistance(latitude, longitude, s.latitude!, s.longitude!),
                bearing: calculateBearing(latitude, longitude, s.latitude!, s.longitude!),
                reachability: 'unknown' as const,
            }))
            .sort((a, b) => (a.distance || 0) - (b.distance || 0));

        // Add vehicles
        const allVehicles = await db.select().from(vehicles);
        for (const v of allVehicles) {
            if (v.lastKnownLatitude && v.lastKnownLongitude) {
                nodes.push({
                    type: 'vehicle',
                    id: v.id,
                    name: v.name,
                    distance: calculateDistance(
                        latitude, longitude,
                        v.lastKnownLatitude, v.lastKnownLongitude
                    ),
                    bearing: calculateBearing(
                        latitude, longitude,
                        v.lastKnownLatitude, v.lastKnownLongitude
                    ),
                    reachability: 'unknown',
                });
            }
        }

        // Re-sort after adding vehicles
        return nodes.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
    }

    /**
     * Generate a perspective description suitable for visualization
     */
    describePerspective(): string {
        if (!this.currentPerspective) {
            return 'No perspective set. Use set_perspective to establish your viewpoint.';
        }

        const p = this.currentPerspective;
        let desc = `Viewing network from: **${p.name}**\n`;
        desc += `Type: ${p.type}\n`;
        desc += `Detection: ${p.detectionMethod}\n`;

        if (p.coordinates) {
            desc += `Coordinates: ${p.coordinates.latitude.toFixed(6)}, ${p.coordinates.longitude.toFixed(6)}\n`;
        }

        desc += `Updated: ${p.detectedAt.toISOString()}\n`;

        return desc;
    }
}

// Singleton instance
export const perspectiveService = new PerspectiveService();
