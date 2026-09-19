import { Types } from 'mongoose';
import {
  GovernancePolicyModel,
  GovernanceApprovalModel,
} from '../models/GovernancePolicyModel.js';
import type {
  IGovernancePolicy,
  IApprovalRule,
  IExecutionPolicy,
  ISecurityPolicy,
  IComplianceRule,
  IGovernanceApproval,
} from '../models/GovernancePolicyModel.js';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { createAuditLog } from './auditService.js';

export class GovernanceService {
  /**
   * Get all active policies for a workspace (including global ones)
   */
  async getPolicies(workspaceId?: Types.ObjectId | string): Promise<IGovernancePolicy[]> {
    const query: any = { isActive: true };
    if (workspaceId) {
      const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
      query.$or = [{ workspaceId: workspaceIdObj }, { workspaceId: { $exists: false } }, { workspaceId: null }];
    }
    return GovernancePolicyModel.find(query).sort({ createdAt: -1 });
  }

  /**
   * Get a policy by ID
   */
  async getPolicyById(policyId: Types.ObjectId | string): Promise<IGovernancePolicy | null> {
    const id = typeof policyId === 'string' ? new Types.ObjectId(policyId) : policyId;
    return GovernancePolicyModel.findById(id);
  }

  /**
   * Create a new governance policy
   */
  async createPolicy(
    policyData: {
      workspaceId?: Types.ObjectId | string | undefined;
      name: string;
      description?: string | undefined;
      approvalRules?: Partial<IApprovalRule> | undefined;
      executionPolicies?: Partial<IExecutionPolicy> | undefined;
      securityPolicies?: Partial<ISecurityPolicy> | undefined;
      complianceRules?: Partial<IComplianceRule> | undefined;
      isActive?: boolean | undefined;
    },
    userId: Types.ObjectId | string
  ): Promise<IGovernancePolicy> {
    const userIdObj = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const workspaceIdObj = policyData.workspaceId
      ? typeof policyData.workspaceId === 'string'
        ? new Types.ObjectId(policyData.workspaceId)
        : policyData.workspaceId
      : undefined;

    const createData: Record<string, any> = {
      name: policyData.name,
      description: policyData.description ?? '',
      createdBy: userIdObj,
      updatedBy: userIdObj,
    };
    if (workspaceIdObj) createData.workspaceId = workspaceIdObj;
    if (policyData.approvalRules) createData.approvalRules = policyData.approvalRules;
    if (policyData.executionPolicies) createData.executionPolicies = policyData.executionPolicies;
    if (policyData.securityPolicies) createData.securityPolicies = policyData.securityPolicies;
    if (policyData.complianceRules) createData.complianceRules = policyData.complianceRules;
    if (typeof policyData.isActive === 'boolean') createData.isActive = policyData.isActive;

    const policy = await GovernancePolicyModel.create(createData);

    await createAuditLog({
      action: 'GOVERNANCE_POLICY_CREATED',
      workspaceId: workspaceIdObj,
      resource: 'governancePolicy',
      resourceId: (policy._id as Types.ObjectId).toString(),
      userId: userIdObj,
      metadata: { name: policy.name },
    });

    return policy;
  }

  /**
   * Update an existing policy
   */
  async updatePolicy(
    policyId: Types.ObjectId | string,
    updates: Partial<IGovernancePolicy>,
    userId: Types.ObjectId | string
  ): Promise<IGovernancePolicy> {
    const id = typeof policyId === 'string' ? new Types.ObjectId(policyId) : policyId;
    const userIdObj = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const policy = await GovernancePolicyModel.findById(id);
    if (!policy) {
      throw new Error('Governance policy not found');
    }

    Object.assign(policy, updates, { updatedBy: userIdObj });
    await policy.save();

    await createAuditLog({
      action: 'GOVERNANCE_POLICY_UPDATED',
      workspaceId: policy.workspaceId,
      resource: 'governancePolicy',
      resourceId: (policy._id as Types.ObjectId).toString(),
      userId: userIdObj,
      metadata: { name: policy.name },
    });

    return policy;
  }

  /**
   * Delete or deactivate a policy
   */
  async deletePolicy(
    policyId: Types.ObjectId | string,
    userId: Types.ObjectId | string
  ): Promise<boolean> {
    const id = typeof policyId === 'string' ? new Types.ObjectId(policyId) : policyId;
    const userIdObj = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const policy = await GovernancePolicyModel.findById(id);
    if (!policy) {
      throw new Error('Governance policy not found');
    }

    policy.isActive = false;
    await policy.save();

    await createAuditLog({
      action: 'GOVERNANCE_POLICY_DELETED',
      workspaceId: policy.workspaceId,
      resource: 'governancePolicy',
      resourceId: (policy._id as Types.ObjectId).toString(),
      userId: userIdObj,
      metadata: { name: policy.name },
    });

    return true;
  }

