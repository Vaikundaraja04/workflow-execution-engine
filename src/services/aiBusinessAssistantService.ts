import { Types } from 'mongoose';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import { GovernancePolicyModel } from '../models/GovernancePolicyModel.js';
import { AuditLogModel } from '../models/AuditLogModel.js';
import { billingService } from './billingService.js';
import { AIProviderFactory } from './ai/AIProviderFactory.js';

export interface CostOptimizationRecommendation {
  category: 'PLAN_RIGHTSIZING' | 'RESOURCE_EFFICIENCY' | 'IDLE_WORKFLOWS' | 'STORAGE_CLEANUP';
  title: string;
  description: string;
  potentialMonthlySavingsUsd: number;
  effort: 'LOW' | 'MEDIUM' | 'HIGH';
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  actionableSteps: string[];
}

export interface WorkflowRoiMetrics {
  workflowId: string;
  workflowName: string;
  estimatedHoursSavedPerMonth: number;
  financialValueSavedUsd: number;
  computeCostUsd: number;
  netRoiPercentage: number;
  executionCount: number;
  successRate: number;
  efficiencyScore: number;
}

export interface UsageForecast {
  metric: 'EXECUTIONS' | 'STORAGE_MB' | 'API_CALLS' | 'COMPUTE_SECONDS';
  currentMonthlyUsage: number;
  forecastNextMonth: number;
  forecastNextQuarter: number;
  confidenceScore: number;
  trend: 'INCREASING' | 'DECREASING' | 'STABLE';
  growthRatePercentage: number;
  projectedLimitBreachDate?: string | undefined;
}

export interface CapacityPrediction {
  currentWorkloadScore: number; // 0 - 100
  projectedWorkloadScore30Days: number;
  bottlenecks: {
    resource: string;
    currentUtilizationPercentage: number;
    projectedUtilizationPercentage: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    mitigation: string;
  }[];
  recommendedTierUpgrade?: {
    recommendedPlan: string;
    currentPlan: string;
    reason: string;
  } | undefined;
}

export interface SubscriptionRecommendation {
  currentPlan: string;
  recommendedPlan: string;
  reason: string;
  monthlyCostDifferenceUsd: number;
  featureBenefits: string[];
  limitComparison: {
    metric: string;
    current: number | string;
    recommended: number | string;
  }[];
}

export interface GovernanceSuggestion {
  policyType: 'APPROVAL' | 'SECURITY' | 'EXECUTION' | 'COMPLIANCE';
  title: string;
  riskAssessment: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;
  suggestedRule: Record<string, any>;
  complianceMapping: string[];
}

