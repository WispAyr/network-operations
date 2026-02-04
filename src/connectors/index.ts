/**
 * Platform Connectors Index
 * 
 * Export all platform connectors and factory functions
 */

export { BaseConnector, type ConnectorConfig, type PlatformDevice, type PlatformNetwork, type PlatformMember, type SyncResult } from './base.js';
export { ZeroTierConnector } from './zerotier.js';
export { UniFiConnector } from './unifi.js';
export { UISPConnector } from './uisp.js';

import { ZeroTierConnector } from './zerotier.js';
import { UniFiConnector } from './unifi.js';
import { UISPConnector } from './uisp.js';
import type { BaseConnector, ConnectorConfig } from './base.js';

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
        if ('controllerUrl' in config.unifi) {
            connectors.push(new UniFiConnector(
                config.unifi.controllerUrl,
                config.unifi.username,
                config.unifi.password
            ));
        }
        // TODO: Add UniFi Cloud API support
    }

    if (config.uisp) {
        connectors.push(new UISPConnector(
            config.uisp.url,
            config.uisp.apiToken
        ));
    }

    return connectors;
}

/**
 * Load connector configuration from environment variables
 */
export function getConnectorConfigFromEnv(): ConnectorConfig {
    const config: ConnectorConfig = {};

    if (process.env.ZEROTIER_API_TOKEN) {
        config.zerotier = {
            apiToken: process.env.ZEROTIER_API_TOKEN,
            apiUrl: process.env.ZEROTIER_API_URL || 'https://api.zerotier.com/api/v1',
        };
    }

    if (process.env.UNIFI_CONTROLLER_URL && process.env.UNIFI_USERNAME && process.env.UNIFI_PASSWORD) {
        config.unifi = {
            controllerUrl: process.env.UNIFI_CONTROLLER_URL,
            username: process.env.UNIFI_USERNAME,
            password: process.env.UNIFI_PASSWORD,
        };
    }

    if (process.env.UISP_URL && process.env.UISP_API_TOKEN) {
        config.uisp = {
            url: process.env.UISP_URL,
            apiToken: process.env.UISP_API_TOKEN,
        };
    }

    return config;
}
