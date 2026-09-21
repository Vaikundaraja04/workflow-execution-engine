import mongoose, { Types } from 'mongoose';
import { WorkflowModel } from '../models/WorkflowModel.js';
import { WorkflowVersionModel } from '../models/WorkflowVersionModel.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { AIUsageModel } from '../models/AIUsageModel.js';
import {
  OPTIMIZATION_PLAN_STATUSES,
  WorkflowOptimizationModel,
  type IWorkflowOptimization,
  type OptimizationChange,
  type OptimizationExpectedImpact,
  type OptimizationPlanStatus,
  type OptimizationRecommendation,
  type OptimizationRiskLevel,
  type OptimizationType,
  type WorkflowDefinitionDiff,
} from '../models/WorkflowOptimizationModel.js';
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from '../types/workflow.js';
import { WorkflowDefinitionSchema } from '../schemas/workflowSchema.js';
import { validateGraph } from '../engine/validateGraph.js';
import { AIProviderFactory } from './ai/AIProviderFactory.js';
import { AIGovernanceGate } from './aiGovernanceGate.js';
import { AISecurityService } from './ai/aiSecurityService.js';
import { AIUsageService } from './aiUsageService.js';
import type { WorkflowOptimizationInput } from './ai/AIProvider.js';
import { PredictiveIntelligenceService } from './predictiveIntelligenceService.js';
import { createAuditLog } from './auditService.js';
import { diffVersions, hashDefinition } from './versionService.js';

const WINDOW_DAYS = 30;
const MAX_EXECUTION_SAMPLE = 200;
const PREMIUM_MODEL_PATTERN = /(gpt-4(?!o-mini)|claude-3-opus|claude-opus)/i;

export interface NodePerformanceStat {
  nodeId: string;
  nodeType: string;
  runs: number;
  failures: number;
  failureRate: number;
  avgDurationMs?: number;
  timeouts: number;
}

export interface WorkflowPerformanceProfile {
  workflowId: string;
  workflowName: string;
  workspaceId: string;
  sampleSize: number;
  windowDays: number;
  durations: { avgMs: number; p50Ms: number; p95Ms: number; p99Ms: number; trend: 'IMPROVING' | 'STABLE' | 'DEGRADING' };
  reliability: { successRate: number; failureRate: number; totalRetries: number; retryFrequency: number; timeoutExecutions: number };
  cost: { totalAiCostUsd: number; estimatedWorkflowAiCostUsd: number; avgCostPerExecutionUsd: number };
  nodes: NodePerformanceStat[];
  analyzedAt: Date;
}

export interface DetectedBottleneck {
  id: string;
  category: Exclude<OptimizationType, 'MIXED'>;
  nodeId?: string;
  description: string;
  evidence: string[];
  severity: OptimizationRiskLevel;
}

export interface WorkflowAnalysisResult {
  workflowId: string;
  workflowName: string;
  performance: WorkflowPerformanceProfile;
  bottlenecks: DetectedBottleneck[];
  analyzedAt: Date;
}

export interface ApplyOptimizationResult {
  applied: boolean;
  plan: IWorkflowOptimization;
  version: { id: string; versionNumber: number; status: string } | null;
  beforeAfter: WorkflowDefinitionDiff | null;
  validationErrors: string[];
}

export class AutonomousOptimizationService {
  private static instance: AutonomousOptimizationService;

  private constructor() {}

  public static getInstance(): AutonomousOptimizationService {
    if (!AutonomousOptimizationService.instance) {
      AutonomousOptimizationService.instance = new AutonomousOptimizationService();
    }
    return AutonomousOptimizationService.instance;
  }
  private percentile(sorted: number[], fraction: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
    return sorted[index] ?? 0;
  }