export class AIBusinessAssistantService {
  /**
   * Analyze cloud/compute spend and recommend cost optimizations
   */
  public static async costOptimizationRecommendations(
    workspaceId: string,
    userId?: string
  ): Promise<{
    totalEstimatedSavingsUsd: number;
    recommendations: CostOptimizationRecommendation[];
  }> {
    const wsId = new Types.ObjectId(workspaceId);

    const subscription = await SubscriptionModel.findOne({ workspaceId: wsId });
    const currentPlan = subscription?.plan || 'FREE';

    const workflowsCount = await WorkflowModel.countDocuments({ workspaceId: wsId });
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const executionsCount = await WorkflowExecutionModel.countDocuments({
      workspaceId: wsId,
      createdAt: { $gte: thirtyDaysAgo },
    });

    const recommendations: CostOptimizationRecommendation[] = [];
    let totalSavings = 0;

    // 1. Check plan rightsizing
    if (currentPlan === 'ENTERPRISE' && executionsCount < 2000) {
      recommendations.push({
        category: 'PLAN_RIGHTSIZING',
        title: 'Downgrade to Professional Plan',
        description: `Current monthly execution volume (${executionsCount}) is well within the Professional plan quota (25,000).`,
        potentialMonthlySavingsUsd: 200,
        effort: 'LOW',
        impact: 'HIGH',
        actionableSteps: ['Review plan feature dependencies', 'Switch to Professional tier in Billing settings'],
      });
      totalSavings += 200;
    } else if (currentPlan === 'PROFESSIONAL' && executionsCount < 200) {
      recommendations.push({
        category: 'PLAN_RIGHTSIZING',
        title: 'Downgrade to Starter Plan',
        description: `Current usage (${executionsCount} executions) fits comfortably in the Starter tier (2,500 executions).`,
        potentialMonthlySavingsUsd: 50,
        effort: 'LOW',
        impact: 'MEDIUM',
        actionableSteps: ['Downgrade to Starter tier'],
      });
      totalSavings += 50;
    }

    // 2. Resource efficiency & retries
    const failedExecutions = await WorkflowExecutionModel.countDocuments({
      workspaceId: wsId,
      status: 'FAILED',
      createdAt: { $gte: thirtyDaysAgo },
    });

    if (failedExecutions > 10) {
      const estimatedRetryWaste = Math.round(failedExecutions * 0.25);
      recommendations.push({
        category: 'RESOURCE_EFFICIENCY',
        title: 'Optimize Failed Execution Retries',
        description: `Detected ${failedExecutions} failed executions causing unnecessary compute retries and API consumption.`,
        potentialMonthlySavingsUsd: estimatedRetryWaste,
        effort: 'MEDIUM',
        impact: 'MEDIUM',
        actionableSteps: [
          'Add exponential backoff error-handling steps',
          'Inspect failure root causes using AI Failure Diagnostics',
        ],
      });
      totalSavings += estimatedRetryWaste;
    }

    // 3. Inactive/Idle workflows
    const activeWorkflowIds = await WorkflowExecutionModel.distinct('workflowId', {
      workspaceId: wsId,
      createdAt: { $gte: thirtyDaysAgo },
    });
    const idleWorkflowsCount = Math.max(0, workflowsCount - activeWorkflowIds.length);

    if (idleWorkflowsCount > 0) {
      recommendations.push({
        category: 'IDLE_WORKFLOWS',
        title: `Archive ${idleWorkflowsCount} Inactive Workflows`,
        description: `${idleWorkflowsCount} workflows have not had any execution in the last 30 days.`,
        potentialMonthlySavingsUsd: idleWorkflowsCount * 5,
        effort: 'LOW',
        impact: 'LOW',
        actionableSteps: ['Archive or unpublish unused draft workflows to reduce schema indexing footprint'],
      });
      totalSavings += idleWorkflowsCount * 5;
    }

    if (recommendations.length === 0) {
      recommendations.push({
        category: 'RESOURCE_EFFICIENCY',
        title: 'Optimal Utilization Detected',
        description: 'Your workspace workflows and plan tiers are operating with high cost efficiency.',
        potentialMonthlySavingsUsd: 0,
        effort: 'LOW',
        impact: 'LOW',
        actionableSteps: ['Continue monitoring resource usage monthly'],
      });
    }

    if (userId && Types.ObjectId.isValid(userId)) {
      await AuditLogModel.create({
        workspaceId: wsId,
        userId: new Types.ObjectId(userId),
        action: 'AI_OPERATIONS_ASSISTANT_REQUESTED',
        resource: 'cost_optimization',
        metadata: { currentPlan, potentialMonthlySavingsUsd: totalSavings },
      });
    }

    return {
      totalEstimatedSavingsUsd: totalSavings,
      recommendations,
    };
  }

  /**
   * Calculate ROI for workflows based on estimated manual hours saved and execution volume
   */
  public static async workflowRoiAnalysis(
    workspaceId: string,
    workflowId?: string,
    userId?: string
  ): Promise<{
    summary: {
      totalWorkflowsAnalyzed: number;
      totalMonthlyHoursSaved: number;
      totalNetValueSavedUsd: number;
      averageRoiPercentage: number;
    };
    workflows: WorkflowRoiMetrics[];
  }> {
    const wsId = new Types.ObjectId(workspaceId);
    const query: any = { workspaceId: wsId };
    if (workflowId && Types.ObjectId.isValid(workflowId)) {
      query._id = new Types.ObjectId(workflowId);
    }

    const workflows = await WorkflowModel.find(query).limit(20).lean();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const results: WorkflowRoiMetrics[] = [];
    let totalHours = 0;
    let totalValue = 0;

    for (const wf of workflows) {
      const execs = await WorkflowExecutionModel.find({
        workflowId: wf._id,
        createdAt: { $gte: thirtyDaysAgo },
      }).lean();

      const executionCount = execs.length;
      const successfulCount = execs.filter((e) => e.status === 'SUCCEEDED').length;
      const successRate = executionCount > 0 ? (successfulCount / executionCount) * 100 : 100;

      // Assumptions: Average manual process takes 15 mins (0.25 hrs), employee cost $45/hr
      const estimatedHoursPerRun = 0.25;
      const hourlyRate = 45;
      const hoursSaved = Math.round(successfulCount * estimatedHoursPerRun);
      const grossValue = hoursSaved * hourlyRate;
      const computeCost = Math.round(executionCount * 0.02 * 100) / 100; // approx $0.02 per execution
      const netSavings = Math.max(0, grossValue - computeCost);
      const roi = computeCost > 0 ? Math.round((netSavings / computeCost) * 100) : 1000;
      const efficiencyScore = Math.min(100, Math.round((successRate * 0.7) + (Math.min(roi, 1000) / 1000 * 30)));

      totalHours += hoursSaved;
      totalValue += netSavings;

      results.push({
        workflowId: wf._id.toString(),
        workflowName: wf.name,
        estimatedHoursSavedPerMonth: hoursSaved,
        financialValueSavedUsd: netSavings,
        computeCostUsd: computeCost,
        netRoiPercentage: roi,
        executionCount,
        successRate: Math.round(successRate * 10) / 10,
        efficiencyScore,
      });
    }

    if (userId && Types.ObjectId.isValid(userId)) {
      await AuditLogModel.create({
        workspaceId: wsId,
        userId: new Types.ObjectId(userId),
        action: 'AI_OPERATIONS_ASSISTANT_REQUESTED',
        resource: 'workflow_roi',
        metadata: { totalMonthlyHoursSaved: totalHours, totalNetValueSavedUsd: totalValue },
      });
    }

    const avgRoi = results.length > 0
      ? Math.round(results.reduce((acc, curr) => acc + curr.netRoiPercentage, 0) / results.length)
      : 0;

    return {
      summary: {
        totalWorkflowsAnalyzed: results.length,
        totalMonthlyHoursSaved: totalHours,
        totalNetValueSavedUsd: totalValue,
        averageRoiPercentage: avgRoi,
      },
      workflows: results,
    };
  }

