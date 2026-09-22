import type { AuthConfig } from '../auth/jwt.service.js';
import { DemoScenarioModel, isDemoScenarioId } from '../models/DemoScenarioModel.js';
import type { DemoScenarioId, IDemoScenario } from '../models/DemoScenarioModel.js';
import { solutionTemplateService } from './solutionTemplateService.js';
import { demoWorkspaceService } from './demoWorkspaceService.js';
import { growthAnalyticsService } from './growthAnalyticsService.js';
import { conversionTrackingService } from './conversionTrackingService.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 16.3 - Enterprise demo platform.
 *
 * Sells with real content: each scenario names the industry problem, the
 * persona, the talk track and the solution that actually gets installed when
 * the sandbox is started. Workflows, agents, sample runs and the explanation
 * are read from solutionTemplateService - the scenario only frames them.
 */

export interface ScenarioSeed {
  id: DemoScenarioId;
  name: string;
  industry: string;
  solutionId: IDemoScenario['solutionId'];
  headline: string;
  explanation: string;
  talkTrack: string[];
  highlights: Array<{ title: string; detail: string }>;
  persona: string;
  sortOrder: number;
}

export const DEFAULT_DEMO_SCENARIOS: ScenarioSeed[] = [
  {
    id: 'it-helpdesk',
    name: 'IT Helpdesk',
    industry: 'IT Operations',
    solutionId: 'it-helpdesk-automation',
    headline: 'Triage, route and resolve IT tickets with SLA tracking',
    explanation: 'Show how inbound tickets are classified, routed to the right queue and escalated before the SLA breaks - with the audit trail the IT lead needs for reporting.',
    talkTrack: [
      'Start with the ticket webhook and show the classification step',
      'Demonstrate the escalation path when the SLA timer is close to breaking',
      'Open the execution history to show the trail for audit',
    ],
    highlights: [
      { title: 'SLA-aware routing', detail: 'Priority conditions route tickets to the right queue automatically' },
      { title: 'Escalation before breach', detail: 'Timer-based escalation reaches the on-call owner in time' },
    ],
    persona: 'IT service desk lead',
    sortOrder: 1,
  },
  {
    id: 'hr-automation',
    name: 'HR Automation',
    industry: 'People Operations',
    solutionId: 'hr-workflow-automation',
    headline: 'Onboard new hires with a repeatable, auditable checklist',
    explanation: 'Walk through the onboarding flow: the offer is accepted, the checklist fans out to IT, payroll and the hiring manager, and every step is recorded for compliance.',
    talkTrack: [
      'Kick the workflow off with the accepted-offer payload',
      'Show the parallel steps for IT, payroll and the manager',
      'End on the completion record and the compliance export',
    ],
    highlights: [
      { title: 'Parallel onboarding tasks', detail: 'IT, payroll and manager steps run without a spreadsheet' },
      { title: 'Compliance-ready trail', detail: 'Every step is written to the hash-chained audit log' },
    ],
    persona: 'HR operations manager',
    sortOrder: 2,
  },
  {
    id: 'finance-approval',
    name: 'Finance Approval',
    industry: 'Finance & Accounting',
    solutionId: 'finance-approval-automation',
    headline: 'Route invoices and expenses through policy-based approvals',
    explanation: 'Demonstrate the approval matrix: amount thresholds decide the approver, policy violations stop the request and the decision is recorded for the controller.',
    talkTrack: [
      'Submit an invoice below threshold to show the auto-approval path',
      'Submit one above threshold and show the approver notification',
      'Show the policy violation path and the recorded decision',
    ],
    highlights: [
      { title: 'Policy-based approvers', detail: 'Amount thresholds and vendor rules pick the approver' },
      { title: 'Violation handling', detail: 'Out-of-policy requests stop with a recorded reason' },
    ],
    persona: 'Finance controller',
    sortOrder: 3,
  },
  {
    id: 'customer-support',
    name: 'Customer Support',
    industry: 'Technology & Services',
    solutionId: 'customer-support-automation',
    headline: 'Prioritise, respond and escalate customer tickets within SLA',
    explanation: 'Show the support flow end to end: the ticket arrives, priority decides the queue, the first response goes out and enterprise customers escalate straight to the owner.',
    talkTrack: [
      'Send a standard ticket and show the first-response automation',
      'Send an enterprise ticket and show the escalation to the account owner',
      'Open the execution trail to show response times',
    ],
    highlights: [
      { title: 'Priority routing', detail: 'Customer tier and priority decide the handling path' },
      { title: 'First response in minutes', detail: 'Automated acknowledgements and owner paging' },
    ],
    persona: 'Support operations lead',
    sortOrder: 4,
  },
  {
    id: 'sales-automation',
    name: 'Sales Automation',
    industry: 'Revenue Operations',
    solutionId: 'sales-automation',
    headline: 'Qualify, assign and follow up on inbound demand automatically',
    explanation: 'Follow a lead from capture to assignment: scoring decides the owner, the follow-up task is created with a due date and the pipeline is kept clean without manual triage.',
    talkTrack: [
      'Capture a qualified lead and show the scoring result',
      'Show the owner assignment and the follow-up task',
      'Show the pipeline view the sales lead works from',
    ],
    highlights: [
      { title: 'Instant routing', detail: 'Score-based assignment reaches the right owner in seconds' },
      { title: 'No dropped follow-ups', detail: 'Follow-up tasks are created with due dates automatically' },
    ],
    persona: 'Revenue operations manager',
    sortOrder: 5,
  },
];