  private round(value: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  private resolveTrend(recentAvg: number, olderAvg: number): 'IMPROVING' | 'STABLE' | 'DEGRADING' {
    if (olderAvg <= 0 || recentAvg <= 0) return 'STABLE';
    const ratio = recentAvg / olderAvg;
    if (ratio > 1.1) return 'DEGRADING';
    if (ratio < 0.9) return 'IMPROVING';
    return 'STABLE';
  }

  private async loadWorkflow(workflowId: string, workspaceId: string) {
    if (!Types.ObjectId.isValid(workflowId)) throw new Error('INVALID_WORKFLOW_ID');
    const workflow = await WorkflowModel.findOne({
      _id: workflowId,
      workspaceId: new Types.ObjectId(workspaceId),
    });
    if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
    return workflow;
  }
  async analyzeWorkflowPerformance(workflowId: string, workspaceId: string): Promise<WorkflowPerformanceProfile> {
    const wsId = new Types.ObjectId(workspaceId);
    if (!Types.ObjectId.isValid(workflowId)) throw new Error('INVALID_WORKFLOW_ID');
    const workflow = await WorkflowModel.findOne({ _id: workflowId, workspaceId: wsId }).lean();
    if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');

    const executions = await WorkflowExecutionModel.find({ workflowId: workflow._id, workspaceId: wsId })
      .sort({ createdAt: -1 })
      .limit(MAX_EXECUTION_SAMPLE)
      .lean();

    const durations: number[] = [];
    for (const execution of executions) {
      if (execution.startedAt && execution.finishedAt) {
        const ms = new Date(execution.finishedAt).getTime() - new Date(execution.startedAt).getTime();
        if (ms >= 0) durations.push(ms);
      }
    }
    const sorted = [...durations].sort((a, b) => a - b);
    const avgMs = durations.length > 0 ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length) : 0;
    const half = Math.floor(durations.length / 2);
    const recentAvg = half > 0 ? durations.slice(0, half).reduce((sum, d) => sum + d, 0) / half : avgMs;
    const olderAvg = half > 0 ? durations.slice(half).reduce((sum, d) => sum + d, 0) / (durations.length - half) : avgMs;
    const failures = executions.filter((execution) => execution.status === 'FAILED').length;
    const totalRetries = executions.reduce((sum, execution) => sum + (execution.retryCount || 0), 0);
    const retryExecutions = executions.filter((execution) => (execution.retryCount || 0) > 0).length;
    const timeoutExecutions = executions.filter((execution) => {
      const code = execution.error?.code || '';
      const message = execution.error?.message || '';
      return /timeout|timed out/i.test(`${code} ${message}`);
    }).length;

    const nodeTypeById = new Map<string, string>(
      ((workflow.draftDefinition?.nodes || []) as Array<{ id: string; type: string }>).map((node) => [node.id, node.type]),
    );
    const nodeStats = new Map<string, { runs: number; failures: number; totalDurationMs: number; durationSamples: number; timeouts: number }>();
    for (const execution of executions) {
      const stepStatuses = (execution.result?.stepStatuses || {}) as Record<string, string>;
      const history = execution.result?.executionHistory || [];
      const runningSince = new Map<string, number>();
      const isTimeout = /timeout|timed out/i.test(`${execution.error?.code || ''} ${execution.error?.message || ''}`);
      for (const event of history) {
        const timestamp = new Date(event.timestamp).getTime();
        if (event.toStatus === 'RUNNING') {
          runningSince.set(event.nodeId, timestamp);
        } else if (event.toStatus === 'SUCCEEDED' || event.toStatus === 'FAILED') {
          const nodeStartedAt = runningSince.get(event.nodeId);
          if (nodeStartedAt !== undefined) {
            const stat = nodeStats.get(event.nodeId) || { runs: 0, failures: 0, totalDurationMs: 0, durationSamples: 0, timeouts: 0 };
            stat.totalDurationMs += timestamp - nodeStartedAt;
            stat.durationSamples += 1;
            nodeStats.set(event.nodeId, stat);
            runningSince.delete(event.nodeId);
          }
        }
      }
      for (const [nodeId, status] of Object.entries(stepStatuses)) {
        const stat = nodeStats.get(nodeId) || { runs: 0, failures: 0, totalDurationMs: 0, durationSamples: 0, timeouts: 0 };
        stat.runs += 1;
        if (status === 'FAILED') {
          stat.failures += 1;
          if (isTimeout) stat.timeouts += 1;
        }
        nodeStats.set(nodeId, stat);
      }
    }

    const nodes: NodePerformanceStat[] = Array.from(nodeStats.entries())
      .map(([nodeId, stat]) => ({
        nodeId,
        nodeType: nodeTypeById.get(nodeId) || 'unknown',
        runs: stat.runs,
        failures: stat.failures,
        failureRate: stat.runs > 0 ? this.round((stat.failures / stat.runs) * 100) : 0,
        ...(stat.durationSamples > 0 ? { avgDurationMs: Math.round(stat.totalDurationMs / stat.durationSamples) } : {}),
        timeouts: stat.timeouts,
      }))
      .sort((a, b) => b.failureRate - a.failureRate || (b.avgDurationMs || 0) - (a.avgDurationMs || 0));
    const totalExecutions = executions.length;
    const successRate = totalExecutions > 0 ? this.round(((totalExecutions - failures) / totalExecutions) * 100) : 100;
    const failureRate = totalExecutions > 0 ? this.round((failures / totalExecutions) * 100) : 0;

    const hasAgentNodes = ((workflow.draftDefinition?.nodes || []) as Array<{ type: string }>).some((node) => node.type === 'agent');
    const [aiCostAggregate, workspaceExecutionCount] = await Promise.all([
      AIUsageModel.aggregate<{ totalCost: number }>([
        { $match: { workspaceId: wsId } },
        { $group: { _id: null, totalCost: { $sum: '$costEstimate' } } },
      ]),
      WorkflowExecutionModel.countDocuments({ workspaceId: wsId }),
    ]);
    const totalAiCostUsd = this.round(aiCostAggregate[0]?.totalCost || 0);
    const executionShare = workspaceExecutionCount > 0 ? totalExecutions / workspaceExecutionCount : 0;
    const estimatedWorkflowAiCostUsd = hasAgentNodes ? this.round(totalAiCostUsd * executionShare) : 0;

    return {
      workflowId: workflow._id.toString(),
      workflowName: workflow.name,
      workspaceId,
      sampleSize: totalExecutions,
      windowDays: WINDOW_DAYS,
      durations: {
        avgMs,
        p50Ms: Math.round(this.percentile(sorted, 0.5)),
        p95Ms: Math.round(this.percentile(sorted, 0.95)),
        p99Ms: Math.round(this.percentile(sorted, 0.99)),
        trend: this.resolveTrend(recentAvg, olderAvg),
      },
      reliability: {
        successRate,
        failureRate,
        totalRetries,
        retryFrequency: totalExecutions > 0 ? this.round(retryExecutions / totalExecutions) : 0,
        timeoutExecutions,
      },
      cost: {
        totalAiCostUsd,
        estimatedWorkflowAiCostUsd,
        avgCostPerExecutionUsd: totalExecutions > 0 ? this.round(estimatedWorkflowAiCostUsd / totalExecutions, 4) : 0,
      },
      nodes,
      analyzedAt: new Date(),
    };
  }
  /** Detect inefficiencies from a performance profile and workflow definition */
  detectBottlenecksForProfile(profile: WorkflowPerformanceProfile, definition: WorkflowDefinition): DetectedBottleneck[] {
    const bottlenecks: DetectedBottleneck[] = [];
    let counter = 0;
    const nextId = () => `bn_${++counter}`;
    const nodeById = new Map(definition.nodes.map((node) => [node.id, node]));

    const slowThreshold = Math.max(500, profile.durations.p95Ms * 0.4);
    for (const stat of profile.nodes) {
      if (stat.avgDurationMs !== undefined && stat.avgDurationMs > slowThreshold && stat.runs >= 3) {
        bottlenecks.push({
          id: nextId(),
          category: 'PERFORMANCE_OPTIMIZATION',
          nodeId: stat.nodeId,
          description: `Node '${stat.nodeId}' averages ${stat.avgDurationMs}ms per run, above the ${Math.round(slowThreshold)}ms latency budget.`,
          evidence: [`avgDurationMs=${stat.avgDurationMs}`, `p95WorkflowMs=${profile.durations.p95Ms}`],
          severity: stat.avgDurationMs > slowThreshold * 2 ? 'HIGH' : 'MEDIUM',
        });
      }
      if (stat.failureRate >= 20 && stat.failures >= 3) {
        const nodeType = stat.nodeType !== 'unknown' ? stat.nodeType : nodeById.get(stat.nodeId)?.type || 'unknown';
        bottlenecks.push({
          id: nextId(),
          category: 'RELIABILITY_OPTIMIZATION',
          nodeId: stat.nodeId,
          description: `Node '${stat.nodeId}' (${nodeType}) failed ${stat.failures} of ${stat.runs} runs (${stat.failureRate}%).`,
          evidence: [`failures=${stat.failures}`, `runs=${stat.runs}`, `timeouts=${stat.timeouts}`],
          severity: stat.failureRate >= 40 ? 'HIGH' : 'MEDIUM',
        });
      }
    }
    for (const edge of this.findRedundantEdges(definition)) {
      bottlenecks.push({
        id: nextId(),
        category: 'ARCHITECTURE_OPTIMIZATION',
        description: `Edge ${edge.source} -> ${edge.target} is redundant because a longer path already orders the same nodes.`,
        evidence: [`edge=${edge.source}->${edge.target}`],
        severity: 'LOW',
      });
    }

    for (const node of definition.nodes.filter((candidate) => candidate.type === 'condition')) {
      const outgoing = definition.edges.filter((edge) => edge.source === node.id);
      if (outgoing.length > 0 && !outgoing.some((edge) => edge.condition === 'false')) {
        bottlenecks.push({
          id: nextId(),
          category: 'RELIABILITY_OPTIMIZATION',
          nodeId: node.id,
          description: `Condition node '${node.id}' has no false-branch fallback; unmatched payloads skip downstream handling.`,
          evidence: ['missing false-condition edge'],
          severity: 'MEDIUM',
        });
      }
    }

    if (profile.reliability.timeoutExecutions >= 2) {
      bottlenecks.push({
        id: nextId(),
        category: 'PERFORMANCE_OPTIMIZATION',
        description: `${profile.reliability.timeoutExecutions} executions ended in timeout during the analysis window.`,
        evidence: [`timeoutExecutions=${profile.reliability.timeoutExecutions}`],
        severity: 'MEDIUM',
      });
    }

    if (profile.reliability.retryFrequency > 0.25 && profile.reliability.totalRetries > 0) {
      bottlenecks.push({
        id: nextId(),
        category: 'RELIABILITY_OPTIMIZATION',
        description: `Retry activity is elevated: ${profile.reliability.totalRetries} retries across the sampled executions.`,
        evidence: [`retryFrequency=${profile.reliability.retryFrequency}`],
        severity: 'MEDIUM',
      });
    }

    return bottlenecks;
  }

