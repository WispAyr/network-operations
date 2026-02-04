/**
 * SiteOverview Component
 * Dashboard showing site details, locations, and device counts
 */

import { useState, useEffect } from 'react';
import './SiteOverview.css';
import { API_BASE } from '../config';

interface LocationStats {
  deviceCount: number;
  devicesOnline: number;
  devicesOffline: number;
}

interface Location {
  id: string;
  name: string;
  type: string;
  description?: string;
  floor?: string;
  coordinates?: string;
  stats: LocationStats;
}

interface SiteStats {
  locationCount: number;
  deviceCount: number;
  devicesOnline: number;
  devicesOffline: number;
}

interface Site {
  id: string;
  name: string;
  description?: string;
  role: string;
  isPrimary: boolean;
  address?: string;
  latitude?: number;
  longitude?: number;
  primaryUplinkType?: string;
  backupUplinkType?: string;
  connectsToSiteId?: string;
  stats?: SiteStats;
  locations?: Location[];
}

interface SiteOverviewProps {
  siteId?: string | null;
  onLocationSelect?: (locationId: string) => void;
  onAddLocation?: (siteId: string) => void;
  apiUrl?: string;
}

// Role icons
const RoleIcons: Record<string, string> = {
  noc: '🏛️',
  hq: '🏠',
  remote: '📹',
  field: '🎪',
  datacenter: '🖥️',
  customer: '👤',
  other: '🏢',
};

// Location type icons
const LocationIcons: Record<string, string> = {
  building: '🏗️',
  room: '🚪',
  outdoor: '🌳',
  cabinet: '📦',
  other: '📍',
};

// Uplink type labels
const UplinkLabels: Record<string, string> = {
  fiber: '🔌 Fiber',
  cellular: '📱 Cellular',
  starlink: '🛰️ Starlink',
  wireless: '📶 Wireless',
  vpn: '🔒 VPN',
  cloud_key: '☁️ Cloud Key',
  other: '🔗 Other',
};

