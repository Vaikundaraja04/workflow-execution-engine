import { create } from 'zustand';
import { securityApi } from '../services/securityApi';
import type {
  SecurityDashboardData,
  SecurityEvent,
  RiskScoreData,
  SessionData,
  PrivacyRequest,
  PrivacyPreferences,
  SecretMetadata,
  WorkspaceSecurityPolicy,
} from '../types/security.types';

interface SecurityState {
  dashboard: SecurityDashboardData | null;
  events: SecurityEvent[];
  totalEvents: number;
  riskScore: RiskScoreData | null;
  sessions: SessionData[];
  secrets: SecretMetadata[];
  privacyRequests: PrivacyRequest[];
  privacyPreferences: PrivacyPreferences | null;
  policy: WorkspaceSecurityPolicy | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchDashboard: () => Promise<void>;
  fetchEvents: (filters?: Record<string, any>, pagination?: Record<string, any>) => Promise<void>;
  fetchRiskScore: () => Promise<void>;
  resolveEvent: (eventId: string, notes: string, status: 'RESOLVED' | 'FALSE_POSITIVE') => Promise<void>;
  fetchSessions: () => Promise<void>;
  revokeSession: (sessionId: string, reason?: string) => Promise<void>;
  revokeOtherSessions: () => Promise<void>;
  fetchPolicy: () => Promise<void>;
  updatePolicy: (policy: Partial<WorkspaceSecurityPolicy>) => Promise<void>;
  fetchSecrets: (environment?: 'development' | 'staging' | 'production') => Promise<void>;
  createSecret: (name: string, env: 'development' | 'staging' | 'production', val: string) => Promise<void>;
  rotateSecret: (secretId: string, val: string) => Promise<void>;
  deleteSecret: (secretId: string) => Promise<void>;
  fetchPrivacyRequests: () => Promise<void>;
  requestDataExport: () => Promise<void>;
  requestUserDeletion: (immediate?: boolean) => Promise<void>;
  fetchPrivacyPreferences: () => Promise<void>;
  updatePrivacyPreferences: (prefs: Partial<PrivacyPreferences>) => Promise<void>;
}

export const useSecurityStore = create<SecurityState>((set, get) => ({
  dashboard: null,
  events: [],
  totalEvents: 0,
  riskScore: null,
  sessions: [],
  secrets: [],
  privacyRequests: [],
  privacyPreferences: null,
  policy: null,
  isLoading: false,
  error: null,

  fetchDashboard: async () => {
    set({ isLoading: true, error: null });
    try {
      const dashboard = await securityApi.getSecurityDashboard();
      set({ dashboard, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch dashboard', isLoading: false });
    }
  },

  fetchEvents: async (filters = {}, pagination = {}) => {
    set({ isLoading: true, error: null });
    try {
      const res = await securityApi.getSecurityEvents(filters, pagination);
      set({ events: res.events, totalEvents: res.total, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch events', isLoading: false });
    }
  },

  fetchRiskScore: async () => {
    set({ isLoading: true, error: null });
    try {
      const riskScore = await securityApi.getRiskScore();
      set({ riskScore, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch risk score', isLoading: false });
    }
  },

  resolveEvent: async (eventId, notes, status) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await securityApi.resolveSecurityEvent(eventId, notes, status);
      set((state) => ({
        events: state.events.map((e) => (e._id === eventId ? updated : e)),
        isLoading: false,
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to resolve event', isLoading: false });
    }
  },

  fetchSessions: async () => {
    set({ isLoading: true, error: null });
    try {
      const sessions = await securityApi.getUserSessions();
      set({ sessions, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch sessions', isLoading: false });
    }
  },

  revokeSession: async (sessionId, reason) => {
    try {
      await securityApi.revokeSession(sessionId, reason);
      set((state) => ({
        sessions: state.sessions.filter((s) => s._id !== sessionId),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to revoke session' });
    }
  },

  revokeOtherSessions: async () => {
    try {
      await securityApi.revokeOtherSessions();
      await get().fetchSessions();
    } catch (err: any) {
      set({ error: err.message || 'Failed to revoke other sessions' });
    }
  },

  fetchPolicy: async () => {
    set({ isLoading: true, error: null });
    try {
      const policy = await securityApi.getSecurityPolicy();
      set({ policy, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch policy', isLoading: false });
    }
  },

  updatePolicy: async (policyData) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await securityApi.updateSecurityPolicy(policyData);
      set({ policy: updated, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to update policy', isLoading: false });
    }
  },

  fetchSecrets: async (environment) => {
    set({ isLoading: true, error: null });
    try {
      const secrets = await securityApi.listSecrets(environment);
      set({ secrets, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch secrets', isLoading: false });
    }
  },

  createSecret: async (name, env, val) => {
    set({ isLoading: true, error: null });
    try {
      await securityApi.createSecret(name, env, val);
      await get().fetchSecrets(env);
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to create secret', isLoading: false });
    }
  },

  rotateSecret: async (secretId, val) => {
    set({ isLoading: true, error: null });
    try {
      await securityApi.rotateSecret(secretId, val);
      await get().fetchSecrets();
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to rotate secret', isLoading: false });
    }
  },

  deleteSecret: async (secretId) => {
    try {
      await securityApi.deleteSecret(secretId);
      set((state) => ({
        secrets: state.secrets.filter((s) => s._id !== secretId),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete secret' });
    }
  },

  fetchPrivacyRequests: async () => {
    set({ isLoading: true, error: null });
    try {
      const privacyRequests = await securityApi.getPrivacyRequests();
      set({ privacyRequests, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch privacy requests', isLoading: false });
    }
  },

  requestDataExport: async () => {
    set({ isLoading: true, error: null });
    try {
      await securityApi.requestDataExport();
      await get().fetchPrivacyRequests();
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to request data export', isLoading: false });
    }
  },

  requestUserDeletion: async (immediate = false) => {
    set({ isLoading: true, error: null });
    try {
      await securityApi.requestUserDeletion(immediate);
      await get().fetchPrivacyRequests();
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to request deletion', isLoading: false });
    }
  },

  fetchPrivacyPreferences: async () => {
    set({ isLoading: true, error: null });
    try {
      const prefs = await securityApi.getPrivacyPreferences();
      set({ privacyPreferences: prefs, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch privacy preferences', isLoading: false });
    }
  },

  updatePrivacyPreferences: async (prefs) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await securityApi.updatePrivacyPreferences(prefs);
      set({ privacyPreferences: updated, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to update privacy preferences', isLoading: false });
    }
  },
}));