  /**
   * Evaluate if a workflow requires approval for publishing or execution
   */
  async evaluateWorkflowApproval(
    workspaceId: Types.ObjectId | string,
    workflowData: { type?: string; nodes?: any[] },
    action: 'PUBLISH' | 'EXECUTE' = 'PUBLISH'
  ): Promise<{ requiresApproval: boolean; reason?: string | undefined; requiredRoles: string[]; minApprovers: number }> {
    const policies = await this.getPolicies(workspaceId);

    for (const policy of policies) {
      const { approvalRules, executionPolicies } = policy;

      if (action === 'PUBLISH' && approvalRules.requireApprovalForPublish) {
        return {
          requiresApproval: true,
          reason: `Policy '${policy.name}' requires formal approval before publishing.`,
          requiredRoles: approvalRules.requiredRoles ?? ['OWNER', 'ADMIN'],
          minApprovers: approvalRules.minApprovers ?? 1,
        };
      }

      if (action === 'EXECUTE' && approvalRules.requireApprovalForExecution) {
        return {
          requiresApproval: true,
          reason: `Policy '${policy.name}' requires formal approval before executing.`,
          requiredRoles: approvalRules.requiredRoles ?? ['OWNER', 'ADMIN'],
          minApprovers: approvalRules.minApprovers ?? 1,
        };
      }

      // Check node restrictions
      if (workflowData.nodes && executionPolicies.forbiddenNodeTypes && executionPolicies.forbiddenNodeTypes.length > 0) {
        const forbiddenTypes = executionPolicies.forbiddenNodeTypes;
        const forbiddenFound = workflowData.nodes.some((node) =>
          forbiddenTypes.includes(node.type)
        );
        if (forbiddenFound) {
          return {
            requiresApproval: true,
            reason: `Workflow contains restricted node types governed by policy '${policy.name}'.`,
            requiredRoles: approvalRules.requiredRoles ?? ['OWNER', 'ADMIN'],
            minApprovers: approvalRules.minApprovers ?? 1,
          };
        }
      }
    }

    return { requiresApproval: false, requiredRoles: [], minApprovers: 0 };
  }

  /**
   * Create an approval request
   */
  async createApprovalRequest(
    workspaceId: Types.ObjectId | string,
    requestedBy: Types.ObjectId | string,
    data: {
      policyId?: Types.ObjectId | string | undefined;
      workflowId?: Types.ObjectId | string | undefined;
      requestType: 'WORKFLOW_PUBLISH' | 'WORKFLOW_EXECUTION' | 'POLICY_CHANGE' | 'DEPLOYMENT';
      reason?: string | undefined;
      metadata?: Record<string, any> | undefined;
    }
  ): Promise<IGovernanceApproval> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const reqBy = typeof requestedBy === 'string' ? new Types.ObjectId(requestedBy) : requestedBy;

    const approvalData: Record<string, any> = {
      workspaceId: wsId,
      requestedBy: reqBy,
      requestType: data.requestType,
      status: 'PENDING',
    };
    if (data.policyId) approvalData.policyId = new Types.ObjectId(data.policyId);
    if (data.workflowId) approvalData.workflowId = new Types.ObjectId(data.workflowId);
    if (data.reason) approvalData.reason = data.reason;
    if (data.metadata) approvalData.metadata = data.metadata;

    const approval = await GovernanceApprovalModel.create(approvalData);

    await createAuditLog({
      action: 'GOVERNANCE_APPROVAL_REQUESTED',
      workspaceId: wsId,
      resource: 'governanceApproval',
      resourceId: (approval._id as Types.ObjectId).toString(),
      userId: reqBy,
      metadata: { requestType: data.requestType },
    });

    return approval;
  }

  /**
   * Review an approval request
   */
  async reviewApprovalRequest(
    approvalId: Types.ObjectId | string,
    reviewerId: Types.ObjectId | string,
    status: 'APPROVED' | 'REJECTED',
    comments?: string
  ): Promise<IGovernanceApproval> {
    const id = typeof approvalId === 'string' ? new Types.ObjectId(approvalId) : approvalId;
    const revId = typeof reviewerId === 'string' ? new Types.ObjectId(reviewerId) : reviewerId;

    const approval = await GovernanceApprovalModel.findById(id);
    if (!approval) {
      throw new Error('Approval request not found');
    }

    if (approval.status !== 'PENDING') {
      throw new Error(`Approval request is already ${approval.status}`);
    }

    approval.status = status;
    approval.reviewedBy = revId;
    if (comments) {
      approval.comments = comments;
    }
    await approval.save();

    await createAuditLog({
      action: 'GOVERNANCE_APPROVAL_DECIDED',
      workspaceId: approval.workspaceId,
      resource: 'governanceApproval',
      resourceId: (approval._id as Types.ObjectId).toString(),
      userId: revId,
      metadata: { requestType: approval.requestType, decision: status, comments },
    });

    return approval;
  }

  /**
   * Get approval requests for a workspace
   */
  async getApprovals(
    workspaceId: Types.ObjectId | string,
    status?: string
  ): Promise<IGovernanceApproval[]> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const query: any = { workspaceId: wsId };
    if (status) {
      query.status = status;
    }
    return GovernanceApprovalModel.find(query)
      .populate('requestedBy', 'name email')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 });
  }

  /**
   * Get governance audit activity
   */
  async getGovernanceActivity(workspaceId: Types.ObjectId | string, limit = 50) {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    return AuditLogModel.find({
      workspaceId: wsId,
      resource: { $in: ['governancePolicy', 'governanceApproval', 'policyViolation'] },
    })
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  /**
   * Log a policy violation
   */
  async logPolicyViolation(
    workspaceId: Types.ObjectId | string,
    rule: string,
    details: Record<string, any>,
    userId?: Types.ObjectId | string
  ) {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const uId = userId ? (typeof userId === 'string' ? new Types.ObjectId(userId) : userId) : undefined;

    return createAuditLog({
      action: 'SECURITY_THREAT_DETECTED',
      workspaceId: wsId,
      resource: 'policyViolation',
      resourceId: wsId.toString(),
      userId: uId,
      metadata: { rule, ...details },
    });
  }
}

export const governanceService = new GovernanceService();
