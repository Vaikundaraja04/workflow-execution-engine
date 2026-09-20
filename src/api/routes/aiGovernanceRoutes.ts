import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/requirePermission.js';
import { AIGovernanceService } from '../../services/ai/aiGovernanceService.js';
import { AIModelRouter } from '../../services/ai/aiModelRouter.js';
import { AIGovernanceBudgetModel } from '../../models/AIGovernanceBudgetModel.js';
import { AIModelRouterConfigModel } from '../../models/AIModelRouterConfigModel.js';

const router = Router();
const governanceService = AIGovernanceService.getInstance();
const modelRouter = AIModelRouter.getInstance();

// GET /budget - Get AI governance budget and current usage
router.get(
  '/budget',
  requirePermission('AI_GOVERNANCE_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const budget = await governanceService.getOrCreateBudget(workspaceContext.workspaceId);
      res.json({ data: budget });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /budget - Update AI governance budget limits and thresholds
router.put(
  '/budget',
  requirePermission('AI_GOVERNANCE_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const {
        monthlyTokenLimit,
        monthlyCostLimitUSD,
        alertThreshold,
        throttleThreshold,
        blockThreshold,
        alertEnabled,
        throttleEnabled,
        blockEnabled,
      } = req.body;

      const budget = await governanceService.getOrCreateBudget(workspaceContext.workspaceId);

      if (monthlyTokenLimit !== undefined) budget.monthlyTokenLimit = monthlyTokenLimit;
      if (monthlyCostLimitUSD !== undefined) budget.monthlyCostLimitUSD = monthlyCostLimitUSD;
      if (alertThreshold !== undefined) budget.alertThreshold = alertThreshold;
      if (throttleThreshold !== undefined) budget.throttleThreshold = throttleThreshold;
      if (blockThreshold !== undefined) budget.blockThreshold = blockThreshold;
      if (alertEnabled !== undefined) budget.alertEnabled = alertEnabled;
      if (throttleEnabled !== undefined) budget.throttleEnabled = throttleEnabled;
      if (blockEnabled !== undefined) budget.blockEnabled = blockEnabled;

      await (budget as any).save();

      res.json({ data: budget });
    } catch (err) {
      next(err);
    }
  }
);

// POST /budget/reset - Reset current usage counters
router.post(
  '/budget/reset',
  requirePermission('AI_GOVERNANCE_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      await governanceService.resetMonthlyUsage(workspaceContext.workspaceId);
      const budget = await governanceService.getOrCreateBudget(workspaceContext.workspaceId);
      res.json({ data: budget, message: 'Monthly AI usage counters reset successfully' });
    } catch (err) {
      next(err);
    }
  }
);

// GET /router/config - Get AI model router configuration
router.get(
  '/router/config',
  requirePermission('AI_MODEL_ROUTER_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const config = await modelRouter.getConfig(workspaceContext.workspaceId);
      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /router/config - Update AI model router configuration
router.put(
  '/router/config',
  requirePermission('AI_MODEL_ROUTER_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const {
        providerPriority,
        modelConfigs,
        complexityRules,
        enableFallback,
        enableCostOptimization,
        enableLatencyOptimization,
      } = req.body;

      let config = await AIModelRouterConfigModel.findOne({ workspaceId: workspaceContext.workspaceId });
      if (!config) {
        config = await AIModelRouterConfigModel.create({
          workspaceId: workspaceContext.workspaceId,
          providerPriority: providerPriority || ['openai', 'anthropic', 'mock'],
          modelConfigs: modelConfigs || {},
          complexityRules: complexityRules || {},
          enableFallback: enableFallback ?? true,
          enableCostOptimization: enableCostOptimization ?? true,
          enableLatencyOptimization: enableLatencyOptimization ?? false,
        });
      } else {
        if (providerPriority !== undefined) config.providerPriority = providerPriority;
        if (modelConfigs !== undefined) config.modelConfigs = modelConfigs;
        if (complexityRules !== undefined) config.complexityRules = complexityRules;
        if (enableFallback !== undefined) config.enableFallback = enableFallback;
        if (enableCostOptimization !== undefined) config.enableCostOptimization = enableCostOptimization;
        if (enableLatencyOptimization !== undefined) config.enableLatencyOptimization = enableLatencyOptimization;
        await config.save();
      }

      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  }
);

// POST /router/route - Determine optimal provider and model for prompt
router.post(
  '/router/route',
  requirePermission('AI_MODEL_ROUTER_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const { prompt, feature } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: 'prompt is required' });
      }

      const routeResult = await modelRouter.selectProviderForTask(
        workspaceContext.workspaceId,
        prompt,
        feature || 'workflow_generation'
      );

      res.json({
        data: {
          providerName: routeResult.providerName,
          model: routeResult.model,
          enableFallback: routeResult.config.enableFallback,
          enableCostOptimization: routeResult.config.enableCostOptimization,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /sanitize - Sanitize prompt and redact PII
router.post(
  '/sanitize',
  requirePermission('AI_GOVERNANCE_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'prompt string is required' });
      }

      const hasInjection = AIGovernanceService.detectPromptInjection(prompt);
      const sanitized = AIGovernanceService.sanitizePromptForAI(prompt);
      const redactedPII = AIGovernanceService.redactPII(prompt);

      res.json({
        data: {
          hasInjection,
          sanitized,
          redactedPII,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;