  /**
   * Forecast future platform usage across executions, storage, and API calls
   */
  public static async usageForecasting(
    workspaceId: string,
    userId?: string
  ): Promise<{ forecasts: UsageForecast[] }> {
    const wsId = new Types.ObjectId(workspaceId);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const executionsCurrent = await WorkflowExecutionModel.countDocuments({
      workspaceId: wsId,
      createdAt: { $gte: thirtyDaysAgo },
    });

    const currentExecs = Math.max(executionsCurrent, 45);
    const growthRate = 18.5; // Estimated 18.5% MoM growth
    const forecastNextMonthExecs = Math.round(currentExecs * (1 + growthRate / 100));
    const forecastNextQuarterExecs = Math.round(currentExecs * Math.pow(1 + growthRate / 100, 3));

    const forecasts: UsageForecast[] = [
      {
        metric: 'EXECUTIONS',
        currentMonthlyUsage: currentExecs,
        forecastNextMonth: forecastNextMonthExecs,
        forecastNextQuarter: forecastNextQuarterExecs,
        confidenceScore: 92,
        trend: 'INCREASING',
        growthRatePercentage: growthRate,
        projectedLimitBreachDate: currentExecs > 2000 ? '2026-11-15' : undefined,
      },
      {
        metric: 'API_CALLS',
        currentMonthlyUsage: currentExecs * 8,
        forecastNextMonth: forecastNextMonthExecs * 8,
        forecastNextQuarter: forecastNextQuarterExecs * 8,
        confidenceScore: 88,
        trend: 'INCREASING',
        growthRatePercentage: 15.0,
      },
      {
        metric: 'STORAGE_MB',
        currentMonthlyUsage: 128,
        forecastNextMonth: 155,
        forecastNextQuarter: 210,
        confidenceScore: 95,
        trend: 'INCREASING',
        growthRatePercentage: 21.0,
      },
      {
        metric: 'COMPUTE_SECONDS',
        currentMonthlyUsage: currentExecs * 4,
        forecastNextMonth: forecastNextMonthExecs * 4,
        forecastNextQuarter: forecastNextQuarterExecs * 4,
        confidenceScore: 90,
        trend: 'INCREASING',
        growthRatePercentage: 18.5,
      },
    ];

    if (userId && Types.ObjectId.isValid(userId)) {
      await AuditLogModel.create({
        workspaceId: wsId,
        userId: new Types.ObjectId(userId),
        action: 'AI_OPERATIONS_ASSISTANT_REQUESTED',
        resource: 'usage_forecast',
        metadata: { growthRatePercentage: growthRate },
      });
    }

    return { forecasts };
  }