export function SiteOverview({ 
  siteId, 
  onLocationSelect,
  onAddLocation,
  apiUrl = API_BASE 
}: SiteOverviewProps) {
  const [site, setSite] = useState<Site | null>(null);
  const [allSites, setAllSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);

  // Fetch site data
  useEffect(() => {
    if (siteId) {
      fetchSiteDetails(siteId);
    } else {
      fetchAllSites();
    }
  }, [siteId, apiUrl]);

  const fetchSiteDetails = async (id: string) => {
    try {
      setLoading(true);
      const response = await fetch(`${apiUrl}/sites/${id}`);
      if (!response.ok) throw new Error('Failed to fetch site');
      const data = await response.json();
      setSite(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load site');
      // Use mock data for demo
      fetch(`${API_BASE}/sites/${id}`).then(r => r.json()).then(data => setSite(data)).catch(() => setSite(null));
    } finally {
      setLoading(false);
    }
  };

  const fetchAllSites = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${apiUrl}/sites?stats=true`);
      if (!response.ok) throw new Error('Failed to fetch sites');
      const data = await response.json();
      setAllSites(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sites');
      // Use mock data for demo
      fetch(`${API_BASE}/sites`).then(r => r.json()).then(data => setAllSites(data || [])).catch(() => setAllSites([]));
    } finally {
      setLoading(false);
    }
  };

  const handleLocationClick = (locationId: string) => {
    setSelectedLocation(locationId);
    onLocationSelect?.(locationId);
  };

  const getHealthColor = (online: number, total: number) => {
    if (total === 0) return 'gray';
    const percent = (online / total) * 100;
    if (percent >= 80) return 'green';
    if (percent >= 50) return 'yellow';
    return 'red';
  };

  if (loading) {
    return (
      <div className="site-overview loading">
        <div className="loading-spinner">Loading...</div>
      </div>
    );
  }

  // If no siteId, show all sites overview
  if (!siteId) {
    return (
      <div className="site-overview all-sites">
        <div className="overview-header">
          <h2>🏢 All Sites</h2>
          <span className="site-count">{allSites.length} sites</span>
        </div>

        <div className="sites-grid">
          {allSites.map(s => (
            <div 
              key={s.id} 
              className={`site-card ${s.isPrimary ? 'primary' : ''}`}
              onClick={() => fetchSiteDetails(s.id)}
            >
              <div className="site-card-header">
                <span className="site-icon">{RoleIcons[s.role] || RoleIcons.other}</span>
                <div className="site-info">
                  <h3>{s.name}</h3>
                  <span className="site-role">{s.role.toUpperCase()}</span>
                </div>
                {s.isPrimary && <span className="primary-badge">PRIMARY</span>}
              </div>

              <div className="site-card-stats">
                <div className="stat">
                  <span className="stat-value">{s.stats?.locationCount ?? 0}</span>
                  <span className="stat-label">Locations</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{s.stats?.deviceCount ?? 0}</span>
                  <span className="stat-label">Devices</span>
                </div>
                <div className="stat">
                  <span 
                    className={`stat-value health-${getHealthColor(s.stats?.devicesOnline ?? 0, s.stats?.deviceCount ?? 0)}`}
                  >
                    {s.stats?.devicesOnline ?? 0}/{s.stats?.deviceCount ?? 0}
                  </span>
                  <span className="stat-label">Online</span>
                </div>
              </div>

              {s.address && (
                <div className="site-card-address">
                  📍 {s.address}
                </div>
              )}
            </div>
          ))}
        </div>

        {allSites.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">🏢</span>
            <h3>No Sites Configured</h3>
            <p>Create your first site to start organizing your infrastructure.</p>
            <button className="btn-primary">+ Add Site</button>
          </div>
        )}
      </div>
    );
  }

  // Single site detail view
  if (!site) {
    return (
      <div className="site-overview error">
        <p>{error || 'Site not found'}</p>
      </div>
    );
  }

  const totalDevices = site.stats?.deviceCount ?? 
    site.locations?.reduce((sum, loc) => sum + loc.stats.deviceCount, 0) ?? 0;
  const onlineDevices = site.stats?.devicesOnline ?? 
    site.locations?.reduce((sum, loc) => sum + loc.stats.devicesOnline, 0) ?? 0;
  const healthPercent = totalDevices > 0 ? Math.round((onlineDevices / totalDevices) * 100) : 100;

  return (
    <div className="site-overview">
      {/* Site Header */}
      <div className="site-header">
        <div className="site-title">
          <span className="site-icon large">{RoleIcons[site.role] || RoleIcons.other}</span>
          <div>
            <h2>{site.name}</h2>
            <div className="site-meta">
              <span className={`role-badge ${site.role}`}>{site.role.toUpperCase()}</span>
              {site.isPrimary && <span className="primary-badge">PRIMARY</span>}
            </div>
          </div>
        </div>

        <div className="site-actions">
          <button className="btn-secondary" onClick={() => onAddLocation?.(site.id)}>
            + Add Location
          </button>
          <button className="btn-secondary">⚙️ Settings</button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="site-stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📍</div>
          <div className="stat-content">
            <span className="stat-value">{site.locations?.length ?? 0}</span>
            <span className="stat-label">Locations</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">📡</div>
          <div className="stat-content">
            <span className="stat-value">{totalDevices}</span>
            <span className="stat-label">Total Devices</span>
          </div>
        </div>

        <div className="stat-card online">
          <div className="stat-icon">🟢</div>
          <div className="stat-content">
            <span className="stat-value">{onlineDevices}</span>
            <span className="stat-label">Online</span>
          </div>
        </div>

        <div className="stat-card health">
          <div className="stat-icon">❤️</div>
          <div className="stat-content">
            <span className={`stat-value health-${getHealthColor(onlineDevices, totalDevices)}`}>
              {healthPercent}%
            </span>
            <span className="stat-label">Health</span>
          </div>
          <div className="health-bar">
            <div 
              className={`health-fill health-${getHealthColor(onlineDevices, totalDevices)}`}
              style={{ width: `${healthPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Site Details */}
      <div className="site-details-grid">
        <div className="details-card">
          <h3>📋 Details</h3>
          <div className="detail-rows">
            {site.description && (
              <div className="detail-row">
                <span className="detail-label">Description</span>
                <span className="detail-value">{site.description}</span>
              </div>
            )}
            {site.address && (
              <div className="detail-row">
                <span className="detail-label">Address</span>
                <span className="detail-value">{site.address}</span>
              </div>
            )}
            {(site.latitude && site.longitude) && (
              <div className="detail-row">
                <span className="detail-label">Coordinates</span>
                <span className="detail-value mono">
                  {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="details-card">
          <h3>🔗 Connectivity</h3>
          <div className="detail-rows">
            {site.primaryUplinkType && (
              <div className="detail-row">
                <span className="detail-label">Primary Uplink</span>
                <span className="detail-value">
                  {UplinkLabels[site.primaryUplinkType] || site.primaryUplinkType}
                </span>
              </div>
            )}
            {site.backupUplinkType && (
              <div className="detail-row">
                <span className="detail-label">Backup Uplink</span>
                <span className="detail-value">
                  {UplinkLabels[site.backupUplinkType] || site.backupUplinkType}
                </span>
              </div>
            )}
            {site.connectsToSiteId && (
              <div className="detail-row">
                <span className="detail-label">Connects To</span>
                <span className="detail-value">
                  {allSites.find(s => s.id === site.connectsToSiteId)?.name || site.connectsToSiteId}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Locations */}
      <div className="locations-section">
        <div className="section-header">
          <h3>📍 Locations</h3>
          <span className="count">{site.locations?.length ?? 0}</span>
        </div>

        <div className="locations-grid">
          {site.locations?.map(location => (
            <div 
              key={location.id}
              className={`location-card ${selectedLocation === location.id ? 'selected' : ''}`}
              onClick={() => handleLocationClick(location.id)}
            >
              <div className="location-header">
                <span className="location-icon">
                  {LocationIcons[location.type] || LocationIcons.other}
                </span>
                <div className="location-info">
                  <h4>{location.name}</h4>
                  <span className="location-type">{location.type}</span>
                </div>
              </div>

              {location.floor && (
                <div className="location-floor">Floor: {location.floor}</div>
              )}

              <div className="location-stats">
                <div className="mini-stat">
                  <span className="mini-value">{location.stats.deviceCount}</span>
                  <span className="mini-label">devices</span>
                </div>
                <div className="mini-stat online">
                  <span className="mini-value">{location.stats.devicesOnline}</span>
                  <span className="mini-label">online</span>
                </div>
                {location.stats.devicesOffline > 0 && (
                  <div className="mini-stat offline">
                    <span className="mini-value">{location.stats.devicesOffline}</span>
                    <span className="mini-label">offline</span>
                  </div>
                )}
              </div>

              <div className="location-actions">
                <button className="btn-sm">View Devices</button>
              </div>
            </div>
          ))}

          {(!site.locations || site.locations.length === 0) && (
            <div className="empty-locations">
              <span className="empty-icon">📍</span>
              <p>No locations defined for this site.</p>
              <button 
                className="btn-primary"
                onClick={() => onAddLocation?.(site.id)}
              >
                + Add First Location
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Mock data for demo
function getMockSites(): Site[] {
  return [
    {
      id: 'site-1',
      name: 'NOC - Edinburgh',
      role: 'noc',
      isPrimary: true,
      address: 'Edinburgh, Scotland',
      stats: { locationCount: 2, deviceCount: 5, devicesOnline: 5, devicesOffline: 0 },
    },
    {
      id: 'site-2',
      name: 'Kyle Rise',
      role: 'remote',
      isPrimary: false,
      address: 'Kyle of Lochalsh',
      stats: { locationCount: 1, deviceCount: 3, devicesOnline: 2, devicesOffline: 1 },
    },
    {
      id: 'site-3',
      name: 'Greenford',
      role: 'customer',
      isPrimary: false,
      address: 'London',
      stats: { locationCount: 2, deviceCount: 8, devicesOnline: 7, devicesOffline: 1 },
    },
  ];
}

function getMockSite(id: string): Site {
  return {
    id,
    name: id === 'site-1' ? 'NOC - Edinburgh' : 'Kyle Rise',
    description: 'Primary network operations center',
    role: id === 'site-1' ? 'noc' : 'remote',
    isPrimary: id === 'site-1',
    address: id === 'site-1' ? 'Edinburgh, Scotland' : 'Kyle of Lochalsh',
    latitude: 55.9533,
    longitude: -3.1883,
    primaryUplinkType: 'fiber',
    backupUplinkType: 'cellular',
    locations: [
      {
        id: 'loc-1',
        name: 'Server Room',
        type: 'room',
        floor: 'Ground',
        stats: { deviceCount: 3, devicesOnline: 3, devicesOffline: 0 },
      },
      {
        id: 'loc-2',
        name: 'Front Entrance',
        type: 'outdoor',
        stats: { deviceCount: 2, devicesOnline: 1, devicesOffline: 1 },
      },
    ],
  };
}

export default SiteOverview;
