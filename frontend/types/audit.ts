export interface AuditLog {
  _id: string;
  id?: string;
  action: string;
  userId?: string;
  workspaceId?: string;
  resource?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

export interface AuditSummary {
  totalEvents: number;
  actionBreakdown: Record<string, number>;
  topUsers: { userId: string; count: number }[];
  recentEvents: AuditLog[];
}

export interface AuditQueryResult {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
