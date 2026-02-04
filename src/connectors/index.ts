/**
 * Platform Connectors Index
 * 
 * Export all platform connectors and factory functions
 */

export { BaseConnector, type ConnectorConfig, type PlatformDevice, type PlatformNetwork, type PlatformMember, type SyncResult, type UniFiMode } from './base.js';
export { ZeroTierConnector } from './zerotier.js';
export { UniFiConnector } from './unifi.js';
export { UniFiSiteManagerConnector, type UniFiSiteManagerConfig, type UniFiSiteManagerMode } from './unifi-sitemanager.js';
export { UISPConnector } from './uisp.js';
export { ProtectConnector } from './protect.js';
export { StarlinkConnector } from './starlink.js';

import { ZeroTierConnector } from './zerotier.js';
import { UniFiConnector } from './unifi.js';
import { UniFiSiteManagerConnector } from './unifi-sitemanager.js';
import { UISPConnector } from './uisp.js';
import { ProtectConnector } from './protect.js';
import { StarlinkConnector } from './starlink.js';
import type { BaseConnector, ConnectorConfig, UniFiMode } from './base.js';

/**
 * Create connectors from configuration
 */
export function createConnectors(config: ConnectorConfig): BaseConnector[] {
    const connectors: BaseConnector[] = [];

    if (config.zerotier) {
        connectors.push(new ZeroTierConnector(
            config.zerotier.apiToken,
            config.zerotier.apiUrl
        ));
    }

    if (config.unifi) {
        const mode: UniFiMode = config.unifi.mode || 'legacy';
        
        if (mode === 'sitemanager' || mode === 'local') {
            // Use new Site Manager API v1.0 connector
            if (!config.unifi.apiKey) {
                console.warn('[Connectors] UniFi Site Manager mode requires apiKey');
            } else {
                connectors.push(new UniFiSiteManagerConnector({
                    mode,
                    apiKey: config.unifi.apiKey,
                    udmIp: config.unifi.udmIp,
                    consoleId: config.unifi.consoleId,
                }));
                console.log(`[Connectors] UniFi connector using ${mode} mode (Site Manager API v1.0)`);
            }
        } else {
            // Legacy mode - use original cookie-based connector
            if (config.unifi.controllerUrl && config.unifi.username && config.unifi.password) {
                connectors.push(new UniFiConnector(
                    config.unifi.controllerUrl,
                    config.unifi.username,
                    config.unifi.password
                ));
                console.log('[Connectors] UniFi connector using legacy mode (cookie auth)');
            } else {
                console.warn('[Connectors] UniFi legacy mode requires controllerUrl, username, and password');
            }
        }
    }

    if (config.uisp) {
        connectors.push(new UISPConnector(
            config.uisp.url,
            config.uisp.apiToken
        ));
    }

    if (config.protect) {
        connectors.push(new ProtectConnector(
            config.protect.url,
            config.protect.username,
            config.protect.password
        ));
    }

    if (config.starlink) {
        connectors.push(new StarlinkConnector(
            config.starlink.ip
        ));
    }

    return connectors;
}

/**
 * Load connector configuration from environment variables
 * 
 * UniFi Environment Variables:
 *   UNIFI_MODE: 'sitemanager' | 'local' | 'legacy' (default: auto-detect)
 *   UNIFI_API_KEY: API key for Site Manager API v1.0
 *   UNIFI_UDM_IP: UDM IP for local mode (defaults to UNIFI_CONTROLLER_URL host)
 *   UNIFI_CONSOLE_ID: Console ID for cloud (sitemanager) mode
 *   UNIFI_CONTROLLER_URL: Controller URL for legacy mode
 *   UNIFI_USERNAME: Username for legacy mode
 *   UNIFI_PASSWORD: Password for legacy mode
 */
export function getConnectorConfigFromEnv(): ConnectorConfig {
    const config: ConnectorConfig = {};

    if (process.env.ZEROTIER_API_TOKEN) {
        config.zerotier = {
            apiToken: process.env.ZEROTIER_API_TOKEN,
            apiUrl: process.env.ZEROTIER_API_URL || 'https://api.zerotier.com/api/v1',
        };
    }

    // UniFi configuration - supports multiple modes
    const unifiMode = process.env.UNIFI_MODE as UniFiMode | undefined;
    const unifiApiKey = process.env.UNIFI_API_KEY;
    const unifiControllerUrl = process.env.UNIFI_CONTROLLER_URL;
    const unifiUsername = process.env.UNIFI_USERNAME;
    const unifiPassword = process.env.UNIFI_PASSWORD;
    const unifiUdmIp = process.env.UNIFI_UDM_IP;
    const unifiConsoleId = process.env.UNIFI_CONSOLE_ID;

    // Auto-detect mode if not specified
    let effectiveMode: UniFiMode;
    if (unifiMode) {
        effectiveMode = unifiMode;
    } else if (unifiApiKey && unifiConsoleId) {
        effectiveMode = 'sitemanager';
    } else if (unifiApiKey && (unifiUdmIp || unifiControllerUrl)) {
        effectiveMode = 'local';
    } else if (unifiControllerUrl && unifiUsername && unifiPassword) {
        effectiveMode = 'legacy';
    } else {
        effectiveMode = 'legacy'; // Default fallback
    }

    // Build config based on mode
    if (effectiveMode === 'sitemanager' || effectiveMode === 'local') {
        if (unifiApiKey) {
            // Extract UDM IP from controller URL if not specified separately
            let udmIp = unifiUdmIp;
            if (!udmIp && unifiControllerUrl) {
                try {
                    const url = new URL(unifiControllerUrl);
                    udmIp = url.hostname;
                } catch {
                    // Invalid URL, ignore
                }
            }

            config.unifi = {
                mode: effectiveMode,
                apiKey: unifiApiKey,
                udmIp,
                consoleId: unifiConsoleId,
            };
        }
    } else {
        // Legacy mode
        if (unifiControllerUrl && unifiUsername && unifiPassword) {
            config.unifi = {
                mode: 'legacy',
                controllerUrl: unifiControllerUrl,
                username: unifiUsername,
                password: unifiPassword,
            };
        }
    }

    if (process.env.UISP_URL && process.env.UISP_API_TOKEN) {
        config.uisp = {
            url: process.env.UISP_URL,
            apiToken: process.env.UISP_API_TOKEN,
        };
    }

    if (process.env.PROTECT_URL && process.env.PROTECT_USERNAME && process.env.PROTECT_PASSWORD) {
        config.protect = {
            url: process.env.PROTECT_URL,
            username: process.env.PROTECT_USERNAME,
            password: process.env.PROTECT_PASSWORD,
        };
    }

    // Starlink is auto-detected - always try if IP is configured
    if (process.env.STARLINK_IP || true) {
        config.starlink = {
            ip: process.env.STARLINK_IP || '192.168.100.1',
        };
    }

    return config;
}
