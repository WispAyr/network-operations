import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import './NetworkTopology.css'

// Node types for the network
export interface TopologyNode {
  id: string
  name: string
  type: 'skynet' | 'router' | 'switch' | 'gateway' | 'server' | 'camera' | 'workstation' | 'iot' | 'nas' | 'access_point' | 'unknown'
  status: 'online' | 'offline' | 'degraded' | 'unknown'
  ip?: string
  mac?: string
  vendor?: string
  ports?: number[]
  layer: number // 0 = skynet, 1 = core, 2 = distribution, 3 = access, 4 = edge
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}

export interface TopologyLink {
  source: string | TopologyNode
  target: string | TopologyNode
  type: 'wired' | 'wireless' | 'vpn' | 'wan'
  status: 'active' | 'degraded' | 'down'
  bandwidth?: string
  latency?: number
}

interface NetworkTopologyProps {
  nodes: TopologyNode[]
  links: TopologyLink[]
  onNodeClick?: (node: TopologyNode) => void
  onPathHighlight?: (path: TopologyNode[]) => void
  width?: number
  height?: number
}

// Icons for different device types
const nodeIcons: Record<string, string> = {
  skynet: '🤖',
  router: '📡',
  switch: '🔀',
  gateway: '🌐',
  server: '🖥️',
  camera: '📹',
  workstation: '💻',
  iot: '🔌',
  nas: '💾',
  access_point: '📶',
  unknown: '❓',
}

// Color mapping for status
const statusColors: Record<string, string> = {
  online: '#10b981',
  offline: '#ef4444',
  degraded: '#f59e0b',
  unknown: '#6b7280',
}

// Link colors by type
const linkColors: Record<string, string> = {
  wired: '#00d4ff',
  wireless: '#a855f7',
  vpn: '#10b981',
  wan: '#ef4444',
}

