/**
 * SiteTree Component
 * Hierarchical tree view for Sites -> Locations -> Devices navigation
 */

import { useState, useEffect } from 'react';
import './SiteTree.css';
import { API_BASE } from '../config';

// Types for tree nodes
interface DeviceNode {
  id: string;
  name: string;
  type: 'device';
  deviceType: string;
  status: string;
  primaryIp?: string;
}

interface LocationNode {
  id: string;
  name: string;
  type: 'location';
  locationType: string;
  floor?: string;
  children: DeviceNode[];
}

interface SiteNode {
  id: string;
  name: string;
  type: 'site';
  role: string;
  isPrimary: boolean;
  children: LocationNode[];
}

interface VehicleNode {
  id: string;
  name: string;
  type: 'vehicle';
  vehicleType: string;
  currentSiteId?: string;
  children: DeviceNode[];
}

interface TreeData {
  sites: SiteNode[];
  vehicles: VehicleNode[];
  unassigned: DeviceNode[];
}

interface SiteTreeProps {
  onSelect?: (item: { type: string; id: string; name: string }) => void;
  apiUrl?: string;
}

// Icons for different node types
const NodeIcons: Record<string, string> = {
  site: '🏢',
  noc: '🏛️',
  hq: '🏠',
  remote: '📹',
  field: '🎪',
  datacenter: '🖥️',
  customer: '👤',
  location: '📍',
  building: '🏗️',
  room: '🚪',
  outdoor: '🌳',
  cabinet: '📦',
  vehicle: '🚐',
  van: '🚐',
  car: '🚗',
  truck: '🚚',
  trailer: '🏕️',
  device: '📡',
  router: '📡',
  switch: '🔀',
  camera: '📹',
  access_point: '📶',
  gateway: '🌐',
  controller: '🎛️',
  server: '🖥️',
  sensor: '🌡️',
  iot: '🔌',
  workstation: '💻',
  other: '❓',
};

// Status indicators
const StatusColors: Record<string, string> = {
  online: '🟢',
  offline: '🔴',
  degraded: '🟡',
  unknown: '⚪',
};