/** Seed the registry on first use; existing scenarios are never overwritten. */
export async function ensureDefaultDemoScenarios(): Promise<void> {
  const existing = await DemoScenarioModel.find().select('id').lean();
  const present = new Set(existing.map((row) => row.id));
  const missing = DEFAULT_DEMO_SCENARIOS.filter((seed) => !present.has(seed.id));
  if (missing.length === 0) return;
  await DemoScenarioModel.insertMany(missing.map((seed) => ({ ...seed, isActive: true })));
}

export interface DemoScenarioView {
  id: DemoScenarioId;
  name: string;
  industry: string;
  solutionId: string;
  headline: string;
  explanation: string;
  persona: string;
  talkTrack: string[];
  highlights: Array<{ title: string; detail: string }>;
  outcomes: string[];
  workflows: Array<{ name: string; description: string }>;
  agents: Array<{ name: string; description: string; tools: string[] }>;
  sampleRuns: Array<{ name: string; input: Record<string, unknown>; expectedOutcome: string }>;
  talkingPoints: string[];
  workflowCount: number;
  agentCount: number;
}

export interface DemoScenarioRunResult {
  scenario: DemoScenarioView;
  demo: {
    workspaceId: string;
    tenantId: string;
    ownerUserId: string;
    demoExpiresAt: string;
    workflowIds: string[];
    agentIds: string[];
    tokens: { accessToken: string; refreshToken: string };
  };
  install: {
    workflowIds: string[];
    agentIds: string[];
    skipped: Array<{ name: string; reason: string }>;
  };
  nextSteps: string[];
}

export class DemoScenarioService {
  /** Public scenario catalog with the real workflows, agents and sample runs. */
  async listScenarios(): Promise<DemoScenarioView[]> {
    let scenarios = await DemoScenarioModel.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
    if (scenarios.length === 0) {
      await ensureDefaultDemoScenarios();
      scenarios = await DemoScenarioModel.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
    }
    return scenarios.map((scenario) => this.viewFor(scenario));
  }

