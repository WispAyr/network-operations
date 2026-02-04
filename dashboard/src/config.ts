/**
 * Dashboard Configuration
 * Uses environment variables with sensible defaults
 */

// API base URL - uses VITE_API_URL env var or defaults to port 3852
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3852/api/v1';
