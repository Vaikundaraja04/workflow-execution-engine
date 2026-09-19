import { Router } from 'express';
import { requirePermission, requireMembership, type PermissionResolver, type WorkspaceSource } from '../../api/middleware/requirePermission.js';
import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { AIWorkflowService } from '../../services/aiWorkflowService.js';
import { AIFailureAnalysisService } from '../../services/aiFailureAnalysisService.js';
import { AIOptimizationService } from '../../services/aiOptimizationService.js';
import { AIOperationsAssistantService } from '../../services/aiOperationsAssistantService.js';
import { AIUsageModel } from '../../models/AIUsageModel.js';
import { AIConfigurationModel } from '../../models/AIConfigurationModel.js';
import { createAuditLog } from '../../services/auditService.js';
import type { AuditAction } from '../../models/AuditLogModel.js';

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
      res.json(configWithoutSecret);
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

      const { provider, model, temperature, maxTokens, features, apiKey } = req.body;

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
      if (provider) config.provider = provider;
      if (model) config.model = model;
      if (temperature !== undefined) config.temperature = temperature;
      if (maxTokens !== undefined) config.maxTokens = maxTokens;
      if (features) config.features = features;
      if (apiKey) {
        config.apiKeyEncrypted = apiKey;
      }
      config.updatedBy = new Types.ObjectId(workspaceContext.userId);

      await config.save();

      // Don't return the encrypted API key in the response
      const { apiKeyEncrypted, ...configWithoutSecret } = config.toObject();
      res.json(configWithoutSecret);

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

export default router;