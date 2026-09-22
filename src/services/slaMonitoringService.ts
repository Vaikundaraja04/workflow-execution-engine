import { Types } from 'mongoose';
import { SLAPolicyModel, DEFAULT_SLA_POLICIES } from '../models/SLAPolicyModel.js';
import { SupportTicketModel, SUPPORT_TICKET_OPEN_STATUSES } from '../models/SupportTicketModel.js';
import type { SupportTicketPriority } from '../models/SupportTicketModel.js';
import { createAuditLog } from './auditService.js';
import { notificationService } from './notificationService.js';

/**
 * Phase 18.4 - SLA monitoring.
 *
 * Policies live per priority; tickets stamp their deadlines at creation. The
 * sweep is deterministic and idempotent: a ticket is flagged as breached once,
 * raises one escalation level and notifies its owner - a second sweep over the
 * same rows reports zero breaches.
 */

export interface SlaDeadlines {
  policyId: string | null;
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
}

export interface SlaPolicyView {
  policyId: string;
  name: string;
  priority: SupportTicketPriority;
  responseTimeMinutes: number;
  resolutionTimeMinutes: number;
  status: string;
  description: string | null;
  updatedAt: string;
}

export interface SlaBreachView {
  ticketId: string;
  ticketNumber: string;
  workspaceId: string;
  subject: string;
  priority: SupportTicketPriority;
  reason: 'FIRST_RESPONSE' | 'RESOLUTION';
  dueAt: string;
  escalationLevel: number;
}

