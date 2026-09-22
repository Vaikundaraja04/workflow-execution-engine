// Consolidated HTTP client — re-exports the shared, fully-configured client from
// services/apiClient (auth header injection, 401 token refresh via /api/v1/auth/refresh,
// workspace headers). Import from '@/services/apiClient' in new code.
export { apiClient as default, apiClient } from '../services/apiClient';