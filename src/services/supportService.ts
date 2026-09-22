import { Types } from 'mongoose';
import { SupportTicketModel, SUPPORT_TICKET_OPEN_STATUSES } from '../models/SupportTicketModel.js';
import type {
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from '../models/SupportTicketModel.js';
import { slaMonitoringService } from './slaMonitoringService.js';
import { createAuditLog } from './auditService.js';
import { notificationService } from './notificationService.js';

/**
 * Phase 18.3 - Enterprise support desk.
 *
 * Tickets carry the SLA deadlines stamped at creation; every transition (assign,
 * first response, resolve, reopen) is audited and the assignee is notified. The
 * workspace filter is always applied by the caller - a ticket only ever resolves
 * inside its own tenant.
 */

export interface SupportTicketView {
  ticketId: string;
  ticketNumber: string;
  workspaceId: string;
  subject: string;
  description: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  createdBy: string;
  assigneeId: string | null;
  slaPolicyId: string | null;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  escalationLevel: number;
  breached: boolean;
  responded: boolean;
  overdue: boolean;
  overdueFirstResponse: boolean;
  ageHours: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTicketInput {
  workspaceId: string;
  subject: string;
  description: string;
  category?: SupportTicketCategory | undefined;
  priority?: SupportTicketPriority | undefined;
  tags?: string[] | undefined;
  assigneeId?: string | null | undefined;
}

export interface UpdateTicketInput {
  status?: SupportTicketStatus | undefined;
  priority?: SupportTicketPriority | undefined;
  assigneeId?: string | null | undefined;
  resolution?: string | null | undefined;
  category?: SupportTicketCategory | undefined;
  tags?: string[] | undefined;
}

/** Status flow: a resolved ticket is only reachable by reopening it. */
export const ALLOWED_TICKET_TRANSITIONS: Record<SupportTicketStatus, readonly SupportTicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING', 'RESOLVED'],
  IN_PROGRESS: ['WAITING', 'RESOLVED'],
  WAITING: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['OPEN'],
};
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const HOUR_MS = 60 * 60 * 1000;

interface TicketRow {
  _id: Types.ObjectId;
  ticketNumber: string;
  workspaceId: Types.ObjectId;
  subject: string;
  description: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  createdBy: Types.ObjectId;
  assigneeId: Types.ObjectId | null;
  slaPolicyId: Types.ObjectId | null;
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  resolution: string | null;
  escalationLevel: number;
  breached: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

function ticketNumberFor(): string {
  return `TCK-${new Types.ObjectId().toHexString().slice(-8).toUpperCase()}`;
}
function viewFor(row: TicketRow, now: Date): SupportTicketView {
  const open = SUPPORT_TICKET_OPEN_STATUSES.includes(row.status);
  const overdueFirstResponse = open
    && row.firstResponseAt === null
    && row.firstResponseDueAt !== null
    && row.firstResponseDueAt.getTime() <= now.getTime();
  const overdueResolution = open
    && row.resolutionDueAt !== null
    && row.resolutionDueAt.getTime() <= now.getTime();
  return {
    ticketId: row._id.toString(),
    ticketNumber: row.ticketNumber,
    workspaceId: row.workspaceId.toString(),
    subject: row.subject,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    createdBy: row.createdBy.toString(),
    assigneeId: row.assigneeId ? row.assigneeId.toString() : null,
    slaPolicyId: row.slaPolicyId ? row.slaPolicyId.toString() : null,
    firstResponseDueAt: row.firstResponseDueAt ? row.firstResponseDueAt.toISOString() : null,
    resolutionDueAt: row.resolutionDueAt ? row.resolutionDueAt.toISOString() : null,
    firstResponseAt: row.firstResponseAt ? row.firstResponseAt.toISOString() : null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolution: row.resolution,
    escalationLevel: row.escalationLevel,
    breached: row.breached,
    responded: row.firstResponseAt !== null,
    overdue: overdueResolution || overdueFirstResponse,
    overdueFirstResponse,
    ageHours: Math.round(((now.getTime() - new Date(row.createdAt).getTime()) / HOUR_MS) * 10) / 10,
    tags: row.tags,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}
export class SupportService {
  /** Deadlines are stamped at creation; the assignee is notified when one is set. */
  async createTicket(input: CreateTicketInput, actorUserId: string): Promise<SupportTicketView> {
    if (!Types.ObjectId.isValid(input.workspaceId) || !Types.ObjectId.isValid(actorUserId)) {
      throw new Error('INVALID_TICKET');
    }
    const now = new Date();
    const priority: SupportTicketPriority = input.priority ?? 'NORMAL';
    const deadlines = await slaMonitoringService.applyDeadlines(priority, now);
    const assigneeId = input.assigneeId && Types.ObjectId.isValid(input.assigneeId)
      ? new Types.ObjectId(input.assigneeId)
      : null;

    const ticket = await SupportTicketModel.create({
      ticketNumber: ticketNumberFor(),
      workspaceId: new Types.ObjectId(input.workspaceId),
      subject: input.subject.trim(),
      description: input.description.trim(),
      category: input.category ?? 'GENERAL',
      priority,
      status: 'OPEN',
      createdBy: new Types.ObjectId(actorUserId),
      assigneeId,
      slaPolicyId: deadlines.policyId ? new Types.ObjectId(deadlines.policyId) : null,
      firstResponseDueAt: deadlines.firstResponseDueAt,
      resolutionDueAt: deadlines.resolutionDueAt,
      firstResponseAt: null,
      resolvedAt: null,
      resolution: null,
      escalationLevel: 0,
      breached: false,
      breachNotifiedAt: null,
      tags: [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 10),
    });

    await createAuditLog({
      action: 'SUPPORT_TICKET_CREATED',
      userId: actorUserId,
      workspaceId: ticket.workspaceId,
      resource: 'support_ticket',
      resourceId: ticket._id.toString(),
      metadata: {
        ticketNumber: ticket.ticketNumber,
        priority,
        category: ticket.category,
        slaPolicyId: deadlines.policyId,
      },
    });

    if (assigneeId) {
      await notificationService.createNotification({
        userId: assigneeId.toString(),
        workspaceId: ticket.workspaceId.toString(),
        type: 'SYSTEM',
        title: `Ticket assigned: ${ticket.ticketNumber}`,
        message: `You were assigned "${ticket.subject}".`,
        resourceType: 'support_ticket',
        resourceId: ticket._id.toString(),
        metadata: { priority },
      });
    }

    return viewFor(ticket.toObject() as TicketRow, now);
  }
  /** One page of tickets plus folded counts - scoping is the caller's job. */
  async listTickets(filters: {
    workspaceId?: string | undefined;
    status?: SupportTicketStatus | undefined;
    priority?: SupportTicketPriority | undefined;
    assigneeId?: string | undefined;
    breached?: boolean | undefined;
    page?: number | undefined;
    limit?: number | undefined;
    now?: Date | undefined;
  } = {}) {
    const now = filters.now ?? new Date();
    const page = Number.isFinite(filters.page) && filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
    const requested = Number.isFinite(filters.limit) && filters.limit && filters.limit > 0 ? Math.floor(filters.limit) : DEFAULT_PAGE_SIZE;
    const limit = Math.min(MAX_PAGE_SIZE, requested);

    const query: Record<string, unknown> = {};
    if (filters.workspaceId && Types.ObjectId.isValid(filters.workspaceId)) {
      query.workspaceId = new Types.ObjectId(filters.workspaceId);
    }
    if (filters.status) query.status = filters.status;
    if (filters.priority) query.priority = filters.priority;
    if (filters.assigneeId && Types.ObjectId.isValid(filters.assigneeId)) {
      query.assigneeId = new Types.ObjectId(filters.assigneeId);
    }
    if (filters.breached !== undefined) query.breached = filters.breached;

    const [total, rows] = await Promise.all([
      SupportTicketModel.countDocuments(query),
      SupportTicketModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    const items = rows.map((row) => viewFor(row as TicketRow, now));
    const openRows = await SupportTicketModel.countDocuments({
      ...query,
      status: { $in: [...SUPPORT_TICKET_OPEN_STATUSES] },
    });
    const breachedRows = await SupportTicketModel.countDocuments({
      ...query,
      breached: true,
      status: { $in: [...SUPPORT_TICKET_OPEN_STATUSES] },
    });

    return {
      items,
      summary: {
        total,
        open: openRows,
        breached: breachedRows,
        resolved: total - openRows,
      },
      page,
      limit,
      total,
      generatedAt: new Date().toISOString(),
    };
  }

  async getTicket(ticketId: string, now: Date = new Date()): Promise<SupportTicketView> {
    if (!Types.ObjectId.isValid(ticketId)) throw new Error('TICKET_NOT_FOUND');
    const row = await SupportTicketModel.findById(ticketId).lean();
    if (!row) throw new Error('TICKET_NOT_FOUND');
    return viewFor(row as TicketRow, now);
  }
  /** Assignment, status flow, priority re-scoring and the first-response stamp. */
  async updateTicket(ticketId: string, patch: UpdateTicketInput, actorUserId: string): Promise<SupportTicketView> {
    if (!Types.ObjectId.isValid(ticketId)) throw new Error('TICKET_NOT_FOUND');
    const row = await SupportTicketModel.findById(ticketId);
    if (!row) throw new Error('TICKET_NOT_FOUND');
    const now = new Date();
    const actor = new Types.ObjectId(actorUserId);
    const changed: string[] = [];
    let assigned = false;
    let resolved = false;

    if (patch.status !== undefined && patch.status !== row.status) {
      const allowed = ALLOWED_TICKET_TRANSITIONS[row.status] ?? [];
      if (!allowed.includes(patch.status)) throw new Error('INVALID_TICKET_TRANSITION');
      row.status = patch.status;
      changed.push('status');
      if (patch.status === 'RESOLVED') {
        row.resolvedAt = now;
        resolved = true;
        if (patch.resolution !== undefined && patch.resolution !== null) row.resolution = patch.resolution.trim();
      }
      if (patch.status === 'OPEN') {
        row.resolvedAt = null;
      }
    }

    if (patch.priority !== undefined && patch.priority !== row.priority) {
      row.priority = patch.priority;
      changed.push('priority');
      const deadlines = await slaMonitoringService.applyDeadlines(patch.priority, now);
      row.slaPolicyId = deadlines.policyId ? new Types.ObjectId(deadlines.policyId) : null;
      row.firstResponseDueAt = deadlines.firstResponseDueAt;
      row.resolutionDueAt = deadlines.resolutionDueAt;
    }
    if (patch.assigneeId !== undefined) {
      const next = patch.assigneeId && Types.ObjectId.isValid(patch.assigneeId)
        ? new Types.ObjectId(patch.assigneeId)
        : null;
      const current = row.assigneeId ? row.assigneeId.toString() : null;
      if ((next ? next.toString() : null) !== current) {
        row.assigneeId = next;
        changed.push('assigneeId');
        assigned = next !== null;
      }
    }
    if (patch.resolution !== undefined && patch.resolution !== row.resolution) {
      row.resolution = patch.resolution;
      changed.push('resolution');
    }
    if (patch.category !== undefined && patch.category !== row.category) {
      row.category = patch.category;
      changed.push('category');
    }
    if (patch.tags !== undefined) {
      const nextTags = [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 10);
      if (nextTags.join(',') !== row.tags.join(',')) {
        row.tags = nextTags;
        changed.push('tags');
      }
    }
    if (changed.length === 0) return viewFor(row.toObject() as TicketRow, now);
    if (row.firstResponseAt === null && !row.createdBy.equals(actor)) {
      row.firstResponseAt = now;
    }
    await row.save();
    await createAuditLog({
      action: 'SUPPORT_TICKET_UPDATED',
      userId: actorUserId,
      workspaceId: row.workspaceId,
      resource: 'support_ticket',
      resourceId: row._id.toString(),
      metadata: {
        ticketNumber: row.ticketNumber,
        changed,
        status: row.status,
        responded: row.firstResponseAt !== null,
      },
    });
    if (assigned) {
      await createAuditLog({
        action: 'SUPPORT_TICKET_ASSIGNED',
        userId: actorUserId,
        workspaceId: row.workspaceId,
        resource: 'support_ticket',
        resourceId: row._id.toString(),
        metadata: { ticketNumber: row.ticketNumber, assigneeId: row.assigneeId ? row.assigneeId.toString() : null },
      });
      if (row.assigneeId) {
        await notificationService.createNotification({
          userId: row.assigneeId.toString(),
          workspaceId: row.workspaceId.toString(),
          type: 'SYSTEM',
          title: `Ticket assigned: ${row.ticketNumber}`,
          message: `You were assigned "${row.subject}".`,
          resourceType: 'support_ticket',
          resourceId: row._id.toString(),
          metadata: { priority: row.priority },
        });
      }
    }
    if (resolved) {
      await createAuditLog({
        action: 'SUPPORT_TICKET_RESOLVED',
        userId: actorUserId,
        workspaceId: row.workspaceId,
        resource: 'support_ticket',
        resourceId: row._id.toString(),
        metadata: {
          ticketNumber: row.ticketNumber,
          priority: row.priority,
          resolutionMinutes: row.resolvedAt
            ? Math.round((row.resolvedAt.getTime() - new Date(row.createdAt).getTime()) / 60000)
            : null,
        },
      });
    }

    return viewFor(row.toObject() as TicketRow, now);
  }
}

export const supportService = new SupportService();