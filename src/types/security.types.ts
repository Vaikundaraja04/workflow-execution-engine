import type { Types } from 'mongoose';

export type SecuritySeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SecurityEventStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'FALSE_POSITIVE';

export interface SecurityEvent {
  _id?: string | Types.ObjectId | undefined;
  eventType: string;
  severity: SecuritySeverity;
  status?: SecurityEventStatus | undefined;
  title?: string | undefined;
  description: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  workspaceId?: string | Types.ObjectId | undefined;
  userId?: string | Types.ObjectId | undefined;
  metadata?: Record<string, unknown> | undefined;
  resolvedAt?: Date | undefined;
  resolvedBy?: string | Types.ObjectId | undefined;
  resolutionNotes?: string | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

export interface RiskScoreBreakdown {
  domain: string;
  score: number;
}

export interface RiskScoreData {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  breakdown: RiskScoreBreakdown[];
  recommendations: string[];
}