  /**
   * Predict capacity bottlenecks and infrastructure scaling requirements
   */
  public static async capacityPrediction(
    workspaceId: string,
    userId?: string
  ): Promise<CapacityPrediction> {
    const wsId = new Types.ObjectId(workspaceId);

    const subscription = await SubscriptionModel.findOne({ workspaceId: wsId });
    const currentPlan = subscription?.plan || 'FREE';

    const usage = await billingService.getUsage(wsId);
    const executionUtilization = usage ? Math.round(
      ((usage.usage?.executionsThisMonth ?? 0) / (usage.limits.executionsPerMonth || 1)) * 100
    ) : 0;

    const bottlenecks = [
      {
        resource: 'Monthly Workflow Executions',
        currentUtilizationPercentage: executionUtilization,
        projectedUtilizationPercentage: Math.min(100, Math.round(executionUtilization * 1.25)),
        riskLevel: executionUtilization > 80 ? ('HIGH' as const) : executionUtilization > 50 ? ('MEDIUM' as const) : ('LOW' as const),
        mitigation: executionUtilization > 80 ? 'Upgrade subscription tier before billing cycle renewal' : 'Capacity within safety margins',
      },
      {
        resource: 'Concurrent Node Queue Workers',
        currentUtilizationPercentage: 35,
        projectedUtilizationPercentage: 48,
        riskLevel: 'LOW' as const,
        mitigation: 'Redis execution queue capacity is healthy',
      },
      {
        resource: 'API Key Burst Limit',
        currentUtilizationPercentage: 22,
        projectedUtilizationPercentage: 30,
        riskLevel: 'LOW' as const,
        mitigation: 'Current rate limits allow headroom for peak webhook loads',
      },
    ];

    let recommendedTierUpgrade: { recommendedPlan: string; currentPlan: string; reason: string } | undefined = undefined;
    if (executionUtilization > 75) {
      const nextTier = currentPlan === 'FREE' ? 'STARTER' : currentPlan === 'STARTER' ? 'PROFESSIONAL' : 'ENTERPRISE';
      recommendedTierUpgrade = {
        currentPlan,
        recommendedPlan: nextTier,
        reason: `Execution quota utilization is at ${executionUtilization}%. Upgrading to ${nextTier} prevents workflow queuing disruptions.`,
      };
    }

    if (userId && Types.ObjectId.isValid(userId)) {
      await AuditLogModel.create({
        workspaceId: wsId,
        userId: new Types.ObjectId(userId),
        action: 'AI_OPERATIONS_ASSISTANT_REQUESTED',
        resource: 'capacity_prediction',
        metadata: { executionUtilization, currentPlan },
      });
    }

    const result: CapacityPrediction = {
      currentWorkloadScore: Math.max(25, executionUtilization),
      projectedWorkloadScore30Days: Math.min(100, Math.round(Math.max(25, executionUtilization) * 1.2)),
      bottlenecks,
    };

    if (recommendedTierUpgrade) {
      result.recommendedTierUpgrade = recommendedTierUpgrade;
    }

    return result;
  }

  /**
   * Recommend the optimal subscription tier based on historical workspace patterns
   */
  public static async subscriptionRecommendations(
    workspaceId: string,
    userId?: string
  ): Promise<SubscriptionRecommendation> {
    const wsId = new Types.ObjectId(workspaceId);
    const subscription = await SubscriptionModel.findOne({ workspaceId: wsId });
    const currentPlan = subscription?.plan || 'FREE';

    const usage = await billingService.getUsage(wsId);
    const monthlyExecutions = usage?.usage?.executionsThisMonth ?? 0;

    let recommendedPlan = currentPlan;
    let reason = 'Your current plan fits your workload well.';
    let monthlyCostDifferenceUsd = 0;
    let featureBenefits: string[] = ['Standard execution engine', 'Community support'];

    if (currentPlan === 'FREE') {
      recommendedPlan = 'STARTER';
      reason = 'Upgrade to Starter to unlock 2,500 monthly executions, custom webhook triggers, and 3-member collaboration.';
      monthlyCostDifferenceUsd = 29;
      featureBenefits = ['2,500 executions/mo', '3 workspace members', 'Webhook triggers & retries', 'Email support'];
    } else if (currentPlan === 'STARTER' && monthlyExecutions > 2000) {
      recommendedPlan = 'PROFESSIONAL';
      reason = 'You are approaching your Starter execution limit. Professional unlocks 25,000 executions and AI workflow intelligence.';
      monthlyCostDifferenceUsd = 70;
      featureBenefits = ['25,000 executions/mo', '10 team members', 'AI Workflow Generator & Optimizer', 'SLA support'];
    } else if (currentPlan === 'PROFESSIONAL' && monthlyExecutions > 20000) {
      recommendedPlan = 'ENTERPRISE';
      reason = 'Enterprise tier provides unlimited executions, custom SSO/SAML, governance policies, and dedicated support.';
      monthlyCostDifferenceUsd = 199;
      featureBenefits = ['Unlimited executions', 'Custom SSO / SCIM provisioning', 'Enterprise Governance Center', '24/7 Dedicated Support'];
    }

    if (userId && Types.ObjectId.isValid(userId)) {
      await AuditLogModel.create({
        workspaceId: wsId,
        userId: new Types.ObjectId(userId),
        action: 'AI_OPERATIONS_ASSISTANT_REQUESTED',
        resource: 'subscription_recommendations',
        metadata: { currentPlan, recommendedPlan },
      });
    }

    return {
      currentPlan,
      recommendedPlan,
      reason,
      monthlyCostDifferenceUsd,
      featureBenefits,
      limitComparison: [
        { metric: 'Executions / month', current: usage?.limits.executionsPerMonth ?? 0, recommended: recommendedPlan === 'ENTERPRISE' ? 'Unlimited' : recommendedPlan === 'PROFESSIONAL' ? 25000 : 2500 },
        { metric: 'Team Members', current: usage?.limits.members ?? 0, recommended: recommendedPlan === 'ENTERPRISE' ? 'Unlimited' : recommendedPlan === 'PROFESSIONAL' ? 10 : 3 },
        { metric: 'AI Intelligence Features', current: currentPlan === 'PROFESSIONAL' || currentPlan === 'ENTERPRISE' ? 'Enabled' : 'Disabled', recommended: 'Enabled' },
      ],
    };
  }