function TreeNode({
  node,
  level,
  expanded,
  onToggle,
  onSelect,
}: {
  node: SiteNode | LocationNode | VehicleNode | DeviceNode;
  level: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect?: (item: { type: string; id: string; name: string }) => void;
}) {
  const nodeKey = `${node.type}-${node.id}`;
  const isExpanded = expanded.has(nodeKey);
  const hasChildren = 'children' in node && node.children && node.children.length > 0;

  // Get the appropriate icon
  const getIcon = () => {
    if (node.type === 'site') {
      const siteNode = node as SiteNode;
      return NodeIcons[siteNode.role] || NodeIcons.site;
    }
    if (node.type === 'location') {
      const locNode = node as LocationNode;
      return NodeIcons[locNode.locationType] || NodeIcons.location;
    }
    if (node.type === 'vehicle') {
      const vehNode = node as VehicleNode;
      return NodeIcons[vehNode.vehicleType] || NodeIcons.vehicle;
    }
    if (node.type === 'device') {
      const devNode = node as DeviceNode;
      return NodeIcons[devNode.deviceType] || NodeIcons.device;
    }
    return '❓';
  };

  // Get status for devices
  const getStatus = () => {
    if (node.type === 'device') {
      const devNode = node as DeviceNode;
      return StatusColors[devNode.status] || StatusColors.unknown;
    }
    return null;
  };

  return (
    <div className="tree-node">
      <div
        className={`tree-node-content level-${level}`}
        style={{ paddingLeft: `${level * 20 + 8}px` }}
        onClick={() => onSelect?.({ type: node.type, id: node.id, name: node.name })}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <span 
            className="tree-toggle"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(nodeKey);
            }}
          >
            {isExpanded ? '▼' : '▶'}
          </span>
        ) : (
          <span className="tree-toggle-spacer" />
        )}

        {/* Icon */}
        <span className="tree-icon">{getIcon()}</span>

        {/* Name */}
        <span className="tree-name">{node.name}</span>

        {/* Status (for devices) */}
        {getStatus() && (
          <span className="tree-status" title={node.type === 'device' ? (node as DeviceNode).status : ''}>
            {getStatus()}
          </span>
        )}

        {/* IP address (for devices) */}
        {node.type === 'device' && (node as DeviceNode).primaryIp && (
          <span className="tree-ip">{(node as DeviceNode).primaryIp}</span>
        )}

        {/* Badge for site role */}
        {node.type === 'site' && (node as SiteNode).isPrimary && (
          <span className="tree-badge primary">PRIMARY</span>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="tree-children">
          {(node as SiteNode | LocationNode | VehicleNode).children.map((child) => (
            <TreeNode
              key={`${child.type}-${child.id}`}
              node={child}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SiteTree({ onSelect, apiUrl = API_BASE }: SiteTreeProps) {
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch tree data
  useEffect(() => {
    fetchTreeData();
  }, [apiUrl]);

  const fetchTreeData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${apiUrl}/sites/tree`);
      if (!response.ok) throw new Error('Failed to fetch tree data');
      const data = await response.json();
      setTreeData(data);
      
      // Auto-expand primary sites
      const newExpanded = new Set<string>();
      data.sites.forEach((site: SiteNode) => {
        if (site.isPrimary) {
          newExpanded.add(`site-${site.id}`);
        }
      });
      setExpanded(newExpanded);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tree');
      // Use mock data for demo
      fetch(`${API_BASE}/sites/tree`).then(r => r.json()).then(data => setTreeData(data || { sites: [], vehicles: [], unassigned: [] })).catch(() => setTreeData({ sites: [], vehicles: [], unassigned: [] }));
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (nodeKey: string) => {
    setExpanded(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeKey)) {
        newSet.delete(nodeKey);
      } else {
        newSet.add(nodeKey);
      }
      return newSet;
    });
  };

  const expandAll = () => {
    const allKeys = new Set<string>();
    treeData?.sites.forEach(site => {
      allKeys.add(`site-${site.id}`);
      site.children.forEach(loc => {
        allKeys.add(`location-${loc.id}`);
      });
    });
    treeData?.vehicles.forEach(v => {
      allKeys.add(`vehicle-${v.id}`);
    });
    setExpanded(allKeys);
  };

  const collapseAll = () => {
    setExpanded(new Set());
  };

  // Filter tree based on search
  const filterTree = (data: TreeData): TreeData => {
    if (!searchTerm) return data;
    
    const term = searchTerm.toLowerCase();
    
    const filterDevices = (devices: DeviceNode[]) =>
      devices.filter(d => 
        d.name.toLowerCase().includes(term) ||
        d.primaryIp?.toLowerCase().includes(term)
      );
    
    const filterLocations = (locations: LocationNode[]) =>
      locations
        .map(loc => ({
          ...loc,
          children: filterDevices(loc.children),
        }))
        .filter(loc => 
          loc.name.toLowerCase().includes(term) ||
          loc.children.length > 0
        );
    
    const filteredSites = data.sites
      .map(site => ({
        ...site,
        children: filterLocations(site.children),
      }))
      .filter(site =>
        site.name.toLowerCase().includes(term) ||
        site.children.length > 0
      );
    
    const filteredVehicles = data.vehicles
      .map(v => ({
        ...v,
        children: filterDevices(v.children),
      }))
      .filter(v =>
        v.name.toLowerCase().includes(term) ||
        v.children.length > 0
      );
    
    const filteredUnassigned = filterDevices(data.unassigned);
    
    return {
      sites: filteredSites,
      vehicles: filteredVehicles,
      unassigned: filteredUnassigned,
    };
  };

  if (loading) {
    return <div className="site-tree loading">Loading...</div>;
  }

  if (!treeData) {
    return <div className="site-tree error">{error || 'No data'}</div>;
  }

  const filteredData = filterTree(treeData);

  return (
    <div className="site-tree">
      {/* Header */}
      <div className="tree-header">
        <h3>🏢 Infrastructure</h3>
        <div className="tree-actions">
          <button onClick={expandAll} title="Expand All">⊞</button>
          <button onClick={collapseAll} title="Collapse All">⊟</button>
          <button onClick={fetchTreeData} title="Refresh">🔄</button>
        </div>
      </div>

      {/* Search */}
      <div className="tree-search">
        <input
          type="text"
          placeholder="🔍 Search sites, locations, devices..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Tree content */}
      <div className="tree-content">
        {/* Sites Section */}
        {filteredData.sites.length > 0 && (
          <div className="tree-section">
            <div className="tree-section-header">Sites ({filteredData.sites.length})</div>
            {filteredData.sites.map(site => (
              <TreeNode
                key={`site-${site.id}`}
                node={site}
                level={0}
                expanded={expanded}
                onToggle={toggleExpanded}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}

        {/* Vehicles Section */}
        {filteredData.vehicles.length > 0 && (
          <div className="tree-section">
            <div className="tree-section-header">🚐 Vehicles ({filteredData.vehicles.length})</div>
            {filteredData.vehicles.map(vehicle => (
              <TreeNode
                key={`vehicle-${vehicle.id}`}
                node={vehicle}
                level={0}
                expanded={expanded}
                onToggle={toggleExpanded}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}

        {/* Unassigned Devices */}
        {filteredData.unassigned.length > 0 && (
          <div className="tree-section">
            <div className="tree-section-header warning">⚠️ Unassigned ({filteredData.unassigned.length})</div>
            {filteredData.unassigned.map(device => (
              <TreeNode
                key={`device-${device.id}`}
                node={device}
                level={0}
                expanded={expanded}
                onToggle={toggleExpanded}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {filteredData.sites.length === 0 && 
         filteredData.vehicles.length === 0 && 
         filteredData.unassigned.length === 0 && (
          <div className="tree-empty">
            {searchTerm ? 'No matches found' : 'No infrastructure defined yet'}
          </div>
        )}
      </div>
    </div>
  );
}

// Mock data for demo/development
function getMockData(): TreeData {
  return {
    sites: [
      {
        id: 'site-1',
        name: 'NOC - Edinburgh',
        type: 'site',
        role: 'noc',
        isPrimary: true,
        children: [
          {
            id: 'loc-1',
            name: 'Server Room',
            type: 'location',
            locationType: 'room',
            floor: 'Ground',
            children: [
              { id: 'dev-1', name: 'Core Router', type: 'device', deviceType: 'router', status: 'online', primaryIp: '10.0.0.1' },
              { id: 'dev-2', name: 'Cloud Key Gen2+', type: 'device', deviceType: 'controller', status: 'online', primaryIp: '10.0.0.10' },
              { id: 'dev-3', name: 'Main Switch', type: 'device', deviceType: 'switch', status: 'online', primaryIp: '10.0.0.2' },
            ],
          },
          {
            id: 'loc-2',
            name: 'Front Entrance',
            type: 'location',
            locationType: 'outdoor',
            children: [
              { id: 'dev-4', name: 'PTZ Camera 01', type: 'device', deviceType: 'camera', status: 'online', primaryIp: '10.0.1.100' },
            ],
          },
        ],
      },
      {
        id: 'site-2',
        name: 'Kyle Rise',
        type: 'site',
        role: 'remote',
        isPrimary: false,
        children: [
          {
            id: 'loc-3',
            name: 'Equipment Cabinet',
            type: 'location',
            locationType: 'cabinet',
            children: [
              { id: 'dev-5', name: 'Starlink Terminal', type: 'device', deviceType: 'gateway', status: 'online', primaryIp: '192.168.100.1' },
              { id: 'dev-6', name: 'LTE Modem', type: 'device', deviceType: 'gateway', status: 'degraded', primaryIp: '192.168.200.1' },
            ],
          },
        ],
      },
      {
        id: 'site-3',
        name: 'Greenford',
        type: 'site',
        role: 'customer',
        isPrimary: false,
        children: [
          {
            id: 'loc-4',
            name: 'Gate House',
            type: 'location',
            locationType: 'building',
            children: [
              { id: 'dev-7', name: 'Entry Camera', type: 'device', deviceType: 'camera', status: 'online', primaryIp: '172.16.0.10' },
            ],
          },
        ],
      },
    ],
    vehicles: [
      {
        id: 'veh-1',
        name: 'Operations Van 1',
        type: 'vehicle',
        vehicleType: 'van',
        children: [
          { id: 'dev-8', name: 'Mobile Router', type: 'device', deviceType: 'router', status: 'online', primaryIp: '10.100.0.1' },
          { id: 'dev-9', name: 'Dash Cam', type: 'device', deviceType: 'camera', status: 'online' },
        ],
      },
      {
        id: 'veh-2',
        name: 'MACC Unit',
        type: 'vehicle',
        vehicleType: 'trailer',
        children: [
          { id: 'dev-10', name: 'MACC Server', type: 'device', deviceType: 'server', status: 'online', primaryIp: '10.200.0.1' },
          { id: 'dev-11', name: 'PTZ Mast Camera', type: 'device', deviceType: 'camera', status: 'offline' },
        ],
      },
    ],
    unassigned: [
      { id: 'dev-12', name: 'Spare Router', type: 'device', deviceType: 'router', status: 'unknown' },
    ],
  };
}

export default SiteTree;