  async getScenario(scenarioId: string): Promise<DemoScenarioView> {
    if (!isDemoScenarioId(scenarioId)) throw new Error('DEMO_SCENARIO_NOT_FOUND');
    let scenario = await DemoScenarioModel.findOne({ id: scenarioId, isActive: true }).lean();
    if (!scenario) {
      await ensureDefaultDemoScenarios();
      scenario = await DemoScenarioModel.findOne({ id: scenarioId, isActive: true }).lean();
    }
    if (!scenario) throw new Error('DEMO_SCENARIO_NOT_FOUND');
    return this.viewFor(scenario);
  }

  /** Provision a sandbox and install the scenario's solution into it. */
  async startScenario(
    scenarioId: string,
    config: AuthConfig,
    context: { ttlHours?: number | undefined; ipAddress?: string | undefined; userAgent?: string | undefined } = {},
  ): Promise<DemoScenarioRunResult> {
    const scenario = await this.getScenario(scenarioId);

    const demo = await demoWorkspaceService.create(config, {
      ttlHours: context.ttlHours,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const install = await solutionTemplateService.install(scenario.solutionId, {
      workspaceId: demo.workspaceId,
      userId: demo.ownerUserId,
      installWorkflows: true,
      installAgents: true,
      registerMarketplaceTemplates: false,
    });

    await growthAnalyticsService.recordSafely({
      event: 'DEMO_STARTED',
      workspaceId: demo.workspaceId,
      userId: demo.ownerUserId,
      source: 'DEMO_SCENARIO',
      metadata: { scenarioId: scenario.id, solutionId: scenario.solutionId },
    });
    await conversionTrackingService.recordDemoCreated({
      workspaceId: demo.workspaceId,
      source: 'DEMO_SCENARIO',
    });

    await createAuditLog({
      action: 'DEMO_SCENARIO_STARTED',
      userId: demo.ownerUserId,
      workspaceId: demo.workspaceId,
      resource: 'demo_scenario',
      resourceId: scenario.id,
      metadata: {
        solutionId: scenario.solutionId,
        workflows: install.workflowIds.length,
        agents: install.agentIds.length,
        skipped: install.skipped.length,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return {
      scenario,
      demo: {
        workspaceId: demo.workspaceId,
        tenantId: demo.tenantId,
        ownerUserId: demo.ownerUserId,
        demoExpiresAt: demo.demoExpiresAt.toISOString(),
        workflowIds: demo.workflowIds,
        agentIds: demo.agentIds,
        tokens: demo.tokens,
      },
      install: {
        workflowIds: install.workflowIds,
        agentIds: install.agentIds,
        skipped: install.skipped,
      },
      nextSteps: [
        'Open the workspace and publish the scenario workflows',
        'Run a sample payload from the scenario to show the execution trail',
        'Install additional agents from the marketplace to extend the story',
      ],
    };
  }

  /** Compose the public view of a scenario from the solution catalog. */
  private viewFor(scenario: IDemoScenario): DemoScenarioView {
    const solution = solutionTemplateService.getSolution(scenario.solutionId);
    return {
      id: scenario.id,
      name: scenario.name,
      industry: scenario.industry,
      solutionId: scenario.solutionId,
      headline: scenario.headline,
      explanation: scenario.explanation,
      persona: scenario.persona,
      talkTrack: scenario.talkTrack,
      highlights: scenario.highlights.map((highlight) => ({
        title: highlight.title,
        detail: highlight.detail,
      })),
      outcomes: solution.outcomes,
      workflows: solution.workflows.map((workflow) => ({
        name: workflow.name,
        description: workflow.description,
      })),
      agents: solution.agents.map((agent) => ({
        name: agent.name,
        description: agent.description,
        tools: agent.toolsAllowed,
      })),
      sampleRuns: solution.demoData.sampleRuns.map((run) => ({
        name: run.name,
        input: run.input,
        expectedOutcome: run.expectedOutcome,
      })),
      talkingPoints: solution.demoData.talkingPoints,
      workflowCount: solution.workflows.length,
      agentCount: solution.agents.length,
    };
  }
}

export const demoScenarioService = new DemoScenarioService();