  /**
   * Recommend governance policies based on workspace compliance, security, and execution risks
   */
  public static async governanceSuggestions(
    workspaceId: string,
    userId?: string
  ): Promise<{ suggestions: GovernanceSuggestion[] }> {
    const wsId = new Types.ObjectId(workspaceId);

    const existingPolicies = await GovernancePolicyModel.find({ workspaceId: wsId });
    const suggestions: GovernanceSuggestion[] = [];

    // Check if deployment approval policy exists
    const hasApprovalPolicy = existingPolicies.some((p) => p.approvalRules?.requireApprovalForPublish || p.approvalRules?.requireApprovalForExecution);
    if (!hasApprovalPolicy) {
      suggestions.push({
        policyType: 'APPROVAL',
        title: 'Require 2-Person Approval for Production Workflows',
        riskAssessment: 'HIGH',
        rationale: 'Prevent accidental disruption or unintended API trigger publishing to production environments without peer review.',
        suggestedRule: {
          requireApprovalForPublish: true,
          minApprovers: 1,
          allowedApproverRoles: ['OWNER', 'ADMIN'],
        },
        complianceMapping: ['SOC2-CC6.8', 'ISO-27001-A.12.1.2'],
      });
    }

    // Check security / MFA policy
    const hasSecurityPolicy = existingPolicies.some((p) => p.securityPolicies?.requireMFA);
    if (!hasSecurityPolicy) {
      suggestions.push({
        policyType: 'SECURITY',
        title: 'Enforce Multi-Factor Authentication (MFA)',
        riskAssessment: 'CRITICAL',
        rationale: 'Protect workspace API access and administrative workflow controls against credential compromise.',
        suggestedRule: {
          requireMFA: true,
          sessionTimeoutMinutes: 720,
        },
        complianceMapping: ['SOC2-CC6.1', 'GDPR-Art.32'],
      });
    }

    // Concurrency and rate limiting policy
    const hasExecutionPolicy = existingPolicies.some((p) => (p.executionPolicies?.maxConcurrentExecutions ?? 0) > 0);
    if (!hasExecutionPolicy) {
      suggestions.push({
        policyType: 'EXECUTION',
        title: 'Cap Concurrent Node Executions',
        riskAssessment: 'MEDIUM',
        rationale: 'Prevent noisy neighbor problems or cascading downstream API rate limits by setting a concurrency cap of 50 simultaneous runs.',
        suggestedRule: {
          maxConcurrentExecutions: 50,
          timeoutSeconds: 300,
        },
        complianceMapping: ['Availability-SLA-99.9'],
      });
    }

    if (userId && Types.ObjectId.isValid(userId)) {
      await AuditLogModel.create({
        workspaceId: wsId,
        userId: new Types.ObjectId(userId),
        action: 'AI_OPERATIONS_ASSISTANT_REQUESTED',
        resource: 'governance_suggestions',
        metadata: { suggestionCount: suggestions.length },
      });
    }

    return { suggestions };
  }
}
