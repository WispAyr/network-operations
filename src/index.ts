/**
 * NetOps - Network Operations Management Platform
 * 
 * Main entry point for the REST API server
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initializeDatabase } from './db/index.js';
import { createConnectors, getConnectorConfigFromEnv } from './connectors/index.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || 'localhost';

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes will be added here
app.get('/api/v1/status', (req, res) => {
    res.json({
        name: 'NetOps',
        version: '0.1.0',
        description: 'Network Operations Management Platform',
        endpoints: {
            mcp: 'Run with: npm run dev:mcp',
            api: `http://${HOST}:${PORT}/api/v1`,
        },
    });
});

// Initialize and start
async function main() {
    console.log('[NetOps] Initializing...');

    // Initialize database
    await initializeDatabase();

    // Load connector configuration
    const connectorConfig = getConnectorConfigFromEnv();
    const connectors = createConnectors(connectorConfig);

    console.log(`[NetOps] Loaded ${connectors.length} platform connector(s)`);

    // Start server
    app.listen(PORT, HOST, () => {
        console.log(`[NetOps] API server running at http://${HOST}:${PORT}`);
        console.log('[NetOps] MCP server: npm run dev:mcp');
    });
}

main().catch(console.error);
