import { Types } from 'mongoose';
import { AIGovernanceBudgetModel, type IAIGovernanceBudget } from '../../models/AIGovernanceBudgetModel.js';
import { AISecurityService } from '../ai/aiSecurityService.js';

export type AIFeatureType = 'workflow_generation' | 'failure_analysis' | 'optimization' | 'template_generation';

export type AIGovernanceBudget = IAIGovernanceBudget;

export class AIGovernanceService {
  private static instance: AIGovernanceService;

  private constructor() {}

  public static getInstance(): AIGovernanceService {
    if (!AIGovernanceService.instance) {
      AIGovernanceService.instance = new AIGovernanceService();
    }
    return AIGovernanceService.instance;
  }

  /**
   * Get or create AI governance budget for a workspace
   */
  async getOrCreateBudget(workspaceId: Types.ObjectId | string): Promise<IAIGovernanceBudget> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;

    let budget = await AIGovernanceBudgetModel.findOne({ workspaceId: wsId });
    if (!budget) {
      budget = await AIGovernanceBudgetModel.create({
        workspaceId: wsId,
        monthlyTokenLimit: 1000000,
        monthlyCostLimitUSD: 100.0,
        currentTokenUsage: 0,
        currentCostUSD: 0.0,
        alertThreshold: 80,
        throttleThreshold: 90,
        blockThreshold: 100,
        alertEnabled: true,
        throttleEnabled: true,
        blockEnabled: true,
        lastResetDate: new Date(),
      });
    }

    return budget;
  }

  /**
   * Update AI usage and check governance thresholds
   */
  async updateUsageAndCheckThresholds(
    workspaceId: Types.ObjectId | string,
    tokensUsed: number,
    costUSD: number,
    _feature: AIFeatureType
  ): Promise<{
    budget: IAIGovernanceBudget;
    alerts: string[];
    actions: ('ALERT' | 'THROTTLE' | 'BLOCK')[];
  }> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const budget = await this.getOrCreateBudget(wsId);

    // Update usage
    budget.currentTokenUsage += tokensUsed;
    budget.currentCostUSD += costUSD;

    // Save updated budget
    await budget.save();

    // Check thresholds
    const alerts: string[] = [];
    const actions: ('ALERT' | 'THROTTLE' | 'BLOCK')[] = [];

    const tokenUsagePercentage = (budget.currentTokenUsage / budget.monthlyTokenLimit) * 100;
    const costUsagePercentage = (budget.currentCostUSD / budget.monthlyCostLimitUSD) * 100;

    // Check alert threshold
    if (
      budget.alertEnabled &&
      (tokenUsagePercentage >= budget.alertThreshold || costUsagePercentage >= budget.alertThreshold)
    ) {
      alerts.push(`AI usage has reached ${Math.max(tokenUsagePercentage, costUsagePercentage).toFixed(1)}% of monthly limit`);
    }

    // Check throttle threshold
    if (
      budget.throttleEnabled &&
      (tokenUsagePercentage >= budget.throttleThreshold || costUsagePercentage >= budget.throttleThreshold)
    ) {
      actions.push('THROTTLE');
      alerts.push(`AI usage has exceeded throttle threshold of ${budget.throttleThreshold}%`);
    }

    // Check block threshold
    if (
      budget.blockEnabled &&
      (tokenUsagePercentage >= budget.blockThreshold || costUsagePercentage >= budget.blockThreshold)
    ) {
      actions.push('BLOCK');
      alerts.push(`AI usage has exceeded block threshold of ${budget.blockThreshold}%`);
    }

    // If no throttle/block but we have alerts, still return ALERT action
    if (alerts.length > 0 && actions.length === 0) {
      actions.push('ALERT');
    }

    return {
      budget,
      alerts,
      actions,
    };
  }

  /**
   * Reset monthly usage (would typically be called via cron job)
   */
  async resetMonthlyUsage(workspaceId: Types.ObjectId | string): Promise<void> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    await AIGovernanceBudgetModel.updateOne(
      { workspaceId: wsId },
      {
        currentTokenUsage: 0,
        currentCostUSD: 0.0,
        lastResetDate: new Date(),
      }
    );
  }

  /**
   * Apply PII redaction to text using AI security service
   */
  static redactPII(text: string): string {
    return AISecurityService.filterSensitiveData(text);
  }

  /**
   * Check if a prompt contains potential injection attempts
   */
  static detectPromptInjection(prompt: string): boolean {
    const injectionPatterns = [
      /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
      /disregard\s+(?:all\s+)?(?:previous|prior|system)\s+prompts?/i,
      /you\s+are\s+now\s+in\s+dan\s+mode/i,
      /bypass\s+(?:all\s+)?safety\s+filters?/i,
      /reveal\s+(?:system\s+prompt|all\s+rules|api\s*key)/i,
    ];

    return injectionPatterns.some(pattern => pattern.test(prompt));
  }

  /**
   * Sanitize prompt by removing injection attempts and PII
   */
  static sanitizePromptForAI(prompt: string): string {
    let sanitized = prompt;

    // Remove injection attempts
    const injectionPatterns = [
      /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/gi,
      /disregard\s+(?:all\s+)?(?:previous|prior|system)\s+prompts?/gi,
      /you\s+are\s+now\s+in\s+dan\s+mode/gi,
      /bypass\s+(?:all\s+)?safety\s+filters?/gi,
      /reveal\s+(?:system\s+prompt|all\s+rules|api\s*key)/gi,
    ];

    for (const pattern of injectionPatterns) {
      sanitized = sanitized.replace(pattern, '[FILTERED_INSTRUCTION]');
    }

    // Filter sensitive data
    sanitized = AISecurityService.filterSensitiveData(sanitized);

    return sanitized.trim();
  }
}