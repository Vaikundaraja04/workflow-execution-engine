import { Types } from 'mongoose';
import { RetentionPolicyModel, type IRetentionPolicy } from '../models/RetentionPolicyModel.js';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { createAuditLog } from './auditService.js';

export class RetentionPolicyService {
  /**
   * Create or update a retention policy for a workspace and resource type
   */
  public async setRetentionPolicy(
    workspaceId: string | Types.ObjectId,
    resourceType: string,
    retentionDays: number,
    userId?: string | Types.ObjectId
  ): Promise<IRetentionPolicy> {
    const wsId = new Types.ObjectId(workspaceId.toString());
    const uId = userId ? new Types.ObjectId(userId.toString()) : undefined;

    const policy = await RetentionPolicyModel.findOneAndUpdate(
      {
        workspaceId: wsId,
        resourceType,
      },
      {
        workspaceId: wsId,
        resourceType,
        retentionDays,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await createAuditLog({
      action: 'RETENTION_POLICY_UPDATED',
      workspaceId: wsId.toString(),
      userId: uId?.toString(),
      resource: 'RetentionPolicy',
      resourceId: policy._id.toString(),
      metadata: {
        resourceType,
        retentionDays,
      },
    });

    return policy;
  }

  /**
   * Get retention policy for a workspace and resource type
   */
  public async getRetentionPolicy(
    workspaceId: string | Types.ObjectId,
    resourceType: string
  ): Promise<IRetentionPolicy | null> {
    return RetentionPolicyModel.findOne({
      workspaceId: new Types.ObjectId(workspaceId.toString()),
      resourceType,
    });
  }

  /**
   * List all retention policies for a workspace
   */
  public async listRetentionPolicies(
    workspaceId: string | Types.ObjectId
  ): Promise<IRetentionPolicy[]> {
    return RetentionPolicyModel.find({
      workspaceId: new Types.ObjectId(workspaceId.toString()),
    }).sort({ resourceType: 1 });
  }

  /**
   * Delete a retention policy
   */
  public async deleteRetentionPolicy(
    workspaceId: string | Types.ObjectId,
    resourceType: string,
    userId?: string | Types.ObjectId
  ): Promise<boolean> {
    const wsId = new Types.ObjectId(workspaceId.toString());
    const uId = userId ? new Types.ObjectId(userId.toString()) : undefined;

    const result = await RetentionPolicyModel.deleteOne({
      workspaceId: wsId,
      resourceType,
    });

    if (result.deletedCount > 0) {
      await createAuditLog({
        action: 'RETENTION_POLICY_DELETED',
        workspaceId: wsId.toString(),
        userId: uId?.toString(),
        resource: 'RetentionPolicy',
        metadata: { resourceType },
      });
    }

    return result.deletedCount > 0;
  }

  /**
   * Apply retention policy: delete old records for a given resource type
   * This is a placeholder implementation. In a real system, you would have
   * specific models for each resource type (audit, execution, webhook-delivery, etc.)
   * and implement the deletion logic accordingly.
   */
  public async applyRetentionPolicy(
    workspaceId: string | Types.ObjectId,
    resourceType: string
  ): Promise<{ deletedCount: number; policy: IRetentionPolicy | null }> {
    const policy = await this.getRetentionPolicy(workspaceId, resourceType);
    if (!policy) {
      return { deletedCount: 0, policy: null };
    }

    const cutoffDate = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);

    let deletedCount = 0;

    // For audit logs, we can implement directly
    if (resourceType === 'audit') {
      const result = await AuditLogModel.deleteMany({
        workspaceId: new Types.ObjectId(workspaceId.toString()),
        createdAt: { $lt: cutoffDate },
      });
      deletedCount = result.deletedCount;

      await createAuditLog({
        action: 'RETENTION_POLICY_APPLIED',
        workspaceId: workspaceId.toString(),
        resource: 'AuditLog',
        metadata: {
          resourceType,
          retentionDays: policy.retentionDays,
          deletedCount,
        },
      });
    }
    // For other resource types, we would need to implement similarly.
    // For now, we just return the policy and a placeholder count.

    return { deletedCount, policy };
  }
}

export const retentionPolicyService = new RetentionPolicyService();