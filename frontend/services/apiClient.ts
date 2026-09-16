import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/authStore';

export interface ApiClientError {
  code: string;
  message: string;
  status: number;
  details?: unknown;
  requestId?: string;
}

const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else if (token) {
      promise.resolve(token);
    }
  });
  failedQueue = [];
};

// Request interceptor
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    let token: string | null = null;
    let workspaceId: string | null = null;

    if (typeof window !== 'undefined') {
      token = localStorage.getItem('accessToken');
      workspaceId = localStorage.getItem('currentWorkspaceId') || localStorage.getItem('defaultWorkspaceId');
    }

    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (workspaceId && config.headers && !config.headers['X-Workspace-Id']) {
      config.headers['X-Workspace-Id'] = workspaceId;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor with auto-refresh token handling
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error?: { code?: string; message?: string; details?: unknown; requestId?: string } }>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // If 401 and not already retried
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      // Don't retry refresh or login requests
      if (
        originalRequest.url?.includes('/api/auth/login') ||
        originalRequest.url?.includes('/api/auth/refresh') ||
        originalRequest.url?.includes('/api/auth/register')
      ) {
        return Promise.reject(mapError(error));
      }

      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('refreshToken') : null;

        if (!refreshToken) {
          throw new Error('NO_REFRESH_TOKEN');
        }

        const response = await axios.post<{
          accessToken: string;
          refreshToken: string;
          defaultWorkspaceId?: string;
        }>(`${baseURL}/api/auth/refresh`, { refreshToken });

        const { accessToken, refreshToken: newRefreshToken, defaultWorkspaceId } = response.data;

        if (typeof window !== 'undefined') {
          localStorage.setItem('accessToken', accessToken);
          localStorage.setItem('refreshToken', newRefreshToken);
          if (defaultWorkspaceId) {
            localStorage.setItem('defaultWorkspaceId', defaultWorkspaceId);
          }
        }

        useAuthStore.getState().setTokens(accessToken, newRefreshToken);
        if (defaultWorkspaceId) {
          useAuthStore.getState().setDefaultWorkspaceId(defaultWorkspaceId);
        }

        processQueue(null, accessToken);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        useAuthStore.getState().clearAuth();

        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }

        return Promise.reject(mapError(error));
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(mapError(error));
  }
);

function mapError(error: AxiosError<{ error?: { code?: string; message?: string; details?: unknown; requestId?: string } }>): ApiClientError {
  const status = error.response?.status || 500;
  const backendError = error.response?.data?.error;

  let code = backendError?.code || 'UNKNOWN_ERROR';
  let message = backendError?.message || error.message || 'An unexpected error occurred';

  if (status === 401) {
    code = code === 'UNKNOWN_ERROR' ? 'UNAUTHORIZED' : code;
    message = message === 'An unexpected error occurred' ? 'Authentication required. Please log in.' : message;
  } else if (status === 403) {
    code = code === 'UNKNOWN_ERROR' ? 'FORBIDDEN' : code;
    message = message === 'An unexpected error occurred' ? 'You do not have permission to perform this action.' : message;
  } else if (status === 404) {
    code = code === 'UNKNOWN_ERROR' ? 'NOT_FOUND' : code;
    message = message === 'An unexpected error occurred' ? 'The requested resource was not found.' : message;
  } else if (status === 429) {
    code = code === 'UNKNOWN_ERROR' ? 'RATE_LIMITED' : code;
    message = message === 'An unexpected error occurred' ? 'Too many requests. Please try again later.' : message;
  } else if (status >= 500) {
    code = code === 'UNKNOWN_ERROR' ? 'INTERNAL_SERVER_ERROR' : code;
    message = message === 'An unexpected error occurred' ? 'Server error. Please try again later.' : message;
  }

  return {
    code,
    message,
    status,
    details: backendError?.details,
    requestId: backendError?.requestId,
  };
}

export default apiClient;
