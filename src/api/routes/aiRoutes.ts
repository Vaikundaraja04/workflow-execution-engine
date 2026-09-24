import { Router } from 'express';
import { requirePermission, requireMembership, type PermissionResolver, type WorkspaceSource } from '../../api/middleware/requirePermission.js';
import type { Request, Response, NextFunction } from 'express';
import mongoose, { Types } from 'mongoose';
import { AIWorkflowService } from '../../services/aiWorkflowService.js';
import { AIProviderFactory } from '../../services/ai/AIProviderFactory.js';
import { AIFailureAnalysisService } from '../../services/aiFailureAnalysisService.js';
import { AIOptimizationService } from '../../services/aiOptimizationService.js';
import { AIOperationsAssistantService } from '../../services/aiOperationsAssistantService.js';
import { AIBusinessAssistantService } from '../../services/aiBusinessAssistantService.js';
import { AIUsageModel } from '../../models/AIUsageModel.js';
import { AIConfigurationModel } from '../../models/AIConfigurationModel.js';
import { createAuditLog } from '../../services/auditService.js';
import type { AuditAction } from '../../models/AuditLogModel.js';
import { checkUserPermission } from '../../services/permissionService.js';
import { AICopilotService } from '../../services/aiCopilotService.js';
import type { CopilotIntent } from '../../services/aiCopilotService.js';
import {
  AIFeaturePolicyModel,
  AIModelAccessPolicyModel,
  AIApprovalPolicyModel,
  AIPrivacyPolicyModel,
  AIPromptPolicyModel,
  AIUsageLimitPolicyModel,
  AI_GOVERNANCE_FEATURES,
  AI_GOVERNANCE_POLICY_TYPES,
  PII_DATA_CLASSES,
} from '../../models/AIGovernancePolicyModel.js';
import type { AIGovernanceFeature, AIGovernancePolicyType } from '../../models/AIGovernancePolicyModel.js';
import { AgentToolPolicyModel } from '../../models/AgentToolPolicyModel.js';
import { ApprovalRequestModel } from '../../models/ApprovalRequestModel.js';
import { ApprovalService } from '../../services/agent/approvalService.js';
import { AIGovernancePolicyService } from '../../services/aiGovernancePolicyService.js';
import { AISecurityService } from '../../services/ai/aiSecurityService.js';
import { AuditLogModel } from '../../models/AuditLogModel.js';
import type { WorkspaceRole } from '../../models/WorkspaceMemberModel.js';
const router = Router();

// Helper to track AI usage
async function trackAiUsage(
  workspaceId: Types.ObjectId,
  userId: Types.ObjectId,
  feature: 'workflow_generation' | 'failure_analysis' | 'optimization' | 'template_generation',
  tokensUsed: number = 0,
  costEstimate: number = 0,
  model?: string
) {
  const usageData: Record<string, unknown> = {
    workspaceId,
    userId,
    feature,
    tokensUsed,
    requests: 1,
    costEstimate,
  };
  if (model !== undefined) {
    usageData.model = model;
  }
  await AIUsageModel.create(usageData);
}

