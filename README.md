# NetOps - Network Operations Management Platform

A comprehensive platform for managing devices across sites, locations, vehicles, and complex network topologies. Designed to visualize and troubleshoot multi-hop access paths through various networking technologies.

## Features

- **Multi-Site Management**: Organize devices by sites, locations, and vehicles
- **Network Topology Tracking**: Support for ZeroTier, UniFi, UISP, and more
- **Access Path Visualization**: Trace complex access chains through multiple hops
- **MCP Integration**: AI-powered network management via Model Context Protocol
- **Platform Sync**: Automatic device discovery from connected platforms

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your API credentials
# Then start the MCP server
npm run dev:mcp

# Or start the REST API server
npm run dev
```

## MCP Integration

Add to your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "netops": {
      "command": "node",
      "args": ["/path/to/netops/dist/mcp/server.js"],
      "env": {
        "ZEROTIER_API_TOKEN": "your-token",
        "UNIFI_CONTROLLER_URL": "https://your-controller:8443",
        "UNIFI_USERNAME": "admin",
        "UNIFI_PASSWORD": "your-password"
      }
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `list_sites` | List all sites with locations and device counts |
| `create_site` | Create a new site |
| `create_location` | Create a location within a site |
| `list_devices` | List devices with filters |
| `get_device` | Get detailed device info + network connections |
| `create_device` | Register a new device |
| `update_device` | Update device properties |
| `list_networks` | List networks by topology type |
| `create_topology` | Create a network topology (ZeroTier, UniFi, etc.) |
| `create_network` | Create a network within a topology |
| `link_device_to_network` | Connect device to network |
| `get_access_path` | Get access paths to a device |
| `create_access_path` | Define multi-hop access path |
| `test_access_path` | Test connectivity through path |
| `get_network_overview` | High-level infrastructure summary |

## Architecture

```
┌─────────────────────────────────────────────┐
│              MCP Server (stdio)              │
├─────────────────────────────────────────────┤
│               REST API (Express)             │
├─────────────────────────────────────────────┤
│           Platform Connectors                │
│  • ZeroTier  • UniFi  • UISP  • (more...)   │
├─────────────────────────────────────────────┤
│           SQLite / PostgreSQL                │
└─────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | SQLite or PostgreSQL connection string |
| `ZEROTIER_API_TOKEN` | ZeroTier Central API token |
| `UNIFI_MODE` | `local`, `sitemanager`, or `legacy` (see below) |
| `UNIFI_API_KEY` | UniFi API key for local/sitemanager modes |
| `UNIFI_UDM_IP` | UDM IP address for local mode |
| `UNIFI_CONSOLE_ID` | Console ID for sitemanager (cloud) mode |
| `UNIFI_CONTROLLER_URL` | UniFi controller URL (legacy mode) |
| `UNIFI_USERNAME` | UniFi username (legacy mode) |
| `UNIFI_PASSWORD` | UniFi password (legacy mode) |
| `UISP_URL` | UISP instance URL |
| `UISP_API_TOKEN` | UISP API token |

### UniFi Connector Modes

The UniFi connector supports three modes:

#### 1. `local` (Recommended)
Uses the official Site Manager API v1.0 via direct connection to your UDM.
- Set `UNIFI_MODE=local`
- Provide `UNIFI_API_KEY` from UDM > Settings > Integrations
- Provide `UNIFI_UDM_IP` (e.g., `10.10.10.1`)

```env
UNIFI_MODE=local
UNIFI_API_KEY=your-api-key
UNIFI_UDM_IP=10.10.10.1
```

#### 2. `sitemanager` (Cloud)
Uses the official Site Manager API v1.0 via api.ui.com.
- Set `UNIFI_MODE=sitemanager`
- Provide `UNIFI_API_KEY` and `UNIFI_CONSOLE_ID`

#### 3. `legacy` (Cookie Auth)
Uses the original cookie-based authentication (for older controllers).
- Set `UNIFI_MODE=legacy`
- Provide `UNIFI_CONTROLLER_URL`, `UNIFI_USERNAME`, `UNIFI_PASSWORD`

### Extended Device Data (Site Manager API)

When using `local` or `sitemanager` mode, the connector provides extended device metrics:

- **System Stats**: `uptimeSec`, `cpuUtilizationPct`, `memoryUtilizationPct`
- **Load Averages**: `loadAverage1Min`, `loadAverage5Min`, `loadAverage15Min`
- **Throughput**: `uplinkTxBps`, `uplinkRxBps`
- **AP Specific**: `clientCount`, `ssids`, radio stats
- **Heartbeat**: `lastHeartbeatAt`, `nextHeartbeatAt`

## Development

```bash
# Run MCP server in watch mode
npm run dev:mcp

# Run API server in watch mode
npm run dev

# Build for production
npm run build

# Run database studio
npm run db:studio
```

## License

MIT
