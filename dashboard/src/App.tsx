import { useState, useEffect } from 'react'
import './App.css'
import { SiteTree, SiteOverview, DeviceManagement } from './components'
import { NetworkTopology } from './components/NetworkTopology'
import type { TopologyNode, TopologyLink } from './components/NetworkTopology'
import './components/DeviceManagement.css'
import { API_BASE } from './config'

// Types matching our backend schema
interface Site {
  id: string
  name: string
  role: 'noc' | 'hq' | 'remote' | 'field' | 'customer' | 'datacenter' | 'other'
  isPrimary?: boolean
  latitude?: number
  longitude?: number
  primaryUplinkType?: string
}

interface Device {
  id: string
  name: string
  type: string
  status: 'online' | 'offline' | 'degraded' | 'unknown'
  primaryIp?: string
}

interface Network {
  id: string
  name: string
  role: 'core' | 'local' | 'edge' | 'transit'
  trustZone: 'trusted' | 'untrusted' | 'semi-trusted' | 'unknown'
  status: string
}

interface Vehicle {
  id: string
  name: string
  type: string
}

interface Deployment {
  id: string
  name: string
  type: string
  status: 'planned' | 'active' | 'standby' | 'completed' | 'cancelled'
  vehicleId?: string
}

interface InfrastructureData {
  sites: Site[]
  devices: Device[]
  networks: Network[]
  vehicles: Vehicle[]
  deployments: Deployment[]
}

interface DiscoveredDevice {
  id: string
  ipAddress: string
  macAddress?: string
  hostname?: string
  macVendor?: string
  classification: 'known' | 'unknown' | 'suspicious' | 'authorized' | 'blocked'
  deviceType: string
  lastSeenAt: Date
  openPorts?: number[]
}

// API_BASE imported from config.ts

// Empty initial data - will be populated from API
const emptyData: InfrastructureData = {
  sites: [],
  devices: [],
  networks: [],
  vehicles: [],
  deployments: [],
}

// Network Topology Data - will be fetched from API
// Default/fallback values
const defaultTopologyNodes: TopologyNode[] = [
  { id: 'skynet', name: 'Skynet AI', type: 'skynet', status: 'online', ip: '192.168.195.33', layer: 0, vendor: 'Custom' },
  { id: 'zerotier-gw', name: 'ZeroTier Gateway', type: 'gateway', status: 'online', ip: '192.168.195.1', layer: 1, vendor: 'ZeroTier' },
]

const defaultTopologyLinks: TopologyLink[] = [
  { source: 'skynet', target: 'zerotier-gw', type: 'vpn', status: 'active' },
]

// Icon components
const Icons = {
  site: '🏢',
  noc: '🏛️',
  remote: '📹',
  vehicle: '🚐',
  router: '📡',
  camera: '📹',
  controller: '🎛️',
  gateway: '🌐',
  server: '🖥️',
  switch: '🔀',
  trusted: '🟢',
  untrusted: '🔴',
  semiTrusted: '🟡',
  online: '●',
  offline: '○',
  deployment: '🎪',
}