// POST /api/v1/ai/workflows/generate
router.post(
  '/workflows/generate',
  requirePermission('AI_WORKFLOW_CREATE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Prompt is required and must be a string' });
      }

      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const aiService = AIWorkflowService.getInstance();
      const result = await aiService.generateWorkflowFromPrompt(
        prompt,
        workspaceContext.workspaceId,
        workspaceContext.userId
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/ai/executions/:id/analyze
router.get(
  '/executions/:id/analyze',
  requirePermission('AI_ANALYSIS_READ', { executionParam: 'id' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawId = req.params.id;
      const executionId = typeof rawId === 'string' ? rawId : '';
      if (!executionId || !Types.ObjectId.isValid(executionId)) {
        return res.status(400).json({ error: 'Invalid execution ID' });
      }

      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const aiService = AIFailureAnalysisService.getInstance();
      const result = await aiService.analyzeExecution(
        executionId,
        workspaceContext.userId
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/workflows/:id/optimize
router.post(
  '/workflows/:id/optimize',
  requirePermission('AI_OPTIMIZATION_CREATE', { workflowParam: 'id' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawId = req.params.id;
      const workflowId = typeof rawId === 'string' ? rawId : '';
      if (!workflowId || !Types.ObjectId.isValid(workflowId)) {
        return res.status(400).json({ error: 'Invalid workflow ID' });
      }

      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const aiService = AIOptimizationService.getInstance();
      const result = await aiService.suggestOptimization(
        workflowId,
        workspaceContext.userId
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/templates/generate
router.post(
  '/templates/generate',
  requirePermission('AI_WORKFLOW_CREATE', {}),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Prompt is required and must be a string' });
      }

      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const aiService = AIWorkflowService.getInstance();
      const result = await aiService.generateTemplateFromPrompt(
        prompt,
        workspaceContext.workspaceId,
        workspaceContext.userId
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/operations/explain-failure
router.post(
  '/operations/explain-failure',
  requirePermission('AI_OPERATIONS_EXECUTE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { executionId } = req.body;
      if (!executionId) {
        return res.status(400).json({ error: 'Execution ID is required' });
      }

      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const aiService = AIOperationsAssistantService;
      const result = await aiService.explainWorkflowFailure(
        executionId,
        workspaceContext.workspaceId,
        workspaceContext.userId
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/operations/system-summary
router.post(
  '/operations/system-summary',
  requirePermission('AI_OPERATIONS_EXECUTE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const aiService = AIOperationsAssistantService;
      const result = await aiService.summarizeSystemHealth(
        workspaceContext.workspaceId,
        workspaceContext.userId
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/operations/anomalies
router.post(
  '/operations/anomalies',
  requirePermission('AI_OPERATIONS_EXECUTE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const aiService = AIOperationsAssistantService;
      const result = await aiService.detectSystemAnomalies(
        workspaceContext.workspaceId
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/operations/suggest-optimizations
router.post(
  '/operations/suggest-optimizations',
  requirePermission('AI_OPERATIONS_EXECUTE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const aiService = AIOperationsAssistantService;
      const result = await aiService.suggestOptimizations(
        workspaceContext.workspaceId
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/operations/scaling-recommendations
router.post(
  '/operations/scaling-recommendations',
  requirePermission('AI_OPERATIONS_EXECUTE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const aiService = AIOperationsAssistantService;
      const result = await aiService.recommendScalingActions(
        workspaceContext.workspaceId
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/ai/usage
router.get(
  '/usage',
  requirePermission('AI_CONFIGURATION_MANAGE', {}),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { userId } = workspaceContext;
      const { workspaceId } = workspaceContext;

      const usage = await AIUsageModel.find({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: new Types.ObjectId(userId)
      }).sort({ createdAt: -1 });

      res.json(usage);
    } catch (error) {
      next(error);
    }
  }
);

// Admin routes for AI configuration (mounted at /api/v1/admin/ai)
// POST /api/v1/ai/business/cost-optimization
router.post(
  '/business/cost-optimization',
  requirePermission('AI_BUSINESS_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const result = await AIBusinessAssistantService.costOptimizationRecommendations(
        workspaceContext.workspaceId,
        workspaceContext.userId?.toString()
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/business/workflow-roi
router.post(
  '/business/workflow-roi',
  requirePermission('AI_BUSINESS_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { workflowId } = req.body;
      const result = await AIBusinessAssistantService.workflowRoiAnalysis(
        workspaceContext.workspaceId,
        workflowId,
        workspaceContext.userId?.toString()
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/business/usage-forecast
router.post(
  '/business/usage-forecast',
  requirePermission('AI_BUSINESS_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const result = await AIBusinessAssistantService.usageForecasting(
        workspaceContext.workspaceId,
        workspaceContext.userId?.toString()
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/business/capacity-prediction
router.post(
  '/business/capacity-prediction',
  requirePermission('AI_BUSINESS_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const result = await AIBusinessAssistantService.capacityPrediction(
        workspaceContext.workspaceId,
        workspaceContext.userId?.toString()
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/business/subscription-recommendations
router.post(
  '/business/subscription-recommendations',
  requirePermission('AI_BUSINESS_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const result = await AIBusinessAssistantService.subscriptionRecommendations(
        workspaceContext.workspaceId,
        workspaceContext.userId?.toString()
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/business/governance-suggestions
router.post(
  '/business/governance-suggestions',
  requirePermission('AI_BUSINESS_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const result = await AIBusinessAssistantService.governanceSuggestions(
        workspaceContext.workspaceId,
        workspaceContext.userId?.toString()
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/copilot/session — conversation session (RBAC: AI_ANALYSIS_READ)
router.post(
  '/copilot/session',
  requirePermission('AI_ANALYSIS_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
      const session = await AICopilotService.getInstance().createSession(
        workspaceContext.workspaceId,
        workspaceContext.userId,
        title !== undefined ? { title } : {},
      );
      res.status(201).json(session);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/ai/copilot/:id/message — send message, route intent (RBAC: AI_ANALYSIS_READ + create-check)
router.post(
  '/copilot/:id/message',
  requirePermission('AI_ANALYSIS_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const rawId = req.params.id;
      const sessionId = typeof rawId === 'string' ? rawId : '';
      if (!sessionId || !Types.ObjectId.isValid(sessionId)) {
        return res.status(400).json({ error: 'Invalid copilot session ID' });
      }
      const content = req.body?.content ?? req.body?.message;
      if (typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: 'Message content is required and must be a string' });
      }
      // BUILD/MODIFY intents mutate workflow drafts — require AI_WORKFLOW_CREATE.
      const intent = AICopilotService.getInstance().classifyIntent(content) as CopilotIntent;
      if (intent === 'BUILD_WORKFLOW' || intent === 'MODIFY_WORKFLOW') {
        const check = await checkUserPermission(
          workspaceContext.workspaceId,
          workspaceContext.userId,
          'AI_WORKFLOW_CREATE',
        );
        if (check.outcome !== 'allow') {
          return res.status(403).json({ error: 'Insufficient permission for this action' });
        }
      }
      const result = await AICopilotService.getInstance().processMessage({
        sessionId,
        workspaceId: workspaceContext.workspaceId,
        userId: workspaceContext.userId,
        content,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/ai/copilot/:id — session + messages (RBAC: AI_ANALYSIS_READ)
router.get(
  '/copilot/:id',
  requirePermission('AI_ANALYSIS_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const rawId = req.params.id;
      const sessionId = typeof rawId === 'string' ? rawId : '';
      if (!sessionId || !Types.ObjectId.isValid(sessionId)) {
        return res.status(400).json({ error: 'Invalid copilot session ID' });
      }
      const result = await AICopilotService.getInstance().getSession(
        sessionId,
        workspaceContext.workspaceId,
      );
      if (!result) {
        return res.status(404).json({ error: 'Copilot session not found' });
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const aiConfigRouter = Router();

// GET /api/v1/admin/ai/config
aiConfigRouter.get(
  '/config',
  requirePermission('AI_CONFIGURATION_MANAGE', {}),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const config = await AIConfigurationModel.findOne({
        workspaceId: new Types.ObjectId(workspaceContext.workspaceId)
      });

      if (!config) {
        return res.status(404).json({ error: 'AI configuration not found for this workspace' });
      }

      // Don't return the encrypted API key
      const { apiKeyEncrypted, ...configWithoutSecret } = config.toObject();
      res.json({ ...configWithoutSecret, hasApiKey: Boolean(config.apiKeyEncrypted) });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/admin/ai/config
aiConfigRouter.patch(
  '/config',
  requirePermission('AI_CONFIGURATION_MANAGE', {}),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get workspace context from the request (set by requirePermission middleware)
      const workspaceContext = (req as any).workspaceContext;
      if (!workspaceContext) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { provider, model, temperature, maxTokens, features, apiKey, enabled } = req.body;

      // Find existing config or create new one
      let config = await AIConfigurationModel.findOne({
        workspaceId: new Types.ObjectId(workspaceContext.workspaceId)
      });

      if (!config) {
        config = new AIConfigurationModel({
          workspaceId: new Types.ObjectId(workspaceContext.workspaceId),
          createdBy: new Types.ObjectId(workspaceContext.userId)
        });
      }

      // Update fields
      if (provider) {
        if (!['mock', 'openai', 'anthropic', 'gemini', 'openrouter'].includes(provider)) {
          return res.status(400).json({ error: { code: 'INVALID_PROVIDER', message: 'Unsupported AI provider' } });
        }
        config.provider = provider;
      }
      if (model) config.model = model;
      if (temperature !== undefined) config.temperature = temperature;
      if (maxTokens !== undefined) config.maxTokens = maxTokens;
      if (features) config.features = features;
      if (apiKey) {
        config.apiKeyEncrypted = apiKey;
      }
      if (enabled !== undefined) config.enabled = Boolean(enabled);
      const effectiveProvider = provider || config.provider;
      if (effectiveProvider !== 'mock' && !config.apiKeyEncrypted) {
        return res.status(400).json({ error: { code: 'API_KEY_REQUIRED', message: 'An API key is required for this provider' } });
      }
      config.updatedBy = new Types.ObjectId(workspaceContext.userId);

      await config.save();

      // Don't return the encrypted API key in the response
      const { apiKeyEncrypted, ...configWithoutSecret } = config.toObject();
      res.json({ ...configWithoutSecret, hasApiKey: Boolean(config.apiKeyEncrypted) });

      // Create audit log
      await createAuditLog({
        action: 'AI_CONFIGURATION_UPDATED' as AuditAction,
        userId: new Types.ObjectId(workspaceContext.userId),
        workspaceId: new Types.ObjectId(workspaceContext.workspaceId),
        metadata: {
          provider: config.provider,
          model: config.model,
          features: config.features
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

aiConfigRouter.post(
  '/test',
  requirePermission('AI_CONFIGURATION_MANAGE', {}),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const result = await AIProviderFactory.getProviderForWorkspace(workspaceContext.workspaceId);
      const sample = await result.provider.generateText('Reply with exactly: OK');
      res.json({ data: { ok: true, provider: result.providerName, model: result.model, sample } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI provider test failed';
      res.status(400).json({ error: { code: 'AI_PROVIDER_TEST_FAILED', message } });
    }
  }
);

export default router;
// ─── Phase 12.6: Enterprise AI Governance Expansion ────────────────────────────
// Mounted under /api/v1/ai/governance. The legacy budget/router/sanitize endpoints
// remain served by aiGovernanceRoutes, registered at the same base in app.ts.

const governanceRouter = Router();

const GOVERNANCE_POLICY_LIST: Array<Exclude<AIGovernancePolicyType, 'AGENT_TOOL'>> = [
  'MODEL_ACCESS',
  'FEATURE',
  'PROMPT',
  'PRIVACY',
  'USAGE_LIMIT',
  'APPROVAL',
];

const GOVERNANCE_AUDIT_ACTIONS = [
  'AI_GOVERNANCE_POLICY_CREATED',
  'AI_GOVERNANCE_POLICY_UPDATED',
  'AI_GOVERNANCE_POLICY_DELETED',
  'AI_GOVERNANCE_ALLOWED',
  'AI_GOVERNANCE_DENIED',
  'AI_GOVERNANCE_APPROVAL_REQUIRED',
  'AI_GOVERNANCE_APPROVED',
  'AI_GOVERNANCE_REJECTED',
] as const;

const GOVERNANCE_ROLES: readonly WorkspaceRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];

const APPROVER_RANK: Record<WorkspaceRole, number> = { OWNER: 4, ADMIN: 3, EDITOR: 2, VIEWER: 1 };

function governanceModelFor(type: Exclude<AIGovernancePolicyType, 'AGENT_TOOL'>): mongoose.Model<any> {
  switch (type) {
    case 'MODEL_ACCESS':
      return AIModelAccessPolicyModel;
    case 'FEATURE':
      return AIFeaturePolicyModel;
    case 'PROMPT':
      return AIPromptPolicyModel;
    case 'PRIVACY':
      return AIPrivacyPolicyModel;
    case 'USAGE_LIMIT':
      return AIUsageLimitPolicyModel;
    case 'APPROVAL':
      return AIApprovalPolicyModel;
  }
}

function isGovernancePolicyType(value: unknown): value is AIGovernancePolicyType {
  return typeof value === 'string' && (AI_GOVERNANCE_POLICY_TYPES as readonly string[]).includes(value);
}

function isGovernanceFeature(value: unknown): value is AIGovernanceFeature {
  return typeof value === 'string' && (AI_GOVERNANCE_FEATURES as readonly string[]).includes(value);
}
function validatePatternList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new Error('INVALID_GOVERNANCE_POLICY');
  }
  for (const pattern of value as string[]) {
    try {
      new RegExp(pattern);
    } catch {
      throw new Error('INVALID_GOVERNANCE_POLICY');
    }
  }
  return value as string[];
}

function validateStringList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error('INVALID_GOVERNANCE_POLICY');
  }
  return value as string[];
}

function validateRoleList(value: unknown): WorkspaceRole[] {
  const roles = validateStringList(value, 'roles');
  if (roles.some((role) => !GOVERNANCE_ROLES.includes(role as WorkspaceRole))) {
    throw new Error('INVALID_GOVERNANCE_POLICY');
  }
  return roles as WorkspaceRole[];
}

function validateNumber(value: unknown, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) throw new Error('INVALID_GOVERNANCE_POLICY');
  return value;
}
function governancePolicyView(type: AIGovernancePolicyType, doc: Record<string, unknown>): Record<string, unknown> {
  const view: Record<string, unknown> = { ...doc, policyType: type };
  delete view.updatedBy;
  return view;
}

async function findGovernancePolicy(
  workspaceId: string,
  id: string,
): Promise<{ type: AIGovernancePolicyType; doc: Record<string, unknown> } | null> {
  if (!Types.ObjectId.isValid(id)) throw new Error('INVALID_GOVERNANCE_POLICY');
  const candidates = await Promise.all([
    ...GOVERNANCE_POLICY_LIST.map(async (type) => {
      const model = governanceModelFor(type);
      const doc = await model.findById(id).lean();
      if (doc && doc.workspaceId.toString() === workspaceId) {
        return { type, doc: doc as unknown as Record<string, unknown> };
      }
      return null;
    }),
    (async () => {
      const doc = await AgentToolPolicyModel.findById(id).lean();
      if (doc && doc.workspaceId.toString() === workspaceId) {
        return { type: 'AGENT_TOOL' as AIGovernancePolicyType, doc: doc as unknown as Record<string, unknown> };
      }
      return null;
    })(),
  ]);
  return candidates.find((entry) => entry !== null) ?? null;
}
function validateStatus(value: unknown): 'ACTIVE' | 'DISABLED' {
  if (value === undefined) return 'ACTIVE';
  if (value === 'ACTIVE' || value === 'DISABLED') return value;
  throw new Error('INVALID_GOVERNANCE_POLICY');
}

function validateSeverity(value: unknown): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (value === undefined) return 'MEDIUM';
  if (value === 'LOW' || value === 'MEDIUM' || value === 'HIGH') return value;
  throw new Error('INVALID_GOVERNANCE_POLICY');
}

function validateActionOnExceeded(value: unknown): 'THROTTLE' | 'BLOCK' {
  if (value === undefined) return 'THROTTLE';
  if (value === 'THROTTLE' || value === 'BLOCK') return value;
  throw new Error('INVALID_GOVERNANCE_POLICY');
}
function validateDataClasses(value: unknown): string[] {
  const classes = validateStringList(value, 'allowedDataClasses');
  if (classes.some((entry) => !(PII_DATA_CLASSES as readonly string[]).includes(entry))) {
    throw new Error('INVALID_GOVERNANCE_POLICY');
  }
  return classes;
}

function validateRedactionRules(value: unknown): Array<{ dataClass: string; action: 'REDACT' | 'BLOCK'; pattern?: string }> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('INVALID_GOVERNANCE_POLICY');
  return value.map((entry) => {
    const rule = entry as Record<string, unknown>;
    if (
      typeof rule.dataClass !== 'string'
      || !(PII_DATA_CLASSES as readonly string[]).includes(rule.dataClass)
      || (rule.action !== 'REDACT' && rule.action !== 'BLOCK')
    ) {
      throw new Error('INVALID_GOVERNANCE_POLICY');
    }
    const result: { dataClass: string; action: 'REDACT' | 'BLOCK'; pattern?: string } = {
      dataClass: rule.dataClass,
      action: rule.action,
    };
    if (rule.pattern !== undefined) {
      if (typeof rule.pattern !== 'string') throw new Error('INVALID_GOVERNANCE_POLICY');
      try {
        new RegExp(rule.pattern);
      } catch {
        throw new Error('INVALID_GOVERNANCE_POLICY');
      }
      result.pattern = rule.pattern;
    }
    return result;
  });
}

function validateApprovalConditions(value: unknown): {
  premiumModel: boolean;
  highCost: boolean;
  riskLevel: boolean;
  sensitivePrompt: boolean;
} {
  const conditions = (value ?? {}) as Record<string, unknown>;
  return {
    premiumModel: Boolean(conditions.premiumModel),
    highCost: Boolean(conditions.highCost),
    riskLevel: Boolean(conditions.riskLevel),
    sensitivePrompt: Boolean(conditions.sensitivePrompt),
  };
}

function validateApproverRole(value: unknown): WorkspaceRole {
  if (value === undefined) return 'ADMIN';
  if (typeof value === 'string' && GOVERNANCE_ROLES.includes(value as WorkspaceRole)) return value as WorkspaceRole;
  throw new Error('INVALID_GOVERNANCE_POLICY');
}
governanceRouter.get(
  '/policies',
  requirePermission('AI_GOVERNANCE_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = (req as any).workspaceContext.workspaceId as string;
      const typeFilter = typeof req.query.type === 'string' ? req.query.type : undefined;
      if (typeFilter !== undefined && !isGovernancePolicyType(typeFilter)) {
        return res.status(400).json({ error: { code: 'INVALID_GOVERNANCE_POLICY', message: 'Unknown policy type' } });
      }
      const wsId = new Types.ObjectId(workspaceId);
      const results: Record<string, unknown>[] = [];

      if (typeFilter === undefined || typeFilter === 'AGENT_TOOL') {
        const toolDocs = await AgentToolPolicyModel.find({ workspaceId: wsId }).lean();
        results.push(
          ...toolDocs.map((doc) => governancePolicyView('AGENT_TOOL', doc as unknown as Record<string, unknown>)),
        );
      }

      const plainTypes = typeFilter === undefined
        ? GOVERNANCE_POLICY_LIST
        : typeFilter === 'AGENT_TOOL'
          ? []
          : [typeFilter as Exclude<AIGovernancePolicyType, 'AGENT_TOOL'>];

      const groups = await Promise.all(
        plainTypes.map(async (type) => {
          const model = governanceModelFor(type);
          const docs = await model.find({ workspaceId: wsId }).lean();
          return docs.map((doc) => governancePolicyView(type, doc as unknown as Record<string, unknown>));
        }),
      );
      for (const group of groups) results.push(...group);

      res.json({ data: results });
    } catch (error) {
      next(error);
    }
  },
);
governanceRouter.post(
  '/policies',
  requirePermission('AI_GOVERNANCE_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const workspaceId = workspaceContext.workspaceId as string;
      const userId = workspaceContext.userId as string;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const type = body.type;
      if (!isGovernancePolicyType(type)) {
        return res.status(400).json({ error: { code: 'INVALID_GOVERNANCE_POLICY', message: 'type is required' } });
      }

      const wsId = new Types.ObjectId(workspaceId);
      const updatedBy = new Types.ObjectId(userId);
      let created: unknown;
      let wasExisting = false;

      switch (type) {
        case 'MODEL_ACCESS': {
          wasExisting = (await AIModelAccessPolicyModel.exists({ workspaceId: wsId })) !== null;
          created = await AIModelAccessPolicyModel.findOneAndUpdate(
            { workspaceId: wsId },
            {
              workspaceId: wsId,
              updatedBy,
              allowedModels: validateStringList(body.allowedModels, 'allowedModels'),
              blockedModels: validateStringList(body.blockedModels, 'blockedModels'),
              allowedRoles: validateRoleList(body.allowedRoles),
              status: validateStatus(body.status),
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ).lean();
          break;
        }
        case 'FEATURE': {
          if (!isGovernanceFeature(body.feature)) throw new Error('INVALID_GOVERNANCE_POLICY');
          wasExisting = (await AIFeaturePolicyModel.exists({ workspaceId: wsId, feature: body.feature })) !== null;
          created = await AIFeaturePolicyModel.findOneAndUpdate(
            { workspaceId: wsId, feature: body.feature },
            {
              workspaceId: wsId,
              feature: body.feature,
              updatedBy,
              allowedRoles: validateRoleList(body.allowedRoles),
              enabled: body.enabled === undefined ? true : Boolean(body.enabled),
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ).lean();
          break;
        }        case 'PROMPT': {
          wasExisting = (await AIPromptPolicyModel.exists({ workspaceId: wsId })) !== null;
          created = await AIPromptPolicyModel.findOneAndUpdate(
            { workspaceId: wsId },
            {
              workspaceId: wsId,
              updatedBy,
              blockedPatterns: validatePatternList(body.blockedPatterns, 'blockedPatterns'),
              requiredApprovalPatterns: validatePatternList(body.requiredApprovalPatterns, 'requiredApprovalPatterns'),
              severity: validateSeverity(body.severity),
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ).lean();
          break;
        }
        case 'PRIVACY': {
          wasExisting = (await AIPrivacyPolicyModel.exists({ workspaceId: wsId })) !== null;
          created = await AIPrivacyPolicyModel.findOneAndUpdate(
            { workspaceId: wsId },
            {
              workspaceId: wsId,
              updatedBy,
              allowedDataClasses: validateDataClasses(body.allowedDataClasses),
              redactionRules: validateRedactionRules(body.redactionRules),
              blockSensitiveData: Boolean(body.blockSensitiveData),
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ).lean();
          break;
        }        case 'USAGE_LIMIT': {
          wasExisting = (await AIUsageLimitPolicyModel.exists({ workspaceId: wsId })) !== null;
          created = await AIUsageLimitPolicyModel.findOneAndUpdate(
            { workspaceId: wsId },
            {
              workspaceId: wsId,
              updatedBy,
              dailyTokenLimit: validateNumber(body.dailyTokenLimit),
              monthlyTokenLimit: validateNumber(body.monthlyTokenLimit),
              dailyCostLimit: validateNumber(body.dailyCostLimit),
              monthlyCostLimit: validateNumber(body.monthlyCostLimit),
              actionOnExceeded: validateActionOnExceeded(body.actionOnExceeded),
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ).lean();
          break;
        }
        case 'APPROVAL': {
          wasExisting = (await AIApprovalPolicyModel.exists({ workspaceId: wsId })) !== null;
          created = await AIApprovalPolicyModel.findOneAndUpdate(
            { workspaceId: wsId },
            {
              workspaceId: wsId,
              updatedBy,
              conditions: validateApprovalConditions(body.conditions),
              highCostThresholdUSD: validateNumber(body.highCostThresholdUSD, 1),
              requiredApproverRole: validateApproverRole(body.requiredApproverRole),
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ).lean();
          break;
        }
        case 'AGENT_TOOL': {
          if (typeof body.toolName !== 'string' || body.toolName.length === 0) throw new Error('INVALID_GOVERNANCE_POLICY');
          if (body.policy !== 'ALLOW' && body.policy !== 'DENY' && body.policy !== 'REQUIRE_APPROVAL') {
            throw new Error('INVALID_GOVERNANCE_POLICY');
          }
          wasExisting = (await AgentToolPolicyModel.exists({ workspaceId: wsId, toolName: body.toolName })) !== null;
          created = await AgentToolPolicyModel.findOneAndUpdate(
            { workspaceId: wsId, toolName: body.toolName },
            { workspaceId: wsId, toolName: body.toolName, policy: body.policy, updatedBy },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ).lean() as unknown as Record<string, unknown>;
          break;
        }
      }
      await createAuditLog({
        action: wasExisting ? 'AI_GOVERNANCE_POLICY_UPDATED' : 'AI_GOVERNANCE_POLICY_CREATED',
        userId: updatedBy,
        workspaceId: wsId,
        resource: 'AIGovernancePolicy',
        resourceId: String((created as { _id?: unknown } | null)?._id ?? ''),
        metadata: AISecurityService.sanitizeMetadata({
          policyType: type,
          fields: Object.keys(body).filter((key) => key !== 'type'),
        }),
      });

      res.status(201).json({ data: governancePolicyView(type, (created ?? {}) as Record<string, unknown>) });
    } catch (error) {
      next(error);
    }
  },
);

governanceRouter.put(
  '/policies/:id',
  requirePermission('AI_GOVERNANCE_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const workspaceId = workspaceContext.workspaceId as string;
      const userId = workspaceContext.userId as string;
      const rawId = req.params.id;
      const policyId = typeof rawId === 'string' ? rawId : '';
      const resolved = await findGovernancePolicy(workspaceId, policyId);
      if (!resolved) {
        return res.status(404).json({ error: { code: 'GOVERNANCE_POLICY_NOT_FOUND', message: 'Governance policy was not found' } });
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updatedBy = new Types.ObjectId(userId);
      const updates: Record<string, unknown> = { updatedBy };
      switch (resolved.type) {
        case 'MODEL_ACCESS':
          if (body.allowedModels !== undefined) updates.allowedModels = validateStringList(body.allowedModels, 'allowedModels');
          if (body.blockedModels !== undefined) updates.blockedModels = validateStringList(body.blockedModels, 'blockedModels');
          if (body.allowedRoles !== undefined) updates.allowedRoles = validateRoleList(body.allowedRoles);
          if (body.status !== undefined) updates.status = validateStatus(body.status);
          break;
        case 'FEATURE':
          if (body.allowedRoles !== undefined) updates.allowedRoles = validateRoleList(body.allowedRoles);
          if (body.enabled !== undefined) updates.enabled = Boolean(body.enabled);
          break;
        case 'PROMPT':
          if (body.blockedPatterns !== undefined) updates.blockedPatterns = validatePatternList(body.blockedPatterns, 'blockedPatterns');
          if (body.requiredApprovalPatterns !== undefined) updates.requiredApprovalPatterns = validatePatternList(body.requiredApprovalPatterns, 'requiredApprovalPatterns');
          if (body.severity !== undefined) updates.severity = validateSeverity(body.severity);
          break;
        case 'PRIVACY':
          if (body.allowedDataClasses !== undefined) updates.allowedDataClasses = validateDataClasses(body.allowedDataClasses);
          if (body.redactionRules !== undefined) updates.redactionRules = validateRedactionRules(body.redactionRules);
          if (body.blockSensitiveData !== undefined) updates.blockSensitiveData = Boolean(body.blockSensitiveData);
          break;        case 'USAGE_LIMIT':
          if (body.dailyTokenLimit !== undefined) updates.dailyTokenLimit = validateNumber(body.dailyTokenLimit);
          if (body.monthlyTokenLimit !== undefined) updates.monthlyTokenLimit = validateNumber(body.monthlyTokenLimit);
          if (body.dailyCostLimit !== undefined) updates.dailyCostLimit = validateNumber(body.dailyCostLimit);
          if (body.monthlyCostLimit !== undefined) updates.monthlyCostLimit = validateNumber(body.monthlyCostLimit);
          if (body.actionOnExceeded !== undefined) updates.actionOnExceeded = validateActionOnExceeded(body.actionOnExceeded);
          break;
        case 'APPROVAL':
          if (body.conditions !== undefined) updates.conditions = validateApprovalConditions(body.conditions);
          if (body.highCostThresholdUSD !== undefined) updates.highCostThresholdUSD = validateNumber(body.highCostThresholdUSD, 1);
          if (body.requiredApproverRole !== undefined) updates.requiredApproverRole = validateApproverRole(body.requiredApproverRole);
          break;
        case 'AGENT_TOOL':
          if (body.policy !== undefined) {
            if (body.policy !== 'ALLOW' && body.policy !== 'DENY' && body.policy !== 'REQUIRE_APPROVAL') {
              throw new Error('INVALID_GOVERNANCE_POLICY');
            }
            updates.policy = body.policy;
          }
          break;
      }

      const model: mongoose.Model<any> = resolved.type === 'AGENT_TOOL' ? AgentToolPolicyModel : governanceModelFor(resolved.type);
      const updated = await model.findByIdAndUpdate(policyId, updates, { new: true }).lean();

      await createAuditLog({
        action: 'AI_GOVERNANCE_POLICY_UPDATED',
        userId: updatedBy,
        workspaceId: new Types.ObjectId(workspaceId),
        resource: 'AIGovernancePolicy',
        resourceId: policyId,
        metadata: AISecurityService.sanitizeMetadata({
          policyType: resolved.type,
          fields: Object.keys(updates).filter((key) => key !== 'updatedBy'),
        }),
      });

      res.json({ data: governancePolicyView(resolved.type, (updated ?? {}) as Record<string, unknown>) });
    } catch (error) {
      next(error);
    }
  },
);
governanceRouter.delete(
  '/policies/:id',
  requirePermission('AI_GOVERNANCE_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const workspaceId = workspaceContext.workspaceId as string;
      const userId = workspaceContext.userId as string;
      const rawId = req.params.id;
      const policyId = typeof rawId === 'string' ? rawId : '';
      const resolved = await findGovernancePolicy(workspaceId, policyId);
      if (!resolved) {
        return res.status(404).json({ error: { code: 'GOVERNANCE_POLICY_NOT_FOUND', message: 'Governance policy was not found' } });
      }
      const model: mongoose.Model<any> = resolved.type === 'AGENT_TOOL' ? AgentToolPolicyModel : governanceModelFor(resolved.type);
      await model.findByIdAndDelete(policyId);

      await createAuditLog({
        action: 'AI_GOVERNANCE_POLICY_DELETED',
        userId: new Types.ObjectId(userId),
        workspaceId: new Types.ObjectId(workspaceId),
        resource: 'AIGovernancePolicy',
        resourceId: policyId,
        metadata: { policyType: resolved.type },
      });

      res.json({ data: { deleted: true, policyId, policyType: resolved.type } });
    } catch (error) {
      next(error);
    }
  },
);
governanceRouter.post(
  '/evaluate',
  requirePermission('AI_GOVERNANCE_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!isGovernanceFeature(body.feature)) {
        return res.status(400).json({ error: { code: 'INVALID_GOVERNANCE_POLICY', message: 'feature is required' } });
      }
      const riskLevel = body.riskLevel === 'LOW' || body.riskLevel === 'MEDIUM' || body.riskLevel === 'HIGH'
        ? body.riskLevel
        : undefined;
      const decision = await AIGovernancePolicyService.getInstance().evaluateRequest({
        workspaceId: workspaceContext.workspaceId,
        userId: workspaceContext.userId,
        role: workspaceContext.role,
        feature: body.feature,
        dryRun: true,
        ...(typeof body.model === 'string' ? { model: body.model } : {}),
        ...(typeof body.provider === 'string' ? { provider: body.provider } : {}),
        ...(typeof body.prompt === 'string' ? { prompt: body.prompt } : {}),
        ...(typeof body.estimatedTokens === 'number' ? { estimatedTokens: body.estimatedTokens } : {}),
        ...(typeof body.estimatedCostUSD === 'number' ? { estimatedCostUSD: body.estimatedCostUSD } : {}),
        ...(riskLevel !== undefined ? { riskLevel } : {}),
      });
      res.json({ data: decision });
    } catch (error) {
      next(error);
    }
  },
);
governanceRouter.get(
  '/audit/events',
  requirePermission('AI_GOVERNANCE_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const workspaceId = workspaceContext.workspaceId as string;
      const requestedLimit = Number(req.query.limit);
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 50;
      const actionFilter: string | undefined = typeof req.query.action === 'string'
        && (GOVERNANCE_AUDIT_ACTIONS as readonly string[]).includes(req.query.action)
        ? req.query.action
        : undefined;

      const actions: AuditAction[] = actionFilter
        ? [actionFilter as AuditAction]
        : [...GOVERNANCE_AUDIT_ACTIONS];
      const events = await AuditLogModel.find({
        workspaceId: new Types.ObjectId(workspaceId),
        action: { $in: actions },
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      res.json({
        data: events.map((event) => ({
          id: event._id.toString(),
          action: event.action,
          userId: event.userId ? event.userId.toString() : null,
          resource: event.resource ?? null,
          resourceId: event.resourceId ?? null,
          metadata: event.metadata ?? {},
          createdAt: event.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);
governanceRouter.get(
  '/audit/summary',
  requirePermission('AI_GOVERNANCE_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const workspaceId = workspaceContext.workspaceId as string;
      const wsId = new Types.ObjectId(workspaceId);
      const timeframe = typeof req.query.timeframe === 'string' ? req.query.timeframe : '24h';
      const hours = timeframe === '7d' ? 24 * 7 : timeframe === '30d' ? 24 * 30 : 24;
      const start = new Date(Date.now() - hours * 60 * 60 * 1000);

      const [decisionRows, usageRows, featureRows, modelRows, pendingApprovals] = await Promise.all([
        AuditLogModel.aggregate<{ _id: string; count: number }>([
          { $match: { workspaceId: wsId, action: { $in: [...GOVERNANCE_AUDIT_ACTIONS] }, createdAt: { $gte: start } } },
          { $group: { _id: '$action', count: { $sum: 1 } } },
        ]),
        AIUsageModel.aggregate<{ tokens: number; requests: number; cost: number }>([
          { $match: { workspaceId: wsId, createdAt: { $gte: start } } },
          { $group: { _id: null, tokens: { $sum: '$tokensUsed' }, requests: { $sum: '$requests' }, cost: { $sum: '$costEstimate' } } },
        ]),
        AIUsageModel.aggregate<{ _id: string; tokens: number; cost: number }>([
          { $match: { workspaceId: wsId, createdAt: { $gte: start } } },
          { $group: { _id: '$feature', tokens: { $sum: '$tokensUsed' }, cost: { $sum: '$costEstimate' } } },
        ]),
        AIUsageModel.aggregate<{ _id: string; tokens: number; cost: number }>([
          { $match: { workspaceId: wsId, createdAt: { $gte: start } } },
          { $group: { _id: '$model', tokens: { $sum: '$tokensUsed' }, cost: { $sum: '$costEstimate' } } },
          { $sort: { cost: -1 } },
          { $limit: 5 },
        ]),
        ApprovalRequestModel.countDocuments({ workspaceId: wsId, resourceType: 'AI_OPERATION', status: 'PENDING' }),
      ]);
      const decisionCounts: Record<string, number> = {};
      for (const row of decisionRows) decisionCounts[row._id] = row.count;
      const usage = usageRows[0] ?? { tokens: 0, requests: 0, cost: 0 };

      res.json({
        data: {
          timeframe,
          decisions: {
            allowed: decisionCounts.AI_GOVERNANCE_ALLOWED ?? 0,
            denied: decisionCounts.AI_GOVERNANCE_DENIED ?? 0,
            approvalRequired: decisionCounts.AI_GOVERNANCE_APPROVAL_REQUIRED ?? 0,
            approved: decisionCounts.AI_GOVERNANCE_APPROVED ?? 0,
            rejected: decisionCounts.AI_GOVERNANCE_REJECTED ?? 0,
          },
          usage: {
            tokens: usage.tokens,
            requests: usage.requests,
            costUSD: Math.round(usage.cost * 10000) / 10000,
            byFeature: featureRows.map((row) => ({
              feature: row._id,
              tokens: row.tokens,
              costUSD: Math.round(row.cost * 10000) / 10000,
            })),
            topModels: modelRows.map((row) => ({
              model: row._id ?? 'unspecified',
              tokens: row.tokens,
              costUSD: Math.round(row.cost * 10000) / 10000,
            })),
          },
          approvals: { pending: pendingApprovals },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
governanceRouter.get(
  '/approvals',
  requirePermission('AI_GOVERNANCE_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const workspaceId = workspaceContext.workspaceId as string;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const query: Record<string, unknown> = {
        workspaceId: new Types.ObjectId(workspaceId),
        resourceType: 'AI_OPERATION',
      };
      if (status !== undefined) query.status = status;
      const approvals = await ApprovalRequestModel.find(query).sort({ createdAt: -1 }).limit(100).lean();
      res.json({ data: approvals });
    } catch (error) {
      next(error);
    }
  },
);

async function loadGovernanceApproval(workspaceId: string, approvalId: string) {
  if (!Types.ObjectId.isValid(approvalId)) throw new Error('APPROVAL_NOT_FOUND');
  return ApprovalRequestModel.findOne({
    _id: new Types.ObjectId(approvalId),
    workspaceId: new Types.ObjectId(workspaceId),
    resourceType: 'AI_OPERATION',
  });
}

function assertApproverRole(requiredRole: unknown, callerRole: string): void {
  if (typeof requiredRole !== 'string' || !GOVERNANCE_ROLES.includes(requiredRole as WorkspaceRole)) return;
  const requiredRank = APPROVER_RANK[requiredRole as WorkspaceRole];
  const callerRank = APPROVER_RANK[callerRole as WorkspaceRole] ?? 0;
  if (callerRank < requiredRank) throw new Error('FORBIDDEN');
}
governanceRouter.post(
  '/approvals/:id/approve',
  requirePermission('AI_GOVERNANCE_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const workspaceId = workspaceContext.workspaceId as string;
      const rawId = req.params.id;
      const approvalId = typeof rawId === 'string' ? rawId : '';
      const approval = await loadGovernanceApproval(workspaceId, approvalId);
      if (!approval) {
        return res.status(404).json({ error: { code: 'APPROVAL_NOT_FOUND', message: 'Approval request was not found' } });
      }
      const requiredRole = (approval.payload as Record<string, unknown> | undefined)?.requiredApproverRole;
      assertApproverRole(requiredRole, workspaceContext.role);

      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      const approved = await ApprovalService.getInstance().approve(
        approvalId,
        workspaceId,
        workspaceContext.userId,
        reason,
      );

      await createAuditLog({
        action: 'AI_GOVERNANCE_APPROVED',
        userId: new Types.ObjectId(workspaceContext.userId),
        workspaceId: new Types.ObjectId(workspaceId),
        resource: 'AI_OPERATION',
        resourceId: approval.resourceId,
        metadata: AISecurityService.sanitizeMetadata({
          approvalId,
          feature: approval.action,
          requiredApproverRole: typeof requiredRole === 'string' ? requiredRole : null,
          reason: reason ?? null,
        }),
      });

      res.json({ data: approved });
    } catch (error) {
      next(error);
    }
  },
);
governanceRouter.post(
  '/approvals/:id/reject',
  requirePermission('AI_GOVERNANCE_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const workspaceId = workspaceContext.workspaceId as string;
      const rawId = req.params.id;
      const approvalId = typeof rawId === 'string' ? rawId : '';
      const approval = await loadGovernanceApproval(workspaceId, approvalId);
      if (!approval) {
        return res.status(404).json({ error: { code: 'APPROVAL_NOT_FOUND', message: 'Approval request was not found' } });
      }
      const requiredRole = (approval.payload as Record<string, unknown> | undefined)?.requiredApproverRole;
      assertApproverRole(requiredRole, workspaceContext.role);

      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      const rejected = await ApprovalService.getInstance().reject(
        approvalId,
        workspaceId,
        workspaceContext.userId,
        reason,
      );

      await createAuditLog({
        action: 'AI_GOVERNANCE_REJECTED',
        userId: new Types.ObjectId(workspaceContext.userId),
        workspaceId: new Types.ObjectId(workspaceId),
        resource: 'AI_OPERATION',
        resourceId: approval.resourceId,
        metadata: AISecurityService.sanitizeMetadata({
          approvalId,
          feature: approval.action,
          reason: reason ?? null,
        }),
      });

      res.json({ data: rejected });
    } catch (error) {
      next(error);
    }
  },
);

router.use('/governance', governanceRouter);