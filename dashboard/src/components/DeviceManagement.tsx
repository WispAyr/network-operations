import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../config';

// Types matching backend schema
interface Device {
  id: string;
  name: string;
  type: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  locationId?: string;
  vehicleId?: string;
  status: 'online' | 'offline' | 'degraded' | 'unknown';
  lastSeen?: Date;
  primaryIp?: string;
  primaryMac?: string;
  hostname?: string;
  managementUrl?: string;
  sshPort?: number;
  httpPort?: number;
  platformType?: 'zerotier' | 'unifi' | 'uisp' | 'manual' | 'other';
  platformDeviceId?: string;
  notes?: string;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface NetworkLink {
  id: string;
  deviceId: string;
  networkId: string;
  ipAddress?: string;
  macAddress?: string;
  interfaceName?: string;
  isManagementInterface: boolean;
  status: string;
  network?: {
    id: string;
    name: string;
    cidr?: string;
    trustZone?: string;
  };
}

interface AccessPath {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  lastTestStatus: string;
  hops: PathHop[];
}

interface PathHop {
  id: string;
  order: number;
  type: string;
  targetAddress: string;
  targetPort?: number;
  status: string;
}

interface DeviceDetail extends Device {
  networkLinks: NetworkLink[];
  accessPaths: AccessPath[];
  location?: {
    id: string;
    name: string;
    siteId: string;
  };
}

interface Platform {
  id: string;
  name: string;
  status: string;
}

interface SyncPreview {
  platform: string;
  devices: {
    total: number;
    new: number;
    existing: number;
    items: { platformId: string; name: string; type: string; status: string }[];
  };
  networks: {
    total: number;
    items: { id: string; name: string; type: string }[];
  };
}

// Device type icons
const deviceIcons: Record<string, string> = {
  router: '📡',
  switch: '🔀',
  access_point: '📶',
  gateway: '🌐',
  server: '🖥️',
  camera: '📹',
  controller: '🎛️',
  sensor: '📊',
  iot: '🔌',
  workstation: '💻',
  other: '📦',
};

const statusColors: Record<string, string> = {
  online: '#22c55e',
  offline: '#ef4444',
  degraded: '#f59e0b',
  unknown: '#6b7280',
};

const platformColors: Record<string, string> = {
  zerotier: '#ffb000',
  unifi: '#007bff',
  uisp: '#3498db',
  manual: '#6b7280',
  other: '#9ca3af',
};

// Main Device Management Component
export default function DeviceManagement() {
  const [view, setView] = useState<'list' | 'detail' | 'add' | 'edit' | 'import'>('list');
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<DeviceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [platformFilter, setPlatformFilter] = useState<string>('');
  
  // Stats
  const [stats, setStats] = useState<{
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    byPlatform: Record<string, number>;
  } | null>(null);

  // Fetch devices
  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('type', typeFilter);
      if (platformFilter) params.set('platformType', platformFilter);
      
      const res = await fetch(`${API_BASE}/devices?${params}`);
      if (!res.ok) throw new Error('Failed to fetch devices');
      const data = await res.json();
      setDevices(data.devices);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, typeFilter, platformFilter]);

  // Fetch device stats
  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/devices/stats/summary`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  // Fetch device details
  const fetchDeviceDetail = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/devices/${id}`);
      if (!res.ok) throw new Error('Failed to fetch device');
      const data = await res.json();
      setSelectedDevice(data);
      setView('detail');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Delete device
  const deleteDevice = async (id: string) => {
    if (!confirm('Are you sure you want to delete this device?')) return;
    
    try {
      const res = await fetch(`${API_BASE}/devices/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete device');
      fetchDevices();
      if (selectedDevice?.id === id) {
        setSelectedDevice(null);
        setView('list');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  useEffect(() => {
    fetchDevices();
    fetchStats();
  }, [fetchDevices]);

  return (
    <div className="device-management">
      {/* Header */}
      <div className="dm-header">
        <h2>📱 Device Management</h2>
        <div className="dm-actions">
          <button 
            className="btn btn-primary"
            onClick={() => setView('add')}
          >
            ➕ Add Device
          </button>
          <button 
            className="btn btn-secondary"
            onClick={() => setView('import')}
          >
            📥 Import from Platform
          </button>
          <button 
            className="btn btn-secondary"
            onClick={() => { fetchDevices(); fetchStats(); }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="dm-error">
          ⚠️ {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Stats Bar */}
      {stats && (
        <div className="dm-stats">
          <div className="stat-item">
            <span className="stat-value">{stats.total}</span>
            <span className="stat-label">Total Devices</span>
          </div>
          <div className="stat-item online">
            <span className="stat-value">{stats.byStatus.online || 0}</span>
            <span className="stat-label">Online</span>
          </div>
          <div className="stat-item offline">
            <span className="stat-value">{stats.byStatus.offline || 0}</span>
            <span className="stat-label">Offline</span>
          </div>
          <div className="stat-item degraded">
            <span className="stat-value">{stats.byStatus.degraded || 0}</span>
            <span className="stat-label">Degraded</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      {view === 'list' && (
        <DeviceList
          devices={devices}
          loading={loading}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          platformFilter={platformFilter}
          setPlatformFilter={setPlatformFilter}
          onSelect={fetchDeviceDetail}
          onEdit={(id) => { fetchDeviceDetail(id); setView('edit'); }}
          onDelete={deleteDevice}
        />
      )}

      {view === 'detail' && selectedDevice && (
        <DeviceDetail
          device={selectedDevice}
          onBack={() => { setView('list'); setSelectedDevice(null); }}
          onEdit={() => setView('edit')}
          onDelete={() => deleteDevice(selectedDevice.id)}
        />
      )}

      {(view === 'add' || view === 'edit') && (
        <DeviceForm
          device={view === 'edit' ? selectedDevice : null}
          onSave={() => { fetchDevices(); setView('list'); setSelectedDevice(null); }}
          onCancel={() => { setView(selectedDevice ? 'detail' : 'list'); }}
        />
      )}

      {view === 'import' && (
        <PlatformImport
          onComplete={() => { fetchDevices(); fetchStats(); setView('list'); }}
          onCancel={() => setView('list')}
        />
      )}
    </div>
  );
}

// Device List Component
function DeviceList({
  devices,
  loading,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  typeFilter,
  setTypeFilter,
  platformFilter,
  setPlatformFilter,
  onSelect,
  onEdit,
  onDelete,
}: {
  devices: Device[];
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  statusFilter: string;
  setStatusFilter: (s: string) => void;
  typeFilter: string;
  setTypeFilter: (t: string) => void;
  platformFilter: string;
  setPlatformFilter: (p: string) => void;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="device-list-view">
      {/* Filters */}
      <div className="dm-filters">
        <input
          type="text"
          placeholder="🔍 Search devices..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
        <select 
          value={statusFilter} 
          onChange={(e) => setStatusFilter(e.target.value)}
          className="filter-select"
        >
          <option value="">All Status</option>
          <option value="online">🟢 Online</option>
          <option value="offline">🔴 Offline</option>
          <option value="degraded">🟡 Degraded</option>
          <option value="unknown">⚪ Unknown</option>
        </select>
        <select 
          value={typeFilter} 
          onChange={(e) => setTypeFilter(e.target.value)}
          className="filter-select"
        >
          <option value="">All Types</option>
          <option value="router">📡 Router</option>
          <option value="switch">🔀 Switch</option>
          <option value="access_point">📶 Access Point</option>
          <option value="camera">📹 Camera</option>
          <option value="server">🖥️ Server</option>
          <option value="gateway">🌐 Gateway</option>
          <option value="controller">🎛️ Controller</option>
        </select>
        <select 
          value={platformFilter} 
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="filter-select"
        >
          <option value="">All Platforms</option>
          <option value="zerotier">ZeroTier</option>
          <option value="unifi">UniFi</option>
          <option value="uisp">UISP</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      {/* Device Grid */}
      {loading ? (
        <div className="dm-loading">Loading devices...</div>
      ) : devices.length === 0 ? (
        <div className="dm-empty">
          <span className="empty-icon">📭</span>
          <p>No devices found</p>
          <p className="empty-hint">Add a device or import from a platform</p>
        </div>
      ) : (
        <div className="device-grid">
          {devices.map((device) => (
            <div 
              key={device.id} 
              className={`device-card ${device.status}`}
              onClick={() => onSelect(device.id)}
            >
              <div className="device-card-header">
                <span className="device-icon">{deviceIcons[device.type] || '📦'}</span>
                <span 
                  className="device-status"
                  style={{ backgroundColor: statusColors[device.status] }}
                  title={device.status}
                />
              </div>
              <div className="device-card-body">
                <h3 className="device-name">{device.name}</h3>
                <p className="device-type">{device.type}</p>
                {device.primaryIp && (
                  <p className="device-ip">{device.primaryIp}</p>
                )}
                {device.platformType && (
                  <span 
                    className="platform-badge"
                    style={{ backgroundColor: platformColors[device.platformType] }}
                  >
                    {device.platformType}
                  </span>
                )}
              </div>
              <div className="device-card-actions">
                <button 
                  onClick={(e) => { e.stopPropagation(); onEdit(device.id); }}
                  title="Edit"
                >
                  ✏️
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); onDelete(device.id); }}
                  title="Delete"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Device Detail Component
function DeviceDetail({
  device,
  onBack,
  onEdit,
  onDelete,
}: {
  device: DeviceDetail;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="device-detail-view">
      <div className="detail-header">
        <button className="btn btn-back" onClick={onBack}>← Back</button>
        <div className="detail-actions">
          <button className="btn btn-primary" onClick={onEdit}>✏️ Edit</button>
          <button className="btn btn-danger" onClick={onDelete}>🗑️ Delete</button>
        </div>
      </div>

      <div className="detail-main">
        {/* Device Info Card */}
        <div className="detail-card info-card">
          <div className="card-header">
            <span className="device-icon-large">{deviceIcons[device.type] || '📦'}</span>
            <div>
              <h2>{device.name}</h2>
              <span 
                className="status-badge"
                style={{ backgroundColor: statusColors[device.status] }}
              >
                {device.status.toUpperCase()}
              </span>
            </div>
          </div>

          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Type</span>
              <span className="info-value">{device.type}</span>
            </div>
            {device.manufacturer && (
              <div className="info-item">
                <span className="info-label">Manufacturer</span>
                <span className="info-value">{device.manufacturer}</span>
              </div>
            )}
            {device.model && (
              <div className="info-item">
                <span className="info-label">Model</span>
                <span className="info-value">{device.model}</span>
              </div>
            )}
            {device.serialNumber && (
              <div className="info-item">
                <span className="info-label">Serial Number</span>
                <span className="info-value mono">{device.serialNumber}</span>
              </div>
            )}
            {device.firmwareVersion && (
              <div className="info-item">
                <span className="info-label">Firmware</span>
                <span className="info-value">{device.firmwareVersion}</span>
              </div>
            )}
            {device.platformType && (
              <div className="info-item">
                <span className="info-label">Platform</span>
                <span 
                  className="platform-badge"
                  style={{ backgroundColor: platformColors[device.platformType] }}
                >
                  {device.platformType}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Network Addresses Card */}
        <div className="detail-card addresses-card">
          <h3>🌐 Network Addresses</h3>
          <div className="addresses-grid">
            {device.primaryIp && (
              <div className="address-item primary">
                <span className="address-label">Primary IP</span>
                <span className="address-value mono">{device.primaryIp}</span>
              </div>
            )}
            {device.primaryMac && (
              <div className="address-item">
                <span className="address-label">MAC Address</span>
                <span className="address-value mono">{device.primaryMac}</span>
              </div>
            )}
            {device.hostname && (
              <div className="address-item">
                <span className="address-label">Hostname</span>
                <span className="address-value mono">{device.hostname}</span>
              </div>
            )}
          </div>

          {device.networkLinks && device.networkLinks.length > 0 && (
            <div className="network-links-section">
              <h4>Network Interfaces</h4>
              <table className="links-table">
                <thead>
                  <tr>
                    <th>Network</th>
                    <th>IP Address</th>
                    <th>Interface</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {device.networkLinks.map((link) => (
                    <tr key={link.id}>
                      <td>
                        {link.network?.name || link.networkId}
                        {link.network?.trustZone && (
                          <span className={`trust-badge trust-${link.network.trustZone}`}>
                            {link.network.trustZone}
                          </span>
                        )}
                      </td>
                      <td className="mono">{link.ipAddress || '-'}</td>
                      <td>{link.interfaceName || '-'}</td>
                      <td>
                        <span className={`status-dot ${link.status}`}>●</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Access Card */}
        <div className="detail-card access-card">
          <h3>🔑 Access Information</h3>
          <div className="access-grid">
            {device.managementUrl && (
              <div className="access-item">
                <span className="access-label">Management URL</span>
                <a href={device.managementUrl} target="_blank" rel="noreferrer" className="access-link">
                  {device.managementUrl} ↗
                </a>
              </div>
            )}
            {device.sshPort && (
              <div className="access-item">
                <span className="access-label">SSH</span>
                <span className="access-value mono">
                  ssh {device.primaryIp}:{device.sshPort}
                </span>
              </div>
            )}
            {device.httpPort && (
              <div className="access-item">
                <span className="access-label">HTTP Port</span>
                <span className="access-value">{device.httpPort}</span>
              </div>
            )}
          </div>

          {device.accessPaths && device.accessPaths.length > 0 && (
            <div className="access-paths-section">
              <h4>Access Paths</h4>
              {device.accessPaths.map((path) => (
                <div key={path.id} className={`access-path ${path.isDefault ? 'default' : ''}`}>
                  <div className="path-header">
                    <span className="path-name">{path.name}</span>
                    {path.isDefault && <span className="default-badge">Default</span>}
                    <span className={`path-status ${path.lastTestStatus}`}>
                      {path.lastTestStatus}
                    </span>
                  </div>
                  <div className="path-hops">
                    {path.hops.map((hop, idx) => (
                      <div key={hop.id} className="path-hop">
                        {idx > 0 && <span className="hop-arrow">→</span>}
                        <span className={`hop-badge ${hop.type}`}>
                          {hop.type}: {hop.targetAddress}
                          {hop.targetPort && `:${hop.targetPort}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        {device.notes && (
          <div className="detail-card notes-card">
            <h3>📝 Notes</h3>
            <p>{device.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Device Form Component
function DeviceForm({
  device,
  onSave,
  onCancel,
}: {
  device: DeviceDetail | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    name: device?.name || '',
    type: device?.type || 'other',
    manufacturer: device?.manufacturer || '',
    model: device?.model || '',
    serialNumber: device?.serialNumber || '',
    firmwareVersion: device?.firmwareVersion || '',
    primaryIp: device?.primaryIp || '',
    primaryMac: device?.primaryMac || '',
    hostname: device?.hostname || '',
    managementUrl: device?.managementUrl || '',
    sshPort: device?.sshPort?.toString() || '',
    httpPort: device?.httpPort?.toString() || '',
    platformType: device?.platformType || 'manual',
    status: device?.status || 'unknown',
    notes: device?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const payload = {
        ...formData,
        sshPort: formData.sshPort ? parseInt(formData.sshPort) : undefined,
        httpPort: formData.httpPort ? parseInt(formData.httpPort) : undefined,
      };

      const url = device 
        ? `${API_BASE}/devices/${device.id}` 
        : `${API_BASE}/devices`;
      
      const res = await fetch(url, {
        method: device ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save device');
      }

      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="device-form-view">
      <div className="form-header">
        <h2>{device ? '✏️ Edit Device' : '➕ Add Device'}</h2>
      </div>

      {error && (
        <div className="form-error">⚠️ {error}</div>
      )}

      <form onSubmit={handleSubmit} className="device-form">
        <div className="form-section">
          <h3>Basic Information</h3>
          <div className="form-grid">
            <div className="form-group">
              <label>Device Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="e.g., Core Router"
              />
            </div>
            <div className="form-group">
              <label>Type *</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                required
              >
                <option value="router">📡 Router</option>
                <option value="switch">🔀 Switch</option>
                <option value="access_point">📶 Access Point</option>
                <option value="gateway">🌐 Gateway</option>
                <option value="server">🖥️ Server</option>
                <option value="camera">📹 Camera</option>
                <option value="controller">🎛️ Controller</option>
                <option value="sensor">📊 Sensor</option>
                <option value="iot">🔌 IoT Device</option>
                <option value="workstation">💻 Workstation</option>
                <option value="other">📦 Other</option>
              </select>
            </div>
            <div className="form-group">
              <label>Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
              >
                <option value="online">🟢 Online</option>
                <option value="offline">🔴 Offline</option>
                <option value="degraded">🟡 Degraded</option>
                <option value="unknown">⚪ Unknown</option>
              </select>
            </div>
            <div className="form-group">
              <label>Platform</label>
              <select
                value={formData.platformType}
                onChange={(e) => setFormData({ ...formData, platformType: e.target.value as any })}
              >
                <option value="manual">Manual</option>
                <option value="zerotier">ZeroTier</option>
                <option value="unifi">UniFi</option>
                <option value="uisp">UISP</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>Hardware Details</h3>
          <div className="form-grid">
            <div className="form-group">
              <label>Manufacturer</label>
              <input
                type="text"
                value={formData.manufacturer}
                onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                placeholder="e.g., Ubiquiti"
              />
            </div>
            <div className="form-group">
              <label>Model</label>
              <input
                type="text"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                placeholder="e.g., USG-Pro-4"
              />
            </div>
            <div className="form-group">
              <label>Serial Number</label>
              <input
                type="text"
                value={formData.serialNumber}
                onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Firmware Version</label>
              <input
                type="text"
                value={formData.firmwareVersion}
                onChange={(e) => setFormData({ ...formData, firmwareVersion: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>Network Configuration</h3>
          <div className="form-grid">
            <div className="form-group">
              <label>Primary IP Address</label>
              <input
                type="text"
                value={formData.primaryIp}
                onChange={(e) => setFormData({ ...formData, primaryIp: e.target.value })}
                placeholder="e.g., 192.168.1.1"
              />
            </div>
            <div className="form-group">
              <label>MAC Address</label>
              <input
                type="text"
                value={formData.primaryMac}
                onChange={(e) => setFormData({ ...formData, primaryMac: e.target.value })}
                placeholder="e.g., 00:1A:2B:3C:4D:5E"
              />
            </div>
            <div className="form-group">
              <label>Hostname</label>
              <input
                type="text"
                value={formData.hostname}
                onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>Access Configuration</h3>
          <div className="form-grid">
            <div className="form-group full-width">
              <label>Management URL</label>
              <input
                type="url"
                value={formData.managementUrl}
                onChange={(e) => setFormData({ ...formData, managementUrl: e.target.value })}
                placeholder="e.g., https://192.168.1.1"
              />
            </div>
            <div className="form-group">
              <label>SSH Port</label>
              <input
                type="number"
                value={formData.sshPort}
                onChange={(e) => setFormData({ ...formData, sshPort: e.target.value })}
                placeholder="22"
              />
            </div>
            <div className="form-group">
              <label>HTTP Port</label>
              <input
                type="number"
                value={formData.httpPort}
                onChange={(e) => setFormData({ ...formData, httpPort: e.target.value })}
                placeholder="80"
              />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>Notes</h3>
          <div className="form-group full-width">
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              placeholder="Any additional notes about this device..."
            />
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : (device ? 'Update Device' : 'Create Device')}
          </button>
        </div>
      </form>
    </div>
  );
}

// Platform Import Component
function PlatformImport({
  onComplete,
  onCancel,
}: {
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);

  // Fetch available platforms
  useEffect(() => {
    fetch(`${API_BASE}/sync/platforms`)
      .then(res => res.json())
      .then(data => setPlatforms(data.platforms))
      .catch(err => setError('Failed to fetch platforms'));
  }, []);

  // Preview sync
  const handlePreview = async (platform: string) => {
    setLoading(true);
    setError(null);
    setSelectedPlatform(platform);
    
    try {
      const res = await fetch(`${API_BASE}/sync/preview/${platform}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to preview');
      }
      const data = await res.json();
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Execute sync
  const handleSync = async () => {
    if (!selectedPlatform) return;
    
    setSyncing(true);
    setError(null);
    
    try {
      const res = await fetch(`${API_BASE}/sync/execute/${selectedPlatform}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeNetworks: true, updateExisting: true }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Sync failed');
      }
      
      const data = await res.json();
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="platform-import-view">
      <div className="import-header">
        <h2>📥 Import from Platform</h2>
        <button className="btn btn-back" onClick={onCancel}>← Back</button>
      </div>

      {error && (
        <div className="import-error">⚠️ {error}</div>
      )}

      {results ? (
        <div className="import-results">
          <h3>✅ Import Complete</h3>
          <div className="results-grid">
            <div className="result-item">
              <span className="result-value">{results.devices.created}</span>
              <span className="result-label">Devices Created</span>
            </div>
            <div className="result-item">
              <span className="result-value">{results.devices.updated}</span>
              <span className="result-label">Devices Updated</span>
            </div>
            <div className="result-item">
              <span className="result-value">{results.networks.created}</span>
              <span className="result-label">Networks Created</span>
            </div>
          </div>
          {results.errors.length > 0 && (
            <div className="results-errors">
              <h4>Errors ({results.errors.length})</h4>
              <ul>
                {results.errors.map((err: string, i: number) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn btn-primary" onClick={onComplete}>
            Done
          </button>
        </div>
      ) : (
        <>
          {/* Platform Selection */}
          <div className="platform-grid">
            {platforms.length === 0 ? (
              <div className="no-platforms">
                <p>No platforms configured.</p>
                <p className="hint">Configure platforms in your .env file:</p>
                <code>
                  ZEROTIER_API_TOKEN=your_token<br/>
                  UNIFI_CONTROLLER_URL=https://...<br/>
                  UISP_URL=https://...
                </code>
              </div>
            ) : (
              platforms.map((platform) => (
                <div 
                  key={platform.id}
                  className={`platform-card ${selectedPlatform === platform.id ? 'selected' : ''}`}
                  onClick={() => handlePreview(platform.id)}
                >
                  <span className="platform-icon">
                    {platform.id === 'zerotier' && '🔒'}
                    {platform.id === 'unifi' && '📡'}
                    {platform.id === 'uisp' && '🌐'}
                  </span>
                  <span className="platform-name">{platform.name}</span>
                  <span className={`platform-status ${platform.status}`}>
                    {platform.status}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Preview */}
          {loading && (
            <div className="import-loading">Loading preview...</div>
          )}

          {preview && !loading && (
            <div className="import-preview">
              <h3>Preview: {preview.platform}</h3>
              
              <div className="preview-stats">
                <div className="preview-stat">
                  <span className="stat-value">{preview.devices.total}</span>
                  <span className="stat-label">Devices Found</span>
                </div>
                <div className="preview-stat new">
                  <span className="stat-value">{preview.devices.new}</span>
                  <span className="stat-label">New</span>
                </div>
                <div className="preview-stat existing">
                  <span className="stat-value">{preview.devices.existing}</span>
                  <span className="stat-label">Existing</span>
                </div>
                <div className="preview-stat">
                  <span className="stat-value">{preview.networks.total}</span>
                  <span className="stat-label">Networks</span>
                </div>
              </div>

              <div className="preview-devices">
                <h4>Devices to Import</h4>
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.devices.items.slice(0, 10).map((item) => (
                      <tr key={item.platformId} className={item.status}>
                        <td>{item.name}</td>
                        <td>{item.type}</td>
                        <td>
                          <span className={`status-badge ${item.status}`}>
                            {item.status === 'new' ? '🆕 New' : '↻ Update'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.devices.items.length > 10 && (
                  <p className="preview-more">
                    ... and {preview.devices.items.length - 10} more devices
                  </p>
                )}
              </div>

              <div className="import-actions">
                <button 
                  className="btn btn-primary btn-lg"
                  onClick={handleSync}
                  disabled={syncing}
                >
                  {syncing ? '⏳ Importing...' : '📥 Import All'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
