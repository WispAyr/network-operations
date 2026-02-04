import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { generateId } from '../utils/helpers.js';

// Re-export utilities
export { generateId };

const DATABASE_PATH = process.env.DATABASE_URL?.replace('sqlite:', '') || './data/netops.db';

// Ensure data directory exists
const dataDir = dirname(DATABASE_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// Create SQLite database connection
const sqlite = new Database(DATABASE_PATH);

// Enable foreign keys
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Create Drizzle instance with schema
export const db = drizzle(sqlite, { schema });

// Export schema for use elsewhere
export * from './schema.js';

/**
 * Initialize the database with tables
 */
export async function initializeDatabase(): Promise<void> {
  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      address TEXT,
      latitude REAL,
      longitude REAL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'other',
      description TEXT,
      floor TEXT,
      coordinates TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT DEFAULT 'other',
      registration TEXT,
      current_site_id TEXT REFERENCES sites(id),
      last_known_latitude REAL,
      last_known_longitude REAL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topologies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      platform_config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS networks (
      id TEXT PRIMARY KEY,
      topology_id TEXT NOT NULL REFERENCES topologies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      cidr TEXT,
      vlan INTEGER,
      platform_network_id TEXT,
      gateway_ip TEXT,
      dns_servers TEXT,
      status TEXT DEFAULT 'unknown',
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      manufacturer TEXT,
      model TEXT,
      serial_number TEXT,
      firmware_version TEXT,
      location_id TEXT REFERENCES locations(id),
      vehicle_id TEXT REFERENCES vehicles(id),
      status TEXT DEFAULT 'unknown',
      last_seen INTEGER,
      primary_ip TEXT,
      primary_mac TEXT,
      hostname TEXT,
      management_url TEXT,
      ssh_port INTEGER,
      http_port INTEGER,
      platform_type TEXT,
      platform_device_id TEXT,
      notes TEXT,
      tags TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_network_links (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      network_id TEXT NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
      ip_address TEXT,
      mac_address TEXT,
      interface_name TEXT,
      is_management_interface INTEGER DEFAULT 0,
      platform_member_id TEXT,
      status TEXT DEFAULT 'unknown',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS access_paths (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      target_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      is_default INTEGER DEFAULT 0,
      last_tested_at INTEGER,
      last_test_status TEXT DEFAULT 'unknown',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS path_hops (
      id TEXT PRIMARY KEY,
      path_id TEXT NOT NULL REFERENCES access_paths(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL,
      type TEXT NOT NULL,
      host_device_id TEXT REFERENCES devices(id),
      target_address TEXT NOT NULL,
      target_port INTEGER,
      config TEXT,
      status TEXT DEFAULT 'unknown',
      last_checked_at INTEGER,
      last_latency_ms INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_locations_site ON locations(site_id);
    CREATE INDEX IF NOT EXISTS idx_devices_location ON devices(location_id);
    CREATE INDEX IF NOT EXISTS idx_devices_vehicle ON devices(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
    CREATE INDEX IF NOT EXISTS idx_device_network_links_device ON device_network_links(device_id);
    CREATE INDEX IF NOT EXISTS idx_device_network_links_network ON device_network_links(network_id);
    CREATE INDEX IF NOT EXISTS idx_networks_topology ON networks(topology_id);
    CREATE INDEX IF NOT EXISTS idx_access_paths_device ON access_paths(target_device_id);
    CREATE INDEX IF NOT EXISTS idx_path_hops_path ON path_hops(path_id);
  `);

  console.log('[NetOps] Database initialized');
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  sqlite.close();
}