  /** Full optimization analysis: performance profile, bottleneck detection and audit trail. */
  async analyzeWorkflow(workflowId: string, workspaceId: string, userId: string): Promise<WorkflowAnalysisResult> {
    const workflow = await this.loadWorkflow(workflowId, workspaceId);
    const definition = this.toDefinition(workflow.draftDefinition);
    const performance = await this.analyzeWorkflowPerformance(workflowId, workspaceId);
    const bottlenecks = this.detectBottlenecksForProfile(performance, definition);
    const result: WorkflowAnalysisResult = {
      workflowId: performance.workflowId,
      workflowName: performance.workflowName,
      performance,
      bottlenecks,
      analyzedAt: new Date(),
    };
    await createAuditLog({
      action: 'AI_OPTIMIZATION_ANALYSIS_COMPLETED',
      userId,
      workspaceId,
      metadata: {
        workflowId,
        sampleSize: performance.sampleSize,
        windowDays: performance.windowDays,
        bottleneckCount: bottlenecks.length,
        failureRate: performance.reliability.failureRate,
      },
    });
    return result;
  }

  /** Bottleneck detection entry point for a stored workflow. */
  async detectBottlenecks(workflowId: string, workspaceId: string): Promise<DetectedBottleneck[]> {
    const workflow = await this.loadWorkflow(workflowId, workspaceId);
    const definition = this.toDefinition(workflow.draftDefinition);
    const performance = await this.analyzeWorkflowPerformance(workflowId, workspaceId);
    return this.detectBottlenecksForProfile(performance, definition);
  }

  private toDefinition(raw: unknown): WorkflowDefinition {
    const parsed = WorkflowDefinitionSchema.safeParse(raw);
    if (!parsed.success) throw new Error('INVALID_WORKFLOW_SCHEMA');
    return JSON.parse(JSON.stringify(parsed.data)) as WorkflowDefinition;
  }
  /** Edges whose endpoints stay ordered through a longer unconditional path. */
  private findRedundantEdges(definition: WorkflowDefinition): WorkflowEdge[] {
    const redundant: WorkflowEdge[] = [];
    for (const edge of definition.edges) {
      if (edge.condition) continue;
      if (this.reachableWithoutEdge(definition, edge)) redundant.push(edge);
    }
    return redundant;
  }

