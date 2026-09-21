import { Types } from 'mongoose';
import { ApprovalRequestModel, type IApprovalRequest, type ApprovalResourceType } from '../../models/ApprovalRequestModel.js';

export interface CreateApprovalInput {
  resourceType: ApprovalResourceType;
  resourceId: string;
  action: string;
  payload?: Record<string, unknown>;
  ttlSeconds?: number;
}

export class ApprovalService {
  private static instance: ApprovalService;
  public static getInstance(): ApprovalService {
    if (!ApprovalService.instance) ApprovalService.instance = new ApprovalService();
    return ApprovalService.instance;
  }

  async requestApproval(
    workspaceId: string,
    requestedBy: string,
    input: CreateApprovalInput,
  ): Promise<IApprovalRequest> {
        const doc: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      requestedBy: new Types.ObjectId(requestedBy),
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
      status: 'PENDING',
    };
    if (input.payload !== undefined) doc.payload = input.payload;
    if (input.ttlSeconds) {
      doc.expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    }
    return ApprovalRequestModel.create(doc) as Promise<IApprovalRequest>;
  }

    async findPendingForResource(workspaceId: string, resourceType: string, resourceId: string) {
    return ApprovalRequestModel.findOne({
      workspaceId: new Types.ObjectId(workspaceId),
      resourceType: resourceType as never,
      resourceId,
      status: 'PENDING',
    }).sort({ createdAt: -1 });
  }

  async listQueue(workspaceId: string, status?: string) {
    const filter: Record<string, unknown> = { workspaceId: new Types.ObjectId(workspaceId) };
    if (status) filter.status = status;
    return ApprovalRequestModel.find(filter).sort({ createdAt: -1 }).lean();
  }

  async getById(approvalId: string, workspaceId: string) {
    if (!Types.ObjectId.isValid(approvalId)) throw new Error('INVALID_REQUEST');
    return ApprovalRequestModel.findOne({
      _id: new Types.ObjectId(approvalId),
      workspaceId: new Types.ObjectId(workspaceId),
    });
  }

  private ensurePending(approval: IApprovalRequest): void {
    if (!approval) throw new Error('APPROVAL_NOT_FOUND');
    this.expireIfNeeded(approval);
    if (approval.status !== 'PENDING') throw new Error('APPROVAL_NOT_PENDING');
  }

  private expireIfNeeded(approval: IApprovalRequest): boolean {
    if (approval.status === 'PENDING' && approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
      approval.status = 'EXPIRED';
      void approval.save();
      return true;
    }
    return false;
  }

  async approve(approvalId: string, workspaceId: string, approverId: string, reason?: string) {
    const approval = await this.getById(approvalId, workspaceId);
    if (!approval) throw new Error('APPROVAL_NOT_FOUND');
    this.ensurePending(approval);
    approval.status = 'APPROVED';
    approval.approvedBy = new Types.ObjectId(approverId);
    if (reason !== undefined) approval.reason = reason;
    approval.decidedAt = new Date();
    await approval.save();
    return approval;
  }

  async reject(approvalId: string, workspaceId: string, rejecterId: string, reason?: string) {
    const approval = await this.getById(approvalId, workspaceId);
    if (!approval) throw new Error('APPROVAL_NOT_FOUND');
    this.ensurePending(approval);
    approval.status = 'REJECTED';
    approval.rejectedBy = new Types.ObjectId(rejecterId);
    if (reason !== undefined) approval.reason = reason;
    approval.decidedAt = new Date();
    await approval.save();
    return approval;
  }
}
