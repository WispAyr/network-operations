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
| `UNIFI_CONTROLLER_URL` | UniFi controller URL |
| `UNIFI_USERNAME` | UniFi username |
| `UNIFI_PASSWORD` | UniFi password |
| `UISP_URL` | UISP instance URL |
| `UISP_API_TOKEN` | UISP API token |

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