  private reachableWithoutEdge(definition: WorkflowDefinition, skip: WorkflowEdge): boolean {
    const visited = new Set<string>([skip.source]);
    const stack: string[] = [skip.source];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const edge of definition.edges) {
        if (edge === skip || edge.condition || edge.source !== current) continue;
        if (edge.target === skip.target) return true;
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          stack.push(edge.target);
        }
      }
    }
    return false;
  }
  /** Safe false-branch target for a condition node, or null when none exists. */
  private findFallbackTarget(definition: WorkflowDefinition, conditionId: string): string | null {
    const outgoing = definition.edges.filter((edge) => edge.source === conditionId);
    if (outgoing.some((edge) => edge.condition === 'false')) return null;
    const trueTargets = outgoing.filter((edge) => edge.condition !== 'false').map((edge) => edge.target);
    const reachableFromTrueBranch = new Set<string>(trueTargets);
    const stack: string[] = [...trueTargets];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const edge of definition.edges) {
        if (edge.source !== current || reachableFromTrueBranch.has(edge.target)) continue;
        reachableFromTrueBranch.add(edge.target);
        stack.push(edge.target);
      }
    }
    for (const node of definition.nodes) {
      if (node.type !== 'log' || node.id === conditionId) continue;
      if (reachableFromTrueBranch.has(node.id)) continue;
      if (definition.edges.some((edge) => edge.source === conditionId && edge.target === node.id)) continue;
      if (this.canReach(definition, node.id, conditionId)) continue;
      return node.id;
    }
    return null;
  }

  private canReach(definition: WorkflowDefinition, from: string, to: string): boolean {
    const visited = new Set<string>([from]);
    const stack: string[] = [from];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const edge of definition.edges) {
        if (edge.source !== current) continue;
        if (edge.target === to) return true;
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          stack.push(edge.target);
        }
      }
    }
    return false;
  }
  private parseEdgeEvidence(definition: WorkflowDefinition, evidence: string[]): { source: string; target: string } | null {
    const entry = evidence.find((item) => item.startsWith('edge='));
    if (!entry) return null;
    const [source, target] = entry.slice(5).split('->');
    if (!source || !target) return null;
    const exists = definition.edges.some((edge) => edge.source === source && edge.target === target && !edge.condition);
    return exists ? { source, target } : null;
  }

  private buildRecommendations(
    bottlenecks: DetectedBottleneck[],
    definition: WorkflowDefinition,
    performance: WorkflowPerformanceProfile,
    premiumModel: boolean,
  ): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    let counter = 0;
    const nextId = () => `rec_${++counter}`;
    for (const bottleneck of bottlenecks) {
      if (bottleneck.category === 'ARCHITECTURE_OPTIMIZATION') {
        const edge = this.parseEdgeEvidence(definition, bottleneck.evidence);
        if (edge) {
          recommendations.push({
            id: nextId(),
            type: 'ARCHITECTURE_OPTIMIZATION',
            title: `Remove redundant edge ${edge.source} -> ${edge.target}`,
            description: bottleneck.description,
            expectedImprovement: {
              metric: 'schedulingOverhead',
              value: 5,
              unit: 'percent',
              description: 'Removes a redundant dependency from the scheduling graph.',
            },
            confidence: 90,
            riskLevel: 'LOW',
            requiresApproval: false,
            changes: [{ kind: 'REMOVE_EDGE', edge }],
            evidence: bottleneck.evidence,
          });
          continue;
        }
      }
      if (bottleneck.category === 'RELIABILITY_OPTIMIZATION' && bottleneck.nodeId) {
        const node = definition.nodes.find((candidate) => candidate.id === bottleneck.nodeId);
        const fallbackTarget = node?.type === 'condition' ? this.findFallbackTarget(definition, bottleneck.nodeId) : null;
        if (fallbackTarget) {
          recommendations.push({
            id: nextId(),
            type: 'RELIABILITY_OPTIMIZATION',
            title: `Add false-branch fallback for ${bottleneck.nodeId}`,
            description: `Route unmatched payloads from '${bottleneck.nodeId}' to '${fallbackTarget}' so they are handled instead of skipped.`,
            expectedImprovement: {
              metric: 'unhandledPayloads',
              value: 100,
              unit: 'percent',
              description: 'Unmatched payloads reach a terminal log node instead of being dropped.',
            },
            confidence: 80,
            riskLevel: 'MEDIUM',
            requiresApproval: false,
            changes: [{ kind: 'ADD_EDGE', edge: { source: bottleneck.nodeId, target: fallbackTarget, condition: 'false' } }],
            evidence: bottleneck.evidence,
          });
        } else {
          recommendations.push({
            id: nextId(),
            type: 'RELIABILITY_OPTIMIZATION',
            title: `Tune reliability for ${bottleneck.nodeId}`,
            description: `${bottleneck.description} No safe graph-level fallback applies, so this stays advisory.`,
            expectedImprovement: {
              metric: 'nodeFailureRate',
              value: 25,
              unit: 'percent',
              description: 'Node retry and validation settings tuned by an operator.',
            },
            confidence: 60,
            riskLevel: bottleneck.severity,
            requiresApproval: false,
            changes: [],
            evidence: bottleneck.evidence,
          });
        }
        continue;
      }
      if (bottleneck.category === 'PERFORMANCE_OPTIMIZATION') {
        const isNodeScoped = bottleneck.nodeId !== undefined;
        recommendations.push({
          id: nextId(),
          type: 'PERFORMANCE_OPTIMIZATION',
          title: isNodeScoped ? `Optimize slow node ${bottleneck.nodeId}` : 'Reduce timeout-related executions',
          description: `${bottleneck.description} Advisory: tune node configuration or split work in a follow-up change.`,
          expectedImprovement: {
            metric: isNodeScoped ? 'nodeLatency' : 'timeoutRate',
            value: isNodeScoped ? 25 : 30,
            unit: 'percent',
            description: isNodeScoped
              ? 'Parallelizing, caching or trimming the slow node payload.'
              : 'Tightening execution budgets removes timeout-driven retries.',
          },
          confidence: isNodeScoped ? 70 : 65,
          riskLevel: bottleneck.severity,
          requiresApproval: false,
          changes: [],
          evidence: bottleneck.evidence,
        });
        continue;
      }      recommendations.push({
        id: nextId(),
        type: bottleneck.category,
        title: `Review ${bottleneck.category.replace(/_/g, ' ').toLowerCase()}`,
        description: bottleneck.description,
        expectedImprovement: {
          metric: 'operationalRisk',
          value: 10,
          unit: 'percent',
          description: 'Targeted follow-up reduces operational risk.',
        },
        confidence: 55,
        riskLevel: bottleneck.severity,
        requiresApproval: false,
        changes: [],
        evidence: bottleneck.evidence,
      });
    }
    if (performance.cost.estimatedWorkflowAiCostUsd > 0 || premiumModel) {
      recommendations.push({
        id: nextId(),
        type: 'COST_OPTIMIZATION',
        title: 'Review agent AI spend',
        description: premiumModel
          ? 'A premium model tier is configured for this workspace. Agent nodes dominate execution cost; consider a cost-efficient tier for high-volume nodes.'
          : `Estimated AI spend for this workflow is $${performance.cost.estimatedWorkflowAiCostUsd} over the analysis window. Batch prompts or cache repeated lookups.`,
        expectedImprovement: {
          metric: 'aiCostPerExecution',
          value: 20,
          unit: 'percent',
          description: 'Model tier and prompt batching adjustments.',
        },
        confidence: 55,
        riskLevel: 'LOW',
        requiresApproval: false,
        changes: [],
        evidence: [
          `estimatedWorkflowAiCostUsd=${performance.cost.estimatedWorkflowAiCostUsd}`,
          `premiumModel=${premiumModel}`,
        ],
      });
    }
    return recommendations;
  }
  private maxRisk(levels: OptimizationRiskLevel[]): OptimizationRiskLevel {
    const rank: Record<OptimizationRiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
    let highest: OptimizationRiskLevel = 'LOW';
    for (const level of levels) {
      if (rank[level] > rank[highest]) highest = level;
    }
    return highest;
  }

  private calculatePlanConfidence(performance: WorkflowPerformanceProfile, recommendationCount: number): number {
    const sampleFactor = Math.min(performance.sampleSize / 50, 1);
    const evidenceFactor = Math.min(recommendationCount / 5, 1);
    const trendFactor = performance.durations.trend === 'STABLE' ? 0.15 : performance.durations.trend === 'IMPROVING' ? 0.1 : 0.05;
    return Math.round((sampleFactor * 0.6 + evidenceFactor * 0.25 + trendFactor) * 100);
  }

  private summarizeImpact(recommendations: OptimizationRecommendation[]): OptimizationExpectedImpact {
    const reduce = (predicate: (recommendation: OptimizationRecommendation) => boolean): number => {
      let total = 0;
      for (const recommendation of recommendations) {
        if (predicate(recommendation) && recommendation.expectedImprovement.unit === 'percent') {
          total += recommendation.expectedImprovement.value;
        }
      }
      return Math.min(60, Math.round(total));
    };
    const actionable = recommendations.filter((item) => item.changes.length > 0).length;
    const summary = recommendations.length === 0
      ? 'No optimization opportunities detected in the analysis window.'
      : `${recommendations.length} recommendation(s) generated; ${actionable} carry validated graph changes.`;
    const impact: OptimizationExpectedImpact = { summary };
    const latencyReductionPercent = reduce((item) => item.type === 'PERFORMANCE_OPTIMIZATION');
    const costReductionPercent = reduce((item) => item.type === 'COST_OPTIMIZATION');
    const reliabilityGainPercent = reduce((item) => item.type === 'RELIABILITY_OPTIMIZATION');
    if (latencyReductionPercent > 0) impact.latencyReductionPercent = latencyReductionPercent;
    if (costReductionPercent > 0) impact.costReductionPercent = costReductionPercent;
    if (reliabilityGainPercent > 0) impact.reliabilityGainPercent = reliabilityGainPercent;
    return impact;
  }
  private dominantType(recommendations: OptimizationRecommendation[]): OptimizationType {
    if (recommendations.length === 0) return 'MIXED';
    const counts = new Map<OptimizationType, number>();
    for (const recommendation of recommendations) {
      counts.set(recommendation.type, (counts.get(recommendation.type) ?? 0) + 1);
    }
    let top: OptimizationType = 'MIXED';
    let topCount = 0;
    for (const [type, count] of counts) {
      if (count > topCount) {
        top = type;
        topCount = count;
      }
    }
    return topCount === recommendations.length ? top : 'MIXED';
  }

  private buildBaselineRecommendation(analysis: WorkflowAnalysisResult): OptimizationRecommendation {
    return {
      id: 'rec_baseline',
      type: 'PERFORMANCE_OPTIMIZATION',
      title: 'No bottlenecks detected',
      description: `No optimization opportunities were detected across ${analysis.performance.sampleSize} sampled executions. The workflow operates within the current latency, reliability and cost budgets.`,
      expectedImprovement: {
        metric: 'stability',
        value: 0,
        unit: 'percent',
        description: 'Continue monitoring; no changes recommended.',
      },
      confidence: this.calculatePlanConfidence(analysis.performance, 0),
      riskLevel: 'LOW',
      requiresApproval: false,
      changes: [],
      evidence: [`sampleSize=${analysis.performance.sampleSize}`, `trend=${analysis.performance.durations.trend}`],
    };
  }
  private async buildAiExplanation(
    workspaceId: string,
    userId: string,
    analysis: WorkflowAnalysisResult,
    definition: WorkflowDefinition,
  ): Promise<{ explanation?: string; providerName: string; model: string; premium: boolean }> {
    try {
      const { provider, model, providerName } = await AIProviderFactory.getProviderForWorkspace(workspaceId, 'optimization');
      const governance = await AIGovernanceGate.getInstance().authorize({
        workspaceId,
        userId,
        feature: 'AI_OPTIMIZATION',
        model,
      });
      if (
        governance.decision !== 'ALLOW'
        && governance.decision !== 'ALLOW_REDACTED'
        && governance.decision !== 'THROTTLE'
      ) {
        return { providerName: 'unavailable', model: 'n/a', premium: false };
      }      const slowNodes = analysis.performance.nodes
        .filter((node) => (node.avgDurationMs ?? 0) > 0)
        .slice(0, 5)
        .map((node) => ({ nodeId: node.nodeId, avgDuration: node.avgDurationMs ?? 0 }));
      const frequentFailures = analysis.performance.nodes
        .filter((node) => node.failures > 0)
        .slice(0, 5)
        .map((node) => ({ nodeId: node.nodeId, failureCount: node.failures }));
      const workflowData: WorkflowOptimizationInput = {
        workflowId: analysis.workflowId,
        workflowName: analysis.workflowName,
        definition: {
          nodes: definition.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            config: AISecurityService.sanitizeMetadata(node.config ?? {}),
          })),
          edges: definition.edges.map((edge) => ({
            source: edge.source,
            target: edge.target,
            ...(edge.condition ? { condition: edge.condition } : {}),
          })),
        },
        metrics: {
          averageDuration: analysis.performance.durations.avgMs,
          failureRate: analysis.performance.reliability.failureRate,
          retryCounts: analysis.performance.reliability.totalRetries,
          ...(slowNodes.length > 0 ? { slowNodes } : {}),
          ...(frequentFailures.length > 0 ? { frequentFailures } : {}),
        },
      };      const aiResult = await provider.suggestOptimization(workflowData);
      await AIUsageService.recordUsage({ workspaceId, userId, feature: 'optimization', model });
      const lines = aiResult.recommendations.slice(0, 5).map((recommendation) => {
        const action = recommendation.action ? ` Action: ${recommendation.action}` : '';
        return `${recommendation.title}: ${recommendation.description}${action}`;
      });
      const improved = typeof aiResult.estimatedImprovement === 'number' || typeof aiResult.estimatedImprovement === 'string'
        ? `Estimated improvement: ${aiResult.estimatedImprovement}.`
        : '';
      const summary = [improved, ...lines].filter((line) => line.length > 0).join(' ').slice(0, 4000);
      const result: { explanation?: string; providerName: string; model: string; premium: boolean } = {
        providerName,
        model,
        premium: PREMIUM_MODEL_PATTERN.test(model),
      };
      if (summary.length > 0) result.explanation = summary;
      return result;
    } catch {
      return { providerName: 'unavailable', model: 'n/a', premium: false };
    }
  }
  async generateOptimizationPlan(workflowId: string, workspaceId: string, userId: string): Promise<IWorkflowOptimization> {
    const workflow = await this.loadWorkflow(workflowId, workspaceId);
    const definition = this.toDefinition(workflow.draftDefinition);
    const analysis = await this.analyzeWorkflow(workflowId, workspaceId, userId);

    let predictiveRisk: { riskLevel: 'low' | 'medium' | 'high' | 'critical'; failureProbability: number; confidenceScore: number } | undefined;
    try {
      const prediction = await PredictiveIntelligenceService.getInstance().predictFailureProbability({ workspaceId, workflowId });
      predictiveRisk = {
        riskLevel: prediction.riskLevel,
        failureProbability: prediction.failureProbability,
        confidenceScore: prediction.confidenceScore,
      };
    } catch {
      predictiveRisk = undefined;
    }

    const ai = await this.buildAiExplanation(workspaceId, userId, analysis, definition);
    const recommendations = this.buildRecommendations(analysis.bottlenecks, definition, analysis.performance, ai.premium);
    if (recommendations.length === 0) recommendations.push(this.buildBaselineRecommendation(analysis));

    const actionable = recommendations.filter((recommendation) => recommendation.changes.length > 0);
    const escalatedRisk = predictiveRisk !== undefined
      && (predictiveRisk.riskLevel === 'high' || predictiveRisk.riskLevel === 'critical');
    const riskLevel = this.maxRisk([
      ...recommendations.map((recommendation) => recommendation.riskLevel),
      ...(escalatedRisk ? (['HIGH'] as OptimizationRiskLevel[]) : []),
    ]);
    const approvalRequired = actionable.some((recommendation) => recommendation.riskLevel === 'HIGH')
      || (predictiveRisk !== undefined && predictiveRisk.failureProbability >= 60)
      || (ai.premium && actionable.length > 0);
    const confidence = this.calculatePlanConfidence(analysis.performance, recommendations.length);
    const expectedImpact = this.summarizeImpact(recommendations);
    const planType = this.dominantType(recommendations);    const plan = await WorkflowOptimizationModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      workflowId: workflow._id,
      createdBy: new Types.ObjectId(userId),
      type: planType,
      status: 'PENDING',
      recommendations,
      confidence,
      riskLevel,
      expectedImpact,
      approvalRequired,
      analysis: {
        bottleneckCount: analysis.bottlenecks.length,
        actionableCount: actionable.length,
        bottlenecks: analysis.bottlenecks,
        performance: {
          sampleSize: analysis.performance.sampleSize,
          windowDays: analysis.performance.windowDays,
          durations: analysis.performance.durations,
          reliability: analysis.performance.reliability,
          cost: analysis.performance.cost,
        },
        predictiveRisk: predictiveRisk ?? null,
        model: { provider: ai.providerName, name: ai.model, premium: ai.premium },
      },
      ...(ai.explanation !== undefined ? { aiExplanation: ai.explanation } : {}),
    });
    await createAuditLog({
      action: 'AI_OPTIMIZATION_PLAN_CREATED',
      userId,
      workspaceId,
      resource: 'WorkflowOptimization',
      resourceId: plan._id.toString(),
      metadata: {
        workflowId,
        type: planType,
        riskLevel,
        approvalRequired,
        recommendationCount: recommendations.length,
        actionableCount: actionable.length,
        confidence,
        provider: ai.providerName,
        model: ai.model,
        premiumModel: ai.premium,
      },
    });
    return plan;
  }
  async listPlans(workspaceId: string, filters: { status?: string; workflowId?: string } = {}): Promise<IWorkflowOptimization[]> {
    const query: Record<string, unknown> = { workspaceId: new Types.ObjectId(workspaceId) };
    if (filters.status !== undefined) {
      if (!(OPTIMIZATION_PLAN_STATUSES as readonly string[]).includes(filters.status)) throw new Error('INVALID_OPTIMIZATION_STATUS');
      query.status = filters.status;
    }
    if (filters.workflowId !== undefined) {
      if (!Types.ObjectId.isValid(filters.workflowId)) throw new Error('INVALID_WORKFLOW_ID');
      query.workflowId = new Types.ObjectId(filters.workflowId);
    }
    return WorkflowOptimizationModel.find(query).sort({ createdAt: -1 }).limit(200).exec();
  }

  async getPlanById(planId: string, workspaceId: string): Promise<IWorkflowOptimization | null> {
    if (!Types.ObjectId.isValid(planId)) throw new Error('INVALID_OPTIMIZATION_ID');
    return WorkflowOptimizationModel.findOne({ _id: planId, workspaceId: new Types.ObjectId(workspaceId) }).exec();
  }

  private async loadPlan(planId: string, workspaceId: string): Promise<IWorkflowOptimization> {
    const plan = await this.getPlanById(planId, workspaceId);
    if (!plan) throw new Error('OPTIMIZATION_PLAN_NOT_FOUND');
    return plan;
  }

  async approvePlan(planId: string, userId: string, workspaceId: string, note?: string): Promise<IWorkflowOptimization> {
    const plan = await this.loadPlan(planId, workspaceId);
    if (plan.status !== 'PENDING') throw new Error('OPTIMIZATION_PLAN_NOT_PENDING');
    plan.status = 'APPROVED';
    plan.approvedBy = new Types.ObjectId(userId);
    plan.approvedAt = new Date();
    if (note !== undefined) {
      plan.analysis = { ...(plan.analysis ?? {}), approvalNote: AISecurityService.filterSensitiveData(note).slice(0, 500) };
    }
    await plan.save();
    await createAuditLog({
      action: 'AI_OPTIMIZATION_PLAN_APPROVED',
      userId,
      workspaceId,
      resource: 'WorkflowOptimization',
      resourceId: plan._id.toString(),
      metadata: { workflowId: plan.workflowId.toString(), note: note !== undefined ? AISecurityService.filterSensitiveData(note).slice(0, 200) : null },
    });
    return plan;
  }
  async rejectPlan(planId: string, userId: string, workspaceId: string, reason?: string): Promise<IWorkflowOptimization> {
    const plan = await this.loadPlan(planId, workspaceId);
    if (plan.status !== 'PENDING') throw new Error('OPTIMIZATION_PLAN_NOT_PENDING');
    plan.status = 'REJECTED';
    plan.rejectedBy = new Types.ObjectId(userId);
    plan.rejectedAt = new Date();
    if (reason !== undefined) plan.rejectionReason = AISecurityService.filterSensitiveData(reason).slice(0, 500);
    await plan.save();
    await createAuditLog({
      action: 'AI_OPTIMIZATION_PLAN_REJECTED',
      userId,
      workspaceId,
      resource: 'WorkflowOptimization',
      resourceId: plan._id.toString(),
      metadata: { workflowId: plan.workflowId.toString(), reason: reason !== undefined ? AISecurityService.filterSensitiveData(reason).slice(0, 200) : null },
    });
    return plan;
  }
  private applyChangesToDefinition(
    baseline: WorkflowDefinition,
    recommendations: OptimizationRecommendation[],
  ): { definition: WorkflowDefinition; changesApplied: number; skipped: string[] } {
    const definition = JSON.parse(JSON.stringify(baseline)) as WorkflowDefinition;
    const skipped: string[] = [];
    let changesApplied = 0;
    for (const recommendation of recommendations) {
      for (const change of recommendation.changes) {
        if (this.applyChange(definition, change)) {
          changesApplied += 1;
        } else {
          skipped.push(`${recommendation.id}:${change.kind}`);
        }
      }
    }
    return { definition, changesApplied, skipped };
  }

  private applyChange(definition: WorkflowDefinition, change: OptimizationChange): boolean {
    if (change.kind === 'UPDATE_NODE_CONFIG') {
      const node = definition.nodes.find((candidate) => candidate.id === change.nodeId);
      if (!node) return false;
      node.config = { ...(node.config ?? {}), ...change.config };
      return true;
    }
    if (change.kind === 'ADD_NODE') {
      if (definition.nodes.some((node) => node.id === change.node.id)) return false;
      definition.nodes.push({ id: change.node.id, type: change.node.type as WorkflowNode['type'], config: change.node.config });
      return true;
    }
    if (change.kind === 'ADD_EDGE') {
      const exists = definition.edges.some((edge) => edge.source === change.edge.source && edge.target === change.edge.target && (edge.condition ?? null) === (change.edge.condition ?? null));
      if (exists) return false;
      definition.edges.push({
        source: change.edge.source,
        target: change.edge.target,
        ...(change.edge.condition ? { condition: change.edge.condition } : {}),
      });
      return true;
    }
    const index = definition.edges.findIndex((edge) => edge.source === change.edge.source && edge.target === change.edge.target && (edge.condition ?? null) === (change.edge.condition ?? null));
    if (index < 0) return false;
    definition.edges.splice(index, 1);
    return true;
  }
  async applyPlan(planId: string, userId: string, workspaceId: string): Promise<ApplyOptimizationResult> {
    const plan = await this.loadPlan(planId, workspaceId);
    if (plan.status === 'APPLIED') throw new Error('OPTIMIZATION_PLAN_ALREADY_APPLIED');
    if (plan.status === 'REJECTED' || plan.status === 'FAILED') throw new Error('OPTIMIZATION_PLAN_NOT_APPLICABLE');
    if (plan.approvalRequired && plan.status !== 'APPROVED') throw new Error('OPTIMIZATION_PLAN_APPROVAL_REQUIRED');

    const workflow = await this.loadWorkflow(plan.workflowId.toString(), workspaceId);
    const baseline = this.toDefinition(workflow.draftDefinition);
    const applied = this.applyChangesToDefinition(baseline, plan.recommendations);
    if (applied.changesApplied === 0) throw new Error('OPTIMIZATION_NO_APPLICABLE_CHANGES');

    const validationErrors: string[] = [];
    let candidate: WorkflowDefinition | null = null;
    const schemaResult = WorkflowDefinitionSchema.safeParse(applied.definition);
    if (!schemaResult.success) {
      for (const issue of schemaResult.error.issues) {
        validationErrors.push(`${issue.path.join('.')}: ${issue.message}`);
      }
    } else {
      const graphErrors = validateGraph(schemaResult.data as WorkflowDefinition);
      if (graphErrors.length > 0) {
        for (const error of graphErrors) validationErrors.push(error.message);
      } else {
        candidate = JSON.parse(JSON.stringify(schemaResult.data)) as WorkflowDefinition;
      }
    }
    if (!candidate) {
      plan.status = 'FAILED';
      plan.failureReason = validationErrors.slice(0, 5).join('; ').slice(0, 500);
      await plan.save();
      await createAuditLog({
        action: 'AI_OPTIMIZATION_PLAN_FAILED',
        userId,
        workspaceId,
        resource: 'WorkflowOptimization',
        resourceId: plan._id.toString(),
        metadata: { workflowId: plan.workflowId.toString(), validationErrors: validationErrors.slice(0, 5) },
      });
      return { applied: false, plan, version: null, beforeAfter: null, validationErrors };
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const nextVersionNumber = workflow.latestVersionNumber + 1;
      const [createdVersion] = await WorkflowVersionModel.create([{
        workflowId: workflow._id,
        ...(workflow.workspaceId ? { workspaceId: workflow.workspaceId } : {}),
        versionNumber: nextVersionNumber,
        definition: JSON.parse(JSON.stringify(candidate)),
        definitionHash: hashDefinition(candidate),
        createdBy: new Types.ObjectId(userId),
        ...(workflow.publishedVersionId ? { sourceVersionId: workflow.publishedVersionId } : {}),
        changeSummary: `Autonomous optimization plan ${plan._id.toString()}`.slice(0, 280),
        status: 'DRAFT',
      }], { session });
      if (!createdVersion) throw new Error('VERSION_CONFLICT');
      workflow.draftDefinition = JSON.parse(JSON.stringify(candidate)) as WorkflowDefinition;
      workflow.status = 'DRAFT';
      workflow.latestVersionNumber = nextVersionNumber;
      await workflow.save({ session });

      const beforeAfter = diffVersions(
        {
          _id: workflow.publishedVersionId ?? new Types.ObjectId(),
          workflowId: workflow._id,
          versionNumber: nextVersionNumber - 1,
          definition: baseline,
          createdAt: new Date(),
        },
        {
          _id: createdVersion._id,
          workflowId: workflow._id,
          versionNumber: nextVersionNumber,
          definition: createdVersion.definition,
          createdAt: createdVersion.createdAt,
        },
      );

      plan.status = 'APPLIED';
      plan.appliedBy = new Types.ObjectId(userId);
      plan.appliedAt = new Date();
      plan.appliedVersionId = createdVersion._id;
      plan.appliedVersionNumber = nextVersionNumber;
      plan.beforeAfter = beforeAfter;
      await plan.save({ session });

      await session.commitTransaction();
      await createAuditLog({
        action: 'AI_OPTIMIZATION_PLAN_APPLIED',
        userId,
        workspaceId,
        resource: 'WorkflowOptimization',
        resourceId: plan._id.toString(),
        metadata: {
          workflowId: plan.workflowId.toString(),
          versionNumber: nextVersionNumber,
          versionStatus: 'DRAFT',
          changesApplied: applied.changesApplied,
          skippedChanges: applied.skipped,
        },
      });
      return {
        applied: true,
        plan,
        version: { id: createdVersion._id.toString(), versionNumber: nextVersionNumber, status: 'DRAFT' },
        beforeAfter,
        validationErrors: [],
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}