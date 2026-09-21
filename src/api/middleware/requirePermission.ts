import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Types } from 'mongoose';
import { getAuthUser } from '../../auth/auth.middleware.js';
import type { Permission, AIPermission, TemplatePermission, AgentMarketplacePermission } from '../../auth/permissions.js';
import { checkUserPermission, checkWorkspaceMembership } from '../../services/permissionService.js';
import type { PermissionOutcome, WorkspaceContext } from '../../services/permissionService.js';
import { resolveWorkspaceId } from '../../services/workspaceService.js';
import { WorkflowModel } from '../../models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../../models/WorkflowExecutionModel.js';

type RequestWithWorkspace = Request & { workspaceContext?: WorkspaceContext };
export type AnyPermission = Permission | AIPermission | TemplatePermission | AgentMarketplacePermission;

export interface WorkspaceSource {
  workflowParam?: string;
  executionParam?: string;
  workspaceParam?: string;
  useBodyWorkspace?: boolean;
}

export interface PermissionResolver {
  hiddenErrorCode: string;
  resolve(req: Request, permission?: AnyPermission): Promise<PermissionOutcome>;
}

const WORKSPACE_HIDDEN_ERROR = 'WORKSPACE_NOT_FOUND';
const WORKFLOW_HIDDEN_ERROR = 'WORKFLOW_NOT_FOUND';
const EXECUTION_HIDDEN_ERROR = 'EXECUTION_NOT_FOUND';

function hiddenErrorFor(source: WorkspaceSource): string {
  if (source.workflowParam) return WORKFLOW_HIDDEN_ERROR;
  if (source.executionParam) return EXECUTION_HIDDEN_ERROR;
  return WORKSPACE_HIDDEN_ERROR;
}

function requireObjectId(value: unknown, errorCode: string): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw new Error(errorCode);
  return value;
}

async function resolveWorkflowWorkspace(req: Request, param: string, userId: string): Promise<string> {
  const workflowId = requireObjectId(req.params[param], 'INVALID_WORKFLOW_ID');
  const workflow = await WorkflowModel.findById(workflowId);
  if (!workflow) throw new Error(WORKFLOW_HIDDEN_ERROR);
  if (workflow.workspaceId) return workflow.workspaceId.toString();
  if (workflow.ownerId.toString() !== userId) throw new Error(WORKFLOW_HIDDEN_ERROR);
  return resolveWorkspaceId(userId);
}

async function resolveExecutionWorkspace(req: Request, param: string, userId: string): Promise<string> {
  const executionId = requireObjectId(req.params[param], 'INVALID_EXECUTION_ID');
  const execution = await WorkflowExecutionModel.findById(executionId);
  if (!execution) throw new Error(EXECUTION_HIDDEN_ERROR);
  if (execution.workspaceId) return execution.workspaceId.toString();
  if (execution.ownerId.toString() !== userId) throw new Error(EXECUTION_HIDDEN_ERROR);
  return resolveWorkspaceId(userId);
}

export async function resolveTargetWorkspace(
  req: Request,
  source: WorkspaceSource,
  userId: string,
): Promise<string> {
  if (source.workflowParam) return resolveWorkflowWorkspace(req, source.workflowParam, userId);
  if (source.executionParam) return resolveExecutionWorkspace(req, source.executionParam, userId);
  if (source.workspaceParam && req.params[source.workspaceParam]) {
    return requireObjectId(req.params[source.workspaceParam], 'INVALID_WORKSPACE_ID');
  }
  if (source.useBodyWorkspace) {
    const body = req.body as { workspaceId?: unknown } | undefined;
    const requested = body?.workspaceId;
    if (typeof requested === 'string' && Types.ObjectId.isValid(requested)) return requested;
  }
  // Check for X-Workspace-Id header
  const headerWorkspaceId = req.headers['x-workspace-id'];
  if (headerWorkspaceId !== undefined) {
    if (Array.isArray(headerWorkspaceId)) {
      for (const value of headerWorkspaceId) {
        if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
          return value;
        }
      }
    } else if (typeof headerWorkspaceId === 'string' && Types.ObjectId.isValid(headerWorkspaceId)) {
      return headerWorkspaceId;
    }
  }
  return resolveWorkspaceId(userId);
}

export async function authorizeRequest(
  req: Request,
  source: WorkspaceSource,
  permission?: AnyPermission,
): Promise<PermissionOutcome> {
  const { userId } = getAuthUser(req);
  const workspaceId = await resolveTargetWorkspace(req, source, userId);
  const check = permission === undefined
    ? await checkWorkspaceMembership(workspaceId, userId)
    : await checkUserPermission(workspaceId, userId, permission);
  if (check.outcome !== 'allow' || !check.membership) return check.outcome;
  const context: WorkspaceContext = {
    workspaceId: check.membership.workspaceId,
    userId,
    role: check.membership.role,
    permissions: check.membership.permissions,
  };
  (req as RequestWithWorkspace).workspaceContext = context;
  return 'allow';
}

export function createWorkspaceResolver(source: WorkspaceSource): PermissionResolver {
  return {
    hiddenErrorCode: hiddenErrorFor(source),
    resolve: (req: Request, permission?: AnyPermission) => authorizeRequest(req, source, permission),
  };
}

export interface PermissionGuard {
  require(permission: AnyPermission): RequestHandler;
  requireMembership(): RequestHandler;
}

export function buildRequirePermission(resolver: PermissionResolver): PermissionGuard {
  const guard = (permission?: AnyPermission): RequestHandler =>
    async (req: Request, _res: Response, next: NextFunction) => {
      try {
        const outcome = await resolver.resolve(req, permission);
        if (outcome === 'allow') {
          next();
          return;
        }
        if (outcome === 'forbidden') {
          next(new Error('FORBIDDEN'));
          return;
        }
        if (outcome === 'denied') {
          next(new Error('PERMISSION_DENIED'));
          return;
        }
        next(new Error(resolver.hiddenErrorCode));
      } catch (error) {
        next(error);
      }
    };
  return { require: guard, requireMembership: () => guard() };
}

export function requirePermission(permission: AnyPermission, source: WorkspaceSource = {}): RequestHandler {
  return buildRequirePermission(createWorkspaceResolver(source)).require(permission);
}

export function requireMembership(source: WorkspaceSource = {}): RequestHandler {
  return buildRequirePermission(createWorkspaceResolver(source)).requireMembership();
}

export function getWorkspaceContext(req: Request): WorkspaceContext {
  const context = (req as RequestWithWorkspace).workspaceContext;
  if (!context) throw new Error('PERMISSION_CONTEXT_MISSING');
  return context;
}