function App() {
  const [data, setData] = useState<InfrastructureData>(emptyData)
  const [selectedView, setSelectedView] = useState<'overview' | 'sites' | 'devices' | 'radar' | 'trust' | 'deployments' | 'scanner' | 'topology'>('overview')
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [scanProgress, setScanProgress] = useState(0)
  const [isScanning, setIsScanning] = useState(false)
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [topologyNodes, setTopologyNodes] = useState<TopologyNode[]>(defaultTopologyNodes)
  const [topologyLinks, setTopologyLinks] = useState<TopologyLink[]>(defaultTopologyLinks)

  // Fetch data from API
  useEffect(() => {
    async function fetchData() {
      try {
        const [devicesRes, sitesRes, servicesRes, topologyRes] = await Promise.all([
          fetch(`${API_BASE}/devices`).then(r => r.json()).catch(() => ({ devices: [] })),
          fetch(`${API_BASE}/sites?stats=true`).then(r => r.json()).catch(() => []),
          fetch(`${API_BASE}/services`).then(r => r.json()).catch(() => []),
          fetch(`${API_BASE}/devices/topology`).then(r => r.json()).catch(() => ({ nodes: defaultTopologyNodes, links: defaultTopologyLinks })),
        ]);
        
        // Map API devices to our format
        const devicesList = devicesRes.devices || devicesRes || [];
        const devices = (devicesList).map((d: any) => ({
          id: d.id,
          name: d.name,
          type: d.type || 'unknown',
          status: d.status || 'unknown',
          primaryIp: d.primaryIp || d.ipAddress,
        }));
        
        // Map sites with stats
        const sites = (sitesRes || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          role: s.role || 'remote',
          isPrimary: s.isPrimary,
          latitude: s.latitude,
          longitude: s.longitude,
          stats: s.stats,
        }));
        
        setData({
          ...emptyData,
          devices,
          sites,
        });
        
        // Map services as discovered devices
        const discovered = (servicesRes || []).map((s: any) => ({
          id: s.pm2 || s.name,
          ipAddress: `localhost:${s.port}`,
          hostname: s.name,
          classification: s.status === 'online' ? 'known' : 'unknown',
          deviceType: s.type || 'service',
          lastSeenAt: new Date(),
          openPorts: s.port ? [s.port] : [],
        }));
        setDiscoveredDevices(discovered);
        
        // Set topology data
        if (topologyRes.nodes && topologyRes.nodes.length > 0) {
          setTopologyNodes(topologyRes.nodes);
          setTopologyLinks(topologyRes.links || []);
        }
        
      } catch (err) {
        console.error('Failed to fetch data:', err);
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const onlineCount = data.devices.filter(d => d.status === 'online').length
  const offlineCount = data.devices.filter(d => d.status === 'offline').length
  const healthPercent = Math.round((onlineCount / data.devices.length) * 100)

  const trustedNetworks = data.networks.filter(n => n.trustZone === 'trusted')
  const untrustedNetworks = data.networks.filter(n => n.trustZone === 'untrusted')
  const activeDeployments = data.deployments.filter(d => d.status === 'active')

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-brand">
          <h1>🌐 NetOps</h1>
          <span className="header-subtitle">Network Operations Center</span>
        </div>
        <div className="header-status">
          <div className="live-indicator">
            <span className="status-dot online"></span>
            <span>LIVE</span>
          </div>
          <div className="header-time">
            {currentTime.toLocaleTimeString()}
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="dashboard-nav">
        <button
          className={`nav-item ${selectedView === 'overview' ? 'active' : ''}`}
          onClick={() => setSelectedView('overview')}
        >
          📊 Overview
        </button>
        <button
          className={`nav-item ${selectedView === 'sites' ? 'active' : ''}`}
          onClick={() => setSelectedView('sites')}
        >
          🏢 Sites
        </button>
        <button
          className={`nav-item ${selectedView === 'devices' ? 'active' : ''}`}
          onClick={() => setSelectedView('devices')}
        >
          📱 Devices
        </button>
        <button
          className={`nav-item ${selectedView === 'radar' ? 'active' : ''}`}
          onClick={() => setSelectedView('radar')}
        >
          📡 Radar View
        </button>
        <button
          className={`nav-item ${selectedView === 'trust' ? 'active' : ''}`}
          onClick={() => setSelectedView('trust')}
        >
          🛡️ Trust Zones
        </button>
        <button
          className={`nav-item ${selectedView === 'deployments' ? 'active' : ''}`}
          onClick={() => setSelectedView('deployments')}
        >
          🎪 Deployments
        </button>
        <button
          className={`nav-item ${selectedView === 'scanner' ? 'active' : ''}`}
          onClick={() => setSelectedView('scanner')}
        >
          🔍 Network Scan
        </button>
        <button
          className={`nav-item ${selectedView === 'topology' ? 'active' : ''}`}
          onClick={() => setSelectedView('topology')}
        >
          🕸️ Topology
        </button>
      </nav>

      {/* Main Content */}
      <main className="dashboard-main">
        {selectedView === 'overview' && (
          <div className="view-overview">
            {/* Stats Grid */}
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{data.sites.length}</div>
                <div className="stat-label">Sites</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{onlineCount}/{data.devices.length}</div>
                <div className="stat-label">Devices Online</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{activeDeployments.length}</div>
                <div className="stat-label">Active Deployments</div>
              </div>
              <div className="stat-card health">
                <div className="stat-value">{healthPercent}%</div>
                <div className="stat-label">Health ({offlineCount} offline)</div>
                <div className="health-bar">
                  <div className="health-fill" style={{ width: `${healthPercent}%` }}></div>
                </div>
              </div>
            </div>

            {/* Quick Status */}
            <div className="panels-row">
              {/* Sites Panel */}
              <div className="glass-card panel">
                <h2>🏢 Sites ({data.sites.length})</h2>
                <div className="panel-content">
                  {data.sites.map(site => (
                    <div key={site.id} className="list-item" onClick={() => { setSelectedSiteId(site.id); setSelectedView('sites'); }}>
                      <span className="item-icon">
                        {site.role === 'noc' ? Icons.noc : Icons.remote}
                      </span>
                      <span className="item-name">{site.name}</span>
                      <span className="item-count">{(site as any).stats?.deviceCount ?? 0} devices</span>
                      <span className={`item-badge ${site.role}`}>{site.role?.toUpperCase() || 'OTHER'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Devices Panel */}
              <div className="glass-card panel">
                <h2>📡 Devices</h2>
                <div className="panel-content">
                  {data.devices.map(device => (
                    <div key={device.id} className="list-item">
                      <span className={`status-dot ${device.status}`}></span>
                      <span className="item-name">{device.name}</span>
                      <span className="item-ip">{device.primaryIp || '-'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Networks Panel */}
              <div className="glass-card panel">
                <h2>🔗 Networks</h2>
                <div className="panel-content">
                  {data.networks.map(network => (
                    <div key={network.id} className="list-item">
                      <span className={`trust-icon ${network.trustZone}`}>
                        {network.trustZone === 'trusted' ? Icons.trusted :
                          network.trustZone === 'untrusted' ? Icons.untrusted : Icons.semiTrusted}
                      </span>
                      <span className="item-name">{network.name}</span>
                      <span className={`trust-badge trust-${network.trustZone === 'semi-trusted' ? 'semi' : network.trustZone}`}>
                        {network.trustZone}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Connectivity Chain Example */}
            <div className="glass-card">
              <h2>🔗 Connectivity Chain: Van to NOC</h2>
              <div className="chain-container">
                <div className="chain-node">
                  <span className="chain-icon">🚐</span>
                  <span className="chain-label">Van</span>
                </div>
                <div className="chain-link untrusted">
                  <svg viewBox="0 0 40 20">
                    <path d="M0 10 L35 10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />
                    <path d="M30 5 L40 10 L30 15" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </div>
                <div className="chain-node">
                  <span className="chain-icon">🛰️</span>
                  <span className="chain-label">Starlink</span>
                  <span className="trust-badge trust-untrusted">HOSTILE</span>
                </div>
                <div className="chain-link untrusted">
                  <svg viewBox="0 0 40 20">
                    <path d="M0 10 L35 10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />
                    <path d="M30 5 L40 10 L30 15" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </div>
                <div className="chain-node">
                  <span className="chain-icon">🌐</span>
                  <span className="chain-label">Internet</span>
                  <span className="trust-badge trust-untrusted">HOSTILE</span>
                </div>
                <div className="chain-link trusted">
                  <svg viewBox="0 0 40 20">
                    <path d="M0 10 L35 10" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M30 5 L40 10 L30 15" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </div>
                <div className="chain-node">
                  <span className="chain-icon">🔒</span>
                  <span className="chain-label">ZeroTier</span>
                  <span className="trust-badge trust-trusted">SECURE</span>
                </div>
                <div className="chain-link trusted">
                  <svg viewBox="0 0 40 20">
                    <path d="M0 10 L35 10" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M30 5 L40 10 L30 15" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </div>
                <div className="chain-node">
                  <span className="chain-icon">🏛️</span>
                  <span className="chain-label">NOC</span>
                  <span className="trust-badge trust-trusted">FRIENDLY</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedView === 'sites' && (
          <div className="view-sites">
            <div className="sites-layout">
              {/* Left sidebar - Tree navigation */}
              <div className="sites-sidebar">
                <SiteTree 
                  onSelect={(item) => {
                    if (item.type === 'site') {
                      setSelectedSiteId(item.id);
                    }
                  }}
                  apiUrl={API_BASE}
                />
              </div>
              
              {/* Main content - Site overview */}
              <div className="sites-content">
                <SiteOverview 
                  siteId={selectedSiteId}
                  onLocationSelect={(locId) => console.log('Selected location:', locId)}
                  onAddLocation={(siteId) => console.log('Add location to:', siteId)}
                  apiUrl={API_BASE}
                />
              </div>
            </div>
          </div>
        )}

        {selectedView === 'devices' && (
          <DeviceManagement />
        )}

        {selectedView === 'radar' && (
          <div className="view-radar">
            <div className="glass-card radar-panel">
              <h2>📍 Perspective View: NOC - Edinburgh</h2>
              <div className="radar-container">
                {/* Radar rings */}
                <div className="radar-ring ring-4"></div>
                <div className="radar-ring ring-3"></div>
                <div className="radar-ring ring-2"></div>
                <div className="radar-ring ring-1"></div>
                <div className="radar-sweep"></div>
                <div className="radar-center" title="You are here"></div>

                {/* Ring labels */}
                <div className="ring-label label-1">10km</div>
                <div className="ring-label label-2">50km</div>
                <div className="ring-label label-3">100km</div>
                <div className="ring-label label-4">&gt;100km</div>

                {/* Nodes positioned on radar */}
                {data.sites.filter(s => s.role !== 'noc').map((site, i) => {
                  // Calculate position based on mock distance/bearing
                  const angle = (i * 120) * (Math.PI / 180)
                  const distance = 80 + i * 40
                  const x = 200 + Math.cos(angle) * distance
                  const y = 200 + Math.sin(angle) * distance
                  return (
                    <div
                      key={site.id}
                      className="radar-node site"
                      style={{ left: x, top: y }}
                      title={site.name}
                    ></div>
                  )
                })}
              </div>

              <div className="radar-legend">
                <div className="legend-item">
                  <span className="radar-node site" style={{ position: 'static', display: 'inline-block' }}></span>
                  <span>Sites</span>
                </div>
                <div className="legend-item">
                  <span className="radar-node vehicle" style={{ position: 'static', display: 'inline-block' }}></span>
                  <span>Vehicles</span>
                </div>
                <div className="legend-item">
                  <span className="radar-node device" style={{ position: 'static', display: 'inline-block' }}></span>
                  <span>Devices</span>
                </div>
              </div>
            </div>

            <div className="glass-card nodes-list">
              <h2>📋 Nodes by Distance</h2>
              <div className="panel-content">
                <div className="distance-group">
                  <h3>🔴 Immediate (&lt; 10km)</h3>
                  <div className="list-item">
                    <span>🏢 Festival Grounds</span>
                    <span className="item-distance">2.3 km ↗ NE</span>
                  </div>
                </div>
                <div className="distance-group">
                  <h3>🟡 Nearby (10-50km)</h3>
                  <p className="empty-msg">No nodes in this range</p>
                </div>
                <div className="distance-group">
                  <h3>🟢 Regional (50-100km)</h3>
                  <div className="list-item">
                    <span>📹 Camera Site Alpha</span>
                    <span className="item-distance">72.1 km ← W</span>
                  </div>
                </div>
                <div className="distance-group">
                  <h3>🔵 Distant (&gt; 100km)</h3>
                  <div className="list-item">
                    <span>📹 Camera Site Beta</span>
                    <span className="item-distance">145.8 km ↑ N</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedView === 'trust' && (
          <div className="view-trust">
            <div className="trust-grid">
              <div className="glass-card trust-zone trusted">
                <div className="zone-header">
                  <span className="zone-icon">🟢</span>
                  <h2>Trusted Networks</h2>
                  <span className="zone-count">{trustedNetworks.length}</span>
                </div>
                <p className="zone-desc">Internal networks, VPNs, and secure connections</p>
                <div className="zone-networks">
                  {trustedNetworks.map(n => (
                    <div key={n.id} className="network-item">
                      <span>🔒 {n.name}</span>
                      <span className={`role-badge ${n.role}`}>{n.role}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-card trust-zone semi-trusted">
                <div className="zone-header">
                  <span className="zone-icon">🟡</span>
                  <h2>Semi-Trusted Networks</h2>
                  <span className="zone-count">
                    {data.networks.filter(n => n.trustZone === 'semi-trusted').length}
                  </span>
                </div>
                <p className="zone-desc">Customer networks, guest access, partner links</p>
                <div className="zone-networks">
                  {data.networks.filter(n => n.trustZone === 'semi-trusted').map(n => (
                    <div key={n.id} className="network-item">
                      <span>⚠️ {n.name}</span>
                      <span className={`role-badge ${n.role}`}>{n.role}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-card trust-zone untrusted">
                <div className="zone-header">
                  <span className="zone-icon">🔴</span>
                  <h2>Untrusted Networks</h2>
                  <span className="zone-count">{untrustedNetworks.length}</span>
                </div>
                <p className="zone-desc">Public internet, cellular, Starlink transit</p>
                <div className="zone-networks">
                  {untrustedNetworks.map(n => (
                    <div key={n.id} className="network-item">
                      <span>🌐 {n.name}</span>
                      <span className={`role-badge ${n.role}`}>{n.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="glass-card trust-status-card">
              <h2>🛡️ Current Security Posture</h2>
              <div className="posture-indicator">
                <div className="posture-icon secure">✓</div>
                <div className="posture-text">
                  <span className="posture-status">SECURE</span>
                  <span className="posture-detail">Connected via ZeroTier (Trusted Network)</span>
                </div>
              </div>
              <div className="posture-path">
                <span>Your Path: </span>
                <span className="trust-badge trust-trusted">Local</span>
                <span>→</span>
                <span className="trust-badge trust-trusted">ZeroTier</span>
                <span>→</span>
                <span className="trust-badge trust-trusted">NOC</span>
              </div>
            </div>
          </div>
        )}

        {selectedView === 'deployments' && (
          <div className="view-deployments">
            <div className="deployment-grid">
              {data.deployments.map(dep => (
                <div key={dep.id} className={`glass-card deployment-card ${dep.status}`}>
                  <div className="deployment-header">
                    <span className="deployment-icon">
                      {dep.type === 'festival' ? '🎪' : dep.type === 'emergency' ? '🚨' : '📍'}
                    </span>
                    <h2>{dep.name}</h2>
                    <span className={`status-badge ${dep.status}`}>
                      {dep.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="deployment-details">
                    <div className="detail-row">
                      <span className="detail-label">Type</span>
                      <span className="detail-value">{dep.type}</span>
                    </div>
                    {dep.vehicleId && (
                      <div className="detail-row">
                        <span className="detail-label">Vehicle</span>
                        <span className="detail-value">
                          🚐 {data.vehicles.find(v => v.id === dep.vehicleId)?.name}
                        </span>
                      </div>
                    )}
                    <div className="detail-row">
                      <span className="detail-label">Status</span>
                      <span className={`detail-value status-${dep.status}`}>
                        {dep.status === 'active' && '🟢 Active & Monitoring'}
                        {dep.status === 'standby' && '🟡 On Standby'}
                        {dep.status === 'planned' && '📋 Planned'}
                        {dep.status === 'completed' && '✅ Completed'}
                      </span>
                    </div>
                  </div>
                  <div className="deployment-actions">
                    <button className="btn btn-secondary">View Details</button>
                    {dep.status === 'active' && (
                      <button className="btn btn-primary">Monitor</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="glass-card vehicles-panel">
              <h2>🚐 Vehicles</h2>
              <div className="vehicles-grid">
                {data.vehicles.map(vehicle => (
                  <div key={vehicle.id} className="vehicle-card">
                    <span className="vehicle-icon">🚐</span>
                    <span className="vehicle-name">{vehicle.name}</span>
                    <span className="vehicle-type">{vehicle.type}</span>
                    <span className="vehicle-status online">● Available</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {selectedView === 'scanner' && (
          <div className="view-scanner">
            {/* Scan Controls */}
            <div className="glass-card scan-controls">
              <h2>🔍 Network Discovery</h2>
              <div className="scan-actions">
                <button
                  className="btn btn-primary btn-lg"
                  onClick={() => {
                    setIsScanning(true)
                    setScanProgress(0)
                    const interval = setInterval(() => {
                      setScanProgress(p => {
                        if (p >= 100) {
                          clearInterval(interval)
                          setIsScanning(false)
                          return 100
                        }
                        return p + 10
                      })
                    }, 500)
                  }}
                  disabled={isScanning}
                >
                  {isScanning ? '🔄 Scanning...' : '🚀 Start ARP Scan'}
                </button>
                <button className="btn btn-secondary">Port Scan</button>
                <button className="btn btn-secondary">Full Scan</button>
              </div>
              {isScanning && (
                <div className="scan-progress">
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${scanProgress}%` }}></div>
                  </div>
                  <span>{scanProgress}%</span>
                </div>
              )}
              <div className="scan-stats">
                <div className="scan-stat">
                  <span className="stat-number">{discoveredDevices.length}</span>
                  <span className="stat-label">Total Found</span>
                </div>
                <div className="scan-stat">
                  <span className="stat-number known">{discoveredDevices.filter(d => d.classification === 'known' || d.classification === 'authorized').length}</span>
                  <span className="stat-label">Known</span>
                </div>
                <div className="scan-stat">
                  <span className="stat-number unknown">{discoveredDevices.filter(d => d.classification === 'unknown').length}</span>
                  <span className="stat-label">Unknown</span>
                </div>
                <div className="scan-stat">
                  <span className="stat-number suspicious">{discoveredDevices.filter(d => d.classification === 'suspicious').length}</span>
                  <span className="stat-label">Suspicious</span>
                </div>
              </div>
            </div>

            {/* Network Map */}
            <div className="glass-card network-map">
              <h2>🗺️ Network Topology</h2>
              <div className="topology-container">
                {/* Router at center */}
                <div className="topology-center">
                  <div className="topology-node router">
                    <span className="node-icon">📡</span>
                    <span className="node-ip">192.168.1.1</span>
                    <span className="node-label">Gateway</span>
                  </div>
                </div>

                {/* Connected devices in a circle */}
                <div className="topology-ring">
                  {discoveredDevices.filter(d => d.ipAddress !== '192.168.1.1').map((device, index) => {
                    const angle = (index * 360 / 7) * (Math.PI / 180)
                    const radius = 180
                    const x = Math.cos(angle) * radius
                    const y = Math.sin(angle) * radius

                    const typeIcons: Record<string, string> = {
                      router: '📡', nas: '💾', access_point: '📶', workstation: '💻',
                      iot: '🔌', unknown: '❓', server: '🖥️', camera: '📹',
                    }

                    return (
                      <div
                        key={device.id}
                        className={`topology-node ${device.classification}`}
                        style={{
                          transform: `translate(${x}px, ${y}px)`,
                        }}
                        title={`${device.ipAddress}\n${device.macVendor || 'Unknown vendor'}\n${device.hostname || ''}`}
                      >
                        <span className="node-icon">{typeIcons[device.deviceType] || '❓'}</span>
                        <span className="node-ip">{device.ipAddress.split('.').slice(-1)[0]}</span>
                        <span className={`classification-dot ${device.classification}`}></span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="topology-legend">
                <span className="legend-item"><span className="dot known"></span> Known</span>
                <span className="legend-item"><span className="dot authorized"></span> Authorized</span>
                <span className="legend-item"><span className="dot unknown"></span> Unknown</span>
                <span className="legend-item"><span className="dot suspicious"></span> Suspicious</span>
              </div>
            </div>

            {/* Device List */}
            <div className="glass-card device-list">
              <h2>📋 Discovered Devices</h2>
              <div className="device-table">
                <div className="table-header">
                  <span>Status</span>
                  <span>IP Address</span>
                  <span>MAC Address</span>
                  <span>Vendor</span>
                  <span>Type</span>
                  <span>Ports</span>
                  <span>Actions</span>
                </div>
                {discoveredDevices.map(device => (
                  <div key={device.id} className={`table-row ${device.classification}`}>
                    <span className="cell-status">
                      <span className={`status-icon ${device.classification}`}>
                        {device.classification === 'known' && '🟢'}
                        {device.classification === 'authorized' && '✅'}
                        {device.classification === 'unknown' && '🔴'}
                        {device.classification === 'suspicious' && '⚠️'}
                        {device.classification === 'blocked' && '🚫'}
                      </span>
                    </span>
                    <span className="cell-ip">{device.ipAddress}</span>
                    <span className="cell-mac">{device.macAddress || '-'}</span>
                    <span className="cell-vendor">{device.macVendor || 'Unknown'}</span>
                    <span className="cell-type">{device.deviceType}</span>
                    <span className="cell-ports">
                      {device.openPorts?.slice(0, 3).join(', ')}
                      {device.openPorts && device.openPorts.length > 3 && '...'}
                    </span>
                    <span className="cell-actions">
                      {device.classification === 'unknown' && (
                        <>
                          <button className="btn-sm btn-approve" title="Mark as Known">✓</button>
                          <button className="btn-sm btn-suspicious" title="Mark Suspicious">⚠</button>
                          <button className="btn-sm btn-block" title="Block">🚫</button>
                        </>
                      )}
                      {device.classification !== 'unknown' && (
                        <button className="btn-sm btn-edit" title="Edit">✏️</button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {selectedView === 'topology' && (
          <div className="view-topology">
            <div className="glass-card topology-panel">
              <div className="topology-header">
                <h2>🕸️ Interactive Network Topology</h2>
                <div className="topology-controls">
                  <span className="hint">Click a device to see path from Skynet • Drag nodes to reposition • Scroll to zoom</span>
                </div>
              </div>
              <div className="topology-wrapper">
                <NetworkTopology
                  nodes={topologyNodes}
                  links={topologyLinks}
                  width={1200}
                  height={700}
                  onNodeClick={(node) => {
                    console.log('Selected node:', node)
                  }}
                  onPathHighlight={(path) => {
                    console.log('Path from Skynet:', path.map(n => n.name).join(' → '))
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