function policyView(row: {
  _id: Types.ObjectId;
  name: string;
  priority: SupportTicketPriority;
  responseTimeMinutes: number;
  resolutionTimeMinutes: number;
  status: string;
  description: string | null;
  updatedAt: Date;
}): SlaPolicyView {
  return {
    policyId: row._id.toString(),
    name: row.name,
    priority: row.priority,
    responseTimeMinutes: row.responseTimeMinutes,
    resolutionTimeMinutes: row.resolutionTimeMinutes,
    status: row.status,
    description: row.description,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}
export class SlaMonitoringService {
  /** The default policy per priority is seeded exactly once. */
  async ensureDefaultPolicies(actorUserId?: string | undefined): Promise<string[]> {
    const created: string[] = [];
    for (const policy of DEFAULT_SLA_POLICIES) {
      const existing = await SLAPolicyModel.findOne({ name: policy.name }).select('_id').lean();
      if (existing) continue;
      const row = await SLAPolicyModel.create({
        name: policy.name,
        priority: policy.priority,
        responseTimeMinutes: policy.responseTimeMinutes,
        resolutionTimeMinutes: policy.resolutionTimeMinutes,
        description: policy.description,
        status: 'ACTIVE',
        createdBy: actorUserId && Types.ObjectId.isValid(actorUserId) ? new Types.ObjectId(actorUserId) : null,
      });
      created.push(row._id.toString());
    }
    if (created.length > 0) {
      await createAuditLog({
        action: 'SLA_POLICY_CREATED',
        ...(actorUserId !== undefined ? { userId: actorUserId } : {}),
        resource: 'sla_policy',
        resourceId: created.join(','),
        metadata: { created: created.length },
      });
    }
    return created;
  }
  async listPolicies(options: { status?: 'ACTIVE' | 'ARCHIVED' | undefined } = {}): Promise<SlaPolicyView[]> {
    await this.ensureDefaultPolicies();
    const query: Record<string, unknown> = {};
    if (options.status) query.status = options.status;
    const rows = await SLAPolicyModel.find(query).sort({ responseTimeMinutes: 1, createdAt: 1 }).lean();
    return rows.map(policyView);
  }

  async policyForPriority(priority: SupportTicketPriority) {
    await this.ensureDefaultPolicies();
    return SLAPolicyModel.findOne({ priority, status: 'ACTIVE' }).sort({ createdAt: -1 });
  }

  /** Deadlines stamped onto a ticket the moment it is created. */
  async applyDeadlines(priority: SupportTicketPriority, now: Date): Promise<SlaDeadlines> {
    const policy = await this.policyForPriority(priority);
    if (!policy) return { policyId: null, firstResponseDueAt: null, resolutionDueAt: null };
    return {
      policyId: policy._id.toString(),
      firstResponseDueAt: new Date(now.getTime() + policy.responseTimeMinutes * 60 * 1000),
      resolutionDueAt: new Date(now.getTime() + policy.resolutionTimeMinutes * 60 * 1000),
    };
  }

  /** Open tickets that breached their SLA, newest first. */
  async breachedTickets(workspaceId?: string | undefined, limit = 50): Promise<SlaBreachView[]> {
    const query: Record<string, unknown> = { breached: true, status: { $in: [...SUPPORT_TICKET_OPEN_STATUSES] } };
    if (workspaceId && Types.ObjectId.isValid(workspaceId)) query.workspaceId = new Types.ObjectId(workspaceId);
    const rows = await SupportTicketModel.find(query).sort({ breachNotifiedAt: -1 }).limit(Math.min(200, limit)).lean();
    return rows.map((row) => ({
      ticketId: row._id.toString(),
      ticketNumber: row.ticketNumber,
      workspaceId: row.workspaceId.toString(),
      subject: row.subject,
      priority: row.priority,
      reason: (row.firstResponseAt === null ? 'FIRST_RESPONSE' : 'RESOLUTION') as 'FIRST_RESPONSE' | 'RESOLUTION',
      dueAt: (row.firstResponseAt === null ? row.firstResponseDueAt : row.resolutionDueAt)?.toISOString()
        ?? new Date(row.createdAt).toISOString(),
      escalationLevel: row.escalationLevel,
    }));
  }
  /**
   * Breach sweep. Once a ticket is flagged it is skipped by later sweeps, so a
   * rerun reports zero new breaches; counting is folded from the rows.
   */
  async sweep(options: { now?: Date | undefined; workspaceId?: string | undefined; actorUserId?: string | undefined } = {}) {
    const now = options.now ?? new Date();
    const query: Record<string, unknown> = {
      status: { $in: [...SUPPORT_TICKET_OPEN_STATUSES] },
      breached: false,
      $or: [
        { firstResponseAt: null, firstResponseDueAt: { $ne: null, $lte: now } },
        { resolutionDueAt: { $ne: null, $lte: now } },
      ],
    };
    if (options.workspaceId && Types.ObjectId.isValid(options.workspaceId)) {
      query.workspaceId = new Types.ObjectId(options.workspaceId);
    }
    const rows = await SupportTicketModel.find(query).limit(500);
    const breached: SlaBreachView[] = [];

    for (const row of rows) {
      const firstResponseBreach = row.firstResponseAt === null
        && row.firstResponseDueAt !== null
        && row.firstResponseDueAt.getTime() <= now.getTime();
      const reason: 'FIRST_RESPONSE' | 'RESOLUTION' = firstResponseBreach ? 'FIRST_RESPONSE' : 'RESOLUTION';
      const dueAt = firstResponseBreach ? row.firstResponseDueAt : row.resolutionDueAt;
      row.breached = true;
      row.breachNotifiedAt = now;
      row.escalationLevel = Math.min(2, row.escalationLevel + 1);
      await row.save();
      await createAuditLog({
        action: 'SLA_BREACH_DETECTED',
        workspaceId: row.workspaceId,
        resource: 'support_ticket',
        resourceId: row.ticketNumber,
        metadata: {
          priority: row.priority,
          reason,
          escalationLevel: row.escalationLevel,
          dueAt: dueAt ? dueAt.toISOString() : null,
        },
      });
      const recipient = row.assigneeId ?? row.createdBy;
      await notificationService.createNotification({
        userId: recipient.toString(),
        workspaceId: row.workspaceId.toString(),
        type: 'SYSTEM',
        title: `SLA breach: ${row.ticketNumber}`,
        message: reason === 'FIRST_RESPONSE'
          ? `First response deadline passed for "${row.subject}".`
          : `Resolution deadline passed for "${row.subject}".`,
        resourceType: 'support_ticket',
        resourceId: row._id.toString(),
        metadata: { priority: row.priority, reason, escalationLevel: row.escalationLevel },
      });
      breached.push({
        ticketId: row._id.toString(),
        ticketNumber: row.ticketNumber,
        workspaceId: row.workspaceId.toString(),
        subject: row.subject,
        priority: row.priority,
        reason,
        dueAt: (dueAt ?? new Date(row.createdAt)).toISOString(),
        escalationLevel: row.escalationLevel,
      });
    }
    await createAuditLog({
      action: 'SUPPORT_SLA_SWEEP_RUN',
      ...(options.actorUserId !== undefined ? { userId: options.actorUserId } : {}),
      resource: 'support_sla',
      resourceId: options.workspaceId ?? 'platform',
      metadata: { evaluated: rows.length, breached: breached.length },
    });

    return {
      evaluated: rows.length,
      breached,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Support pressure folded for the success intelligence. */
  async pressureFor(workspaceIds: Types.ObjectId[]) {
    if (workspaceIds.length === 0) return new Map<string, { open: number; breached: number; escalations: number }>();
    const rows = await SupportTicketModel.aggregate<{ _id: Types.ObjectId; open: number; breached: number; escalations: number }>([
      { $match: { workspaceId: { $in: workspaceIds }, status: { $in: [...SUPPORT_TICKET_OPEN_STATUSES] } } },
      {
        $group: {
          _id: '$workspaceId',
          open: { $sum: 1 },
          breached: { $sum: { $cond: ['$breached', 1, 0] } },
          escalations: { $sum: '$escalationLevel' },
        },
      },
    ]);
    const map = new Map<string, { open: number; breached: number; escalations: number }>();
    for (const row of rows) {
      map.set(row._id.toString(), { open: row.open, breached: row.breached, escalations: row.escalations });
    }
    return map;
  }
}

export const slaMonitoringService = new SlaMonitoringService();