export function NetworkTopology({
  nodes,
  links,
  onNodeClick,
  onPathHighlight,
  width = 1000,
  height = 700,
}: NetworkTopologyProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null)
  const [highlightedPath, setHighlightedPath] = useState<string[]>([])
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: TopologyNode } | null>(null)

  // Find path from Skynet to a target node using BFS
  const findPathFromSkynet = useCallback((targetId: string): string[] => {
    const skynetNode = nodes.find(n => n.type === 'skynet')
    if (!skynetNode) return []

    const graph = new Map<string, string[]>()
    
    // Build adjacency list
    links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id
      const targetIdLink = typeof link.target === 'string' ? link.target : link.target.id
      
      if (!graph.has(sourceId)) graph.set(sourceId, [])
      if (!graph.has(targetIdLink)) graph.set(targetIdLink, [])
      
      graph.get(sourceId)!.push(targetIdLink)
      graph.get(targetIdLink)!.push(sourceId)
    })

    // BFS to find shortest path
    const visited = new Set<string>()
    const queue: { id: string; path: string[] }[] = [{ id: skynetNode.id, path: [skynetNode.id] }]
    
    while (queue.length > 0) {
      const { id, path } = queue.shift()!
      
      if (id === targetId) return path
      
      if (visited.has(id)) continue
      visited.add(id)
      
      const neighbors = graph.get(id) || []
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push({ id: neighbor, path: [...path, neighbor] })
        }
      }
    }
    
    return []
  }, [nodes, links])

  // Handle node click
  const handleNodeClick = useCallback((node: TopologyNode) => {
    setSelectedNode(node)
    
    // Find and highlight path from Skynet
    const path = findPathFromSkynet(node.id)
    setHighlightedPath(path)
    
    if (onNodeClick) onNodeClick(node)
    if (onPathHighlight) {
      const pathNodes = path.map(id => nodes.find(n => n.id === id)!).filter(Boolean)
      onPathHighlight(pathNodes)
    }
  }, [findPathFromSkynet, nodes, onNodeClick, onPathHighlight])

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedNode(null)
    setHighlightedPath([])
    setTooltip(null)
  }, [])

  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    // Create container group with zoom support
    const g = svg.append('g')

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })

    svg.call(zoom)

    // Add gradient definitions for links
    const defs = svg.append('defs')
    
    // Glow filter for highlighted elements
    const filter = defs.append('filter')
      .attr('id', 'glow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%')
    
    filter.append('feGaussianBlur')
      .attr('stdDeviation', '4')
      .attr('result', 'coloredBlur')
    
    const feMerge = filter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'coloredBlur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    // Add gradient for path highlighting
    const gradient = defs.append('linearGradient')
      .attr('id', 'pathGradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '100%')
      .attr('y2', '0%')
    
    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#00d4ff')
    
    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#7c3aed')

    // Create force simulation
    const simulation = d3.forceSimulation<TopologyNode>(nodes)
      .force('link', d3.forceLink<TopologyNode, TopologyLink>(links)
        .id(d => d.id)
        .distance(d => {
          const sourceNode = typeof d.source === 'string' ? nodes.find(n => n.id === d.source) : d.source
          const targetNode = typeof d.target === 'string' ? nodes.find(n => n.id === d.target) : d.target
          const layerDiff = Math.abs((sourceNode?.layer || 0) - (targetNode?.layer || 0))
          return 100 + layerDiff * 40
        })
        .strength(0.8)
      )
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('y', d3.forceY<TopologyNode>().y(d => (d.layer * (height - 100) / 4) + 50).strength(0.3))
      .force('collision', d3.forceCollide().radius(60))

    // Create link lines
    const linkGroup = g.append('g').attr('class', 'links')
    
    const link = linkGroup.selectAll('line')
      .data(links)
      .join('line')
      .attr('class', d => `link link-${d.type} link-status-${d.status}`)
      .attr('stroke', d => {
        const sourceId = typeof d.source === 'string' ? d.source : d.source.id
        const targetId = typeof d.target === 'string' ? d.target : d.target.id
        if (highlightedPath.includes(sourceId) && highlightedPath.includes(targetId)) {
          const srcIdx = highlightedPath.indexOf(sourceId)
          const tgtIdx = highlightedPath.indexOf(targetId)
          if (Math.abs(srcIdx - tgtIdx) === 1) {
            return 'url(#pathGradient)'
          }
        }
        return linkColors[d.type] || '#00d4ff'
      })
      .attr('stroke-width', d => d.status === 'down' ? 1 : 2)
      .attr('stroke-dasharray', d => {
        if (d.status === 'down') return '5,5'
        if (d.type === 'wireless') return '3,3'
        if (d.type === 'vpn') return '8,4'
        return 'none'
      })
      .attr('opacity', d => {
        if (highlightedPath.length === 0) return 0.6
        const sourceId = typeof d.source === 'string' ? d.source : d.source.id
        const targetId = typeof d.target === 'string' ? d.target : d.target.id
        const srcIdx = highlightedPath.indexOf(sourceId)
        const tgtIdx = highlightedPath.indexOf(targetId)
        return srcIdx !== -1 && tgtIdx !== -1 && Math.abs(srcIdx - tgtIdx) === 1 ? 1 : 0.2
      })

    // Create node groups
    const nodeGroup = g.append('g').attr('class', 'nodes')
    
    const node = nodeGroup.selectAll<SVGGElement, TopologyNode>('g')
      .data(nodes)
      .join('g')
      .attr('class', d => `node node-${d.type} node-status-${d.status} ${selectedNode?.id === d.id ? 'selected' : ''} ${highlightedPath.includes(d.id) ? 'highlighted' : ''}`)
      .attr('cursor', 'pointer')
      .call(d3.drag<SVGGElement, TopologyNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart()
          d.fx = d.x
          d.fy = d.y
        })
        .on('drag', (event, d) => {
          d.fx = event.x
          d.fy = event.y
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0)
          d.fx = null
          d.fy = null
        })
      )
      .on('click', (event, d) => {
        event.stopPropagation()
        handleNodeClick(d)
      })
      .on('mouseenter', (event, d) => {
        const rect = svgRef.current!.getBoundingClientRect()
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          node: d
        })
      })
      .on('mouseleave', () => {
        setTooltip(null)
      })

    // Node background circle
    node.append('circle')
      .attr('r', d => d.type === 'skynet' ? 40 : d.layer === 1 ? 35 : 30)
      .attr('fill', d => {
        const opacity = highlightedPath.length === 0 || highlightedPath.includes(d.id) ? 0.2 : 0.05
        const color = d3.color(statusColors[d.status])
        return color ? color.copy({ opacity }).formatRgb() : '#1a1a2e'
      })
      .attr('stroke', d => statusColors[d.status])
      .attr('stroke-width', d => {
        if (selectedNode?.id === d.id) return 4
        if (highlightedPath.includes(d.id)) return 3
        return 2
      })
      .attr('filter', d => highlightedPath.includes(d.id) ? 'url(#glow)' : 'none')

    // Node icon
    node.append('text')
      .attr('class', 'node-icon')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', d => d.type === 'skynet' ? '2rem' : '1.5rem')
      .text(d => nodeIcons[d.type] || '❓')
      .attr('opacity', d => highlightedPath.length === 0 || highlightedPath.includes(d.id) ? 1 : 0.4)

    // Node label
    node.append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('y', d => d.type === 'skynet' ? 55 : 45)
      .attr('font-size', '0.7rem')
      .attr('fill', '#e2e8f0')
      .text(d => d.name.length > 15 ? d.name.substring(0, 12) + '...' : d.name)
      .attr('opacity', d => highlightedPath.length === 0 || highlightedPath.includes(d.id) ? 1 : 0.4)

    // Status indicator
    node.append('circle')
      .attr('class', 'status-indicator')
      .attr('cx', d => d.type === 'skynet' ? 28 : 22)
      .attr('cy', d => d.type === 'skynet' ? -28 : -22)
      .attr('r', 6)
      .attr('fill', d => statusColors[d.status])
      .attr('stroke', '#0f0f23')
      .attr('stroke-width', 2)

    // Hop counter for highlighted path
    node.filter(d => highlightedPath.includes(d.id) && highlightedPath.length > 0)
      .append('circle')
      .attr('class', 'hop-badge')
      .attr('cx', d => d.type === 'skynet' ? -28 : -22)
      .attr('cy', d => d.type === 'skynet' ? -28 : -22)
      .attr('r', 12)
      .attr('fill', '#7c3aed')
      .attr('stroke', '#0f0f23')
      .attr('stroke-width', 2)

    node.filter(d => highlightedPath.includes(d.id) && highlightedPath.length > 0)
      .append('text')
      .attr('class', 'hop-number')
      .attr('x', d => d.type === 'skynet' ? -28 : -22)
      .attr('y', d => d.type === 'skynet' ? -28 : -22)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', '0.6rem')
      .attr('font-weight', 'bold')
      .attr('fill', 'white')
      .text(d => highlightedPath.indexOf(d.id))

    // Update positions on simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as TopologyNode).x!)
        .attr('y1', d => (d.source as TopologyNode).y!)
        .attr('x2', d => (d.target as TopologyNode).x!)
        .attr('y2', d => (d.target as TopologyNode).y!)

      node.attr('transform', d => `translate(${d.x},${d.y})`)
    })

    // Click on background to clear selection
    svg.on('click', clearSelection)

    // Cleanup
    return () => {
      simulation.stop()
    }
  }, [nodes, links, width, height, selectedNode, highlightedPath, handleNodeClick, clearSelection])

  // Update visualization when highlighted path changes
  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)

    // Update link appearances
    svg.selectAll<SVGLineElement, TopologyLink>('.link')
      .attr('opacity', d => {
        if (highlightedPath.length === 0) return 0.6
        const sourceId = typeof d.source === 'string' ? d.source : d.source.id
        const targetId = typeof d.target === 'string' ? d.target : d.target.id
        const srcIdx = highlightedPath.indexOf(sourceId)
        const tgtIdx = highlightedPath.indexOf(targetId)
        return srcIdx !== -1 && tgtIdx !== -1 && Math.abs(srcIdx - tgtIdx) === 1 ? 1 : 0.2
      })
      .attr('stroke-width', d => {
        if (highlightedPath.length === 0) return d.status === 'down' ? 1 : 2
        const sourceId = typeof d.source === 'string' ? d.source : d.source.id
        const targetId = typeof d.target === 'string' ? d.target : d.target.id
        const srcIdx = highlightedPath.indexOf(sourceId)
        const tgtIdx = highlightedPath.indexOf(targetId)
        return srcIdx !== -1 && tgtIdx !== -1 && Math.abs(srcIdx - tgtIdx) === 1 ? 4 : 1
      })

    // Update node appearances
    svg.selectAll<SVGGElement, TopologyNode>('.node')
      .classed('highlighted', d => highlightedPath.includes(d.id))
      .classed('dimmed', d => highlightedPath.length > 0 && !highlightedPath.includes(d.id))

  }, [highlightedPath])

  return (
    <div className="network-topology-container">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="network-topology-svg"
      />
      
      {/* Tooltip */}
      {tooltip && (
        <div
          className="topology-tooltip"
          style={{
            left: tooltip.x + 15,
            top: tooltip.y - 10,
          }}
        >
          <div className="tooltip-header">
            <span className="tooltip-icon">{nodeIcons[tooltip.node.type]}</span>
            <span className="tooltip-name">{tooltip.node.name}</span>
          </div>
          <div className="tooltip-body">
            <div className="tooltip-row">
              <span>Status:</span>
              <span className={`status-${tooltip.node.status}`}>{tooltip.node.status}</span>
            </div>
            {tooltip.node.ip && (
              <div className="tooltip-row">
                <span>IP:</span>
                <span className="mono">{tooltip.node.ip}</span>
              </div>
            )}
            {tooltip.node.mac && (
              <div className="tooltip-row">
                <span>MAC:</span>
                <span className="mono">{tooltip.node.mac}</span>
              </div>
            )}
            {tooltip.node.vendor && (
              <div className="tooltip-row">
                <span>Vendor:</span>
                <span>{tooltip.node.vendor}</span>
              </div>
            )}
            {tooltip.node.ports && tooltip.node.ports.length > 0 && (
              <div className="tooltip-row">
                <span>Ports:</span>
                <span className="mono">{tooltip.node.ports.slice(0, 5).join(', ')}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Selected Node Detail Panel */}
      {selectedNode && (
        <div className="detail-panel">
          <div className="detail-header">
            <span className="detail-icon">{nodeIcons[selectedNode.type]}</span>
            <div className="detail-title">
              <h3>{selectedNode.name}</h3>
              <span className={`detail-status status-${selectedNode.status}`}>
                {selectedNode.status.toUpperCase()}
              </span>
            </div>
            <button className="close-btn" onClick={clearSelection}>×</button>
          </div>
          
          <div className="detail-content">
            <div className="detail-section">
              <h4>Device Info</h4>
              <div className="detail-grid">
                <span className="label">Type:</span>
                <span className="value">{selectedNode.type}</span>
                <span className="label">Layer:</span>
                <span className="value">{['Core/Skynet', 'Core', 'Distribution', 'Access', 'Edge'][selectedNode.layer]}</span>
                {selectedNode.ip && (
                  <>
                    <span className="label">IP Address:</span>
                    <span className="value mono">{selectedNode.ip}</span>
                  </>
                )}
                {selectedNode.mac && (
                  <>
                    <span className="label">MAC:</span>
                    <span className="value mono">{selectedNode.mac}</span>
                  </>
                )}
                {selectedNode.vendor && (
                  <>
                    <span className="label">Vendor:</span>
                    <span className="value">{selectedNode.vendor}</span>
                  </>
                )}
              </div>
            </div>

            {highlightedPath.length > 0 && (
              <div className="detail-section">
                <h4>Access Path from Skynet</h4>
                <div className="path-display">
                  {highlightedPath.map((id, idx) => {
                    const pathNode = nodes.find(n => n.id === id)
                    return (
                      <div key={id} className="path-step">
                        <div className="path-hop">{idx}</div>
                        <span className="path-icon">{nodeIcons[pathNode?.type || 'unknown']}</span>
                        <span className="path-name">{pathNode?.name || id}</span>
                        {idx < highlightedPath.length - 1 && <span className="path-arrow">→</span>}
                      </div>
                    )
                  })}
                </div>
                <div className="path-stats">
                  <span><strong>{highlightedPath.length - 1}</strong> hops</span>
                </div>
              </div>
            )}

            {selectedNode.ports && selectedNode.ports.length > 0 && (
              <div className="detail-section">
                <h4>Open Ports</h4>
                <div className="port-list">
                  {selectedNode.ports.map(port => (
                    <span key={port} className="port-badge">{port}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="topology-legend-panel">
        <div className="legend-section">
          <h4>Status</h4>
          <div className="legend-items">
            <div className="legend-item">
              <span className="dot online"></span>
              <span>Online</span>
            </div>
            <div className="legend-item">
              <span className="dot degraded"></span>
              <span>Degraded</span>
            </div>
            <div className="legend-item">
              <span className="dot offline"></span>
              <span>Offline</span>
            </div>
          </div>
        </div>
        <div className="legend-section">
          <h4>Connection</h4>
          <div className="legend-items">
            <div className="legend-item">
              <span className="line wired"></span>
              <span>Wired</span>
            </div>
            <div className="legend-item">
              <span className="line wireless"></span>
              <span>Wireless</span>
            </div>
            <div className="legend-item">
              <span className="line vpn"></span>
              <span>VPN</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default NetworkTopology
