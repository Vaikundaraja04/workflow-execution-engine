import { Types } from 'mongoose';
import type { WorkflowDefinition } from '../types/workflow.js';
import { WorkflowDefinitionSchema } from '../schemas/workflowSchema.js';
import { validateGraph } from '../engine/validateGraph.js';
import { WorkflowTemplateModel } from '../models/WorkflowTemplateModel.js';
import { AgentModel } from '../models/AgentModel.js';
import type { AgentOrchestrationModeDoc } from '../models/AgentModel.js';
import { createWorkflow } from './workflowService.js';
import { createAuditLog } from './auditService.js';
import type { ProductPackageId } from '../models/ProductPlanModel.js';

/**
 * Phase 14.7 - Industry solution templates.
 *
 * Packaged, installable go-to-market bundles: workflow templates, AI agent
 * templates, demo data and documentation per industry use case. Installing a
 * solution writes into the existing workflow engine, the existing agent model
 * and the existing template marketplace - no new runtime concepts.
 */

export const SOLUTION_IDS = [
  'customer-support-automation',
  'hr-workflow-automation',
  'finance-approval-automation',
  'it-helpdesk-automation',
  'sales-automation',
] as const;
export type SolutionId = (typeof SOLUTION_IDS)[number];

export interface SolutionWorkflowTemplate {
  name: string;
  description: string;
  /** Existing marketplace category (src/models/WorkflowTemplateModel.ts). */
  category: 'Automation' | 'Data Processing' | 'Integration' | 'AI Workflow' | 'Approval Flow' | 'Monitoring' | 'Notifications';
  definition: WorkflowDefinition;
}

export interface SolutionAgentTemplate {
  name: string;
  description: string;
  systemPrompt: string;
  orchestrationMode: AgentOrchestrationModeDoc;
  toolsAllowed: string[];
  requiredPermissions: string[];
  memoryEnabled: boolean;
}

export interface SolutionDemoData {
  summary: string;
  samplePayload: Record<string, unknown>;
  sampleRuns: Array<{ name: string; input: Record<string, unknown>; expectedOutcome: string }>;
  talkingPoints: string[];
}

export interface IndustrySolution {
  id: SolutionId;
  name: string;
  industry: string;
  summary: string;
  problem: string;
  outcomes: string[];
  recommendedPackage: ProductPackageId;
  tags: string[];
  workflows: SolutionWorkflowTemplate[];
  agents: SolutionAgentTemplate[];
  demoData: SolutionDemoData;
  documentation: {
    overview: string;
    prerequisites: string[];
    setup: string[];
  };
}

export interface SolutionSummary {
  id: SolutionId;
  name: string;
  industry: string;
  summary: string;
  outcomes: string[];
  recommendedPackage: ProductPackageId;
  tags: string[];
  workflowCount: number;
  agentCount: number;
}

export interface InstallSolutionInput {
  workspaceId: string;
  userId: string;
  installWorkflows?: boolean;
  installAgents?: boolean;
  registerMarketplaceTemplates?: boolean;
}

export interface InstallSolutionResult {
  solutionId: SolutionId;
  workspaceId: string;
  workflowIds: string[];
  agentIds: string[];
  marketplaceTemplateIds: string[];
  skipped: Array<{ name: string; reason: string }>;
}

export function isSolutionId(value: unknown): value is SolutionId {
  return typeof value === 'string' && (SOLUTION_IDS as readonly string[]).includes(value);
}

export function toSolutionSummary(solution: IndustrySolution): SolutionSummary {
  return {
    id: solution.id,
    name: solution.name,
    industry: solution.industry,
    summary: solution.summary,
    outcomes: solution.outcomes,
    recommendedPackage: solution.recommendedPackage,
    tags: solution.tags,
    workflowCount: solution.workflows.length,
    agentCount: solution.agents.length,
  };
}

export function validateSolutionDefinitions(solution: IndustrySolution): void {
  for (const workflow of solution.workflows) {
    const parsed = WorkflowDefinitionSchema.safeParse(workflow.definition);
    if (!parsed.success) {
      throw new Error(`SOLUTION_DEFINITION_INVALID: ${solution.id}/${workflow.name}`);
    }
    const graphErrors = validateGraph(parsed.data);
    if (graphErrors.length > 0) {
      throw new Error(`SOLUTION_DEFINITION_INVALID: ${solution.id}/${workflow.name}`);
    }
  }
}

/** Shared shape for every sandbox payload so demo runs stay predictable. */
function demoRun(name: string, input: Record<string, unknown>, expectedOutcome: string) {
  return { name, input, expectedOutcome };
}

const CUSTOMER_SUPPORT_SOLUTION: IndustrySolution = {
  id: 'customer-support-automation',
  name: 'Customer Support Automation',
  industry: 'Technology & Services',
  summary: 'Triage, route and resolve inbound support tickets automatically with an escalation path for VIP customers.',
  problem: 'Support queues are triaged by hand, VIP escalations are missed and first-response time is unpredictable.',
  outcomes: [
    'Every inbound ticket classified and routed in seconds',
    'VIP and high-priority tickets escalated automatically',
    'First-response time measured per queue and per tier',
  ],
  recommendedPackage: 'BUSINESS',
  tags: ['support', 'triage', 'sla', 'prioritisation'],
  workflows: [
    {
      name: 'Support: triage inbound ticket',
      description: 'Classifies inbound tickets and routes high-priority work to the escalation queue.',
      category: 'Automation',
      definition: {
        nodes: [
          { id: 'trigger', type: 'webhook', config: {} },
          { id: 'priority', type: 'condition', config: { field: 'priority', operator: 'equals', value: 'HIGH' } },
          { id: 'escalate', type: 'log', config: { message: 'Escalated to tier-2 support within SLA' } },
          { id: 'queue', type: 'log', config: { message: 'Queued for standard first-response handling' } },
        ],
        edges: [
          { source: 'trigger', target: 'priority' },
          { source: 'priority', target: 'escalate', condition: 'true' },
          { source: 'priority', target: 'queue', condition: 'false' },
        ],
      },
    },
    {
      name: 'Support: VIP escalation',
      description: 'Escalates tickets from enterprise accounts to the named account owner.',
      category: 'Notifications',
      definition: {
        nodes: [
          { id: 'trigger', type: 'webhook', config: {} },
          { id: 'vip', type: 'condition', config: { field: 'customerTier', operator: 'equals', value: 'ENTERPRISE' } },
          { id: 'notify', type: 'log', config: { message: 'Paged the account owner for an enterprise ticket' } },
          { id: 'standard', type: 'log', config: { message: 'Handled by the standard support rota' } },
        ],
        edges: [
          { source: 'trigger', target: 'vip' },
          { source: 'vip', target: 'notify', condition: 'true' },
          { source: 'vip', target: 'standard', condition: 'false' },
        ],
      },
    },
  ],
  agents: [
    {
      name: 'Support Triage Agent',
      description: 'Reads inbound tickets, classifies intent and suggests the first response.',
      systemPrompt: 'You are a support triage assistant. Classify the inbound ticket by intent, urgency and customer tier, then propose the first response and the correct queue. Never promise an SLA you cannot verify.',
      orchestrationMode: 'autonomous',
      toolsAllowed: ['workflow.read', 'execution.read'],
      requiredPermissions: ['AGENT_TOOL_EXECUTE'],
      memoryEnabled: false,
    },
  ],
  demoData: {
    summary: 'Simulated support queue with a mix of standard and enterprise tickets.',
    samplePayload: {
      ticketId: 'TCK-1042',
      subject: 'Webhook deliveries are failing intermittently',
      priority: 'HIGH',
      customerTier: 'ENTERPRISE',
      channel: 'email',
    },
    sampleRuns: [
      demoRun('Enterprise outage reported', { priority: 'HIGH', customerTier: 'ENTERPRISE' }, 'Escalated to tier-2 and the account owner is paged'),
      demoRun('Standard how-to question', { priority: 'LOW', customerTier: 'STANDARD' }, 'Queued for standard first-response handling'),
    ],
    talkingPoints: [
      'The same workflow handles both queues without duplicated logic',
      'Escalation rules are versioned and auditable',
      'Agent suggestions cut manual triage time',
    ],
  },
  documentation: {
    overview: 'Install to get both triage workflows, the triage agent and a sample payload that exercises the escalation and the standard path.',
    prerequisites: ['Inbound channel forwards tickets to the webhook URL', 'Customer tier present on the incoming payload'],
    setup: [
      'Install the solution into the workspace',
      'Copy the webhook URL from the triage workflow and connect your helpdesk',
      'Run the sample payload to confirm the escalation path',
      'Invite the support team with the editor role',
    ],
  },
};


const HR_SOLUTION: IndustrySolution = {
  id: 'hr-workflow-automation',
  name: 'HR Workflow Automation',
  industry: 'People Operations',
  summary: 'Standardise onboarding and leave approvals with consistent, auditable routing.',
  problem: 'Onboarding checklists live in spreadsheets and approval routing varies between teams.',
  outcomes: [
    'Every new hire follows the same onboarding checklist',
    'Leave requests routed to the right approver by policy',
    'Complete audit trail for people operations',
  ],
  recommendedPackage: 'STARTER',
  tags: ['hr', 'onboarding', 'approvals', 'compliance'],
  workflows: [
    {
      name: 'HR: employee onboarding checklist',
      description: 'Runs the onboarding checklist and flags IT provisioning for new joiners.',
      category: 'Automation',
      definition: {
        nodes: [
          { id: 'trigger', type: 'webhook', config: {} },
          { id: 'provisioning', type: 'condition', config: { field: 'requiresEquipment', operator: 'equals', value: true } },
          { id: 'itTask', type: 'log', config: { message: 'IT provisioning task created for the new joiner' } },
          { id: 'checklist', type: 'log', config: { message: 'Standard onboarding checklist completed' } },
        ],
        edges: [
          { source: 'trigger', target: 'provisioning' },
          { source: 'provisioning', target: 'itTask', condition: 'true' },
          { source: 'provisioning', target: 'checklist', condition: 'false' },
        ],
      },
    },
    {
      name: 'HR: leave approval routing',
      description: 'Routes leave requests by duration to the manager or the HR business partner.',
      category: 'Approval Flow',
      definition: {
        nodes: [
          { id: 'trigger', type: 'webhook', config: {} },
          { id: 'longLeave', type: 'condition', config: { field: 'days', operator: 'greaterThan', value: 10 } },
          { id: 'hrbp', type: 'log', config: { message: 'Routed to the HR business partner for approval' } },
          { id: 'manager', type: 'log', config: { message: 'Routed to the reporting manager for approval' } },
        ],
        edges: [
          { source: 'trigger', target: 'longLeave' },
          { source: 'longLeave', target: 'hrbp', condition: 'true' },
          { source: 'longLeave', target: 'manager', condition: 'false' },
        ],
      },
    },
  ],
  agents: [
    {
      name: 'People Ops Assistant',
      description: 'Answers policy questions and drafts onboarding communications for review.',
      systemPrompt: 'You are a people operations assistant. Answer policy questions using only the documented policy pack, summarise leave balances and draft onboarding messages. Escalate anything involving compensation, performance or termination to a human.',
      orchestrationMode: 'sequential',
      toolsAllowed: ['workflow.read'],
      requiredPermissions: ['AGENT_TOOL_EXECUTE'],
      memoryEnabled: true,
    },
  ],
  demoData: {
    summary: 'Sample onboarding and leave requests covering both routing branches.',
    samplePayload: {
      employeeId: 'EMP-2210',
      requestType: 'LEAVE',
      days: 12,
      requiresEquipment: false,
      department: 'Engineering',
    },
    sampleRuns: [
      demoRun('New joiner with laptop request', { requiresEquipment: true }, 'IT provisioning task created and the checklist completed'),
      demoRun('Two-week leave request', { days: 12 }, 'Routed to the HR business partner for approval'),
    ],
    talkingPoints: [
      'Consistent policy routing removes manager-by-manager variation',
      'Onboarding runs end to end without a manual handover',
      'Every approval is captured in the audit log',
    ],
  },
  documentation: {
    overview: 'Install to get the onboarding and leave routing workflows plus the people ops agent. Both run from a webhook trigger connected to your HRIS.',
    prerequisites: ['HRIS can post events to a webhook', 'Leave policy thresholds confirmed with HR'],
    setup: [
      'Install the solution into the workspace',
      'Connect HRIS onboarding and leave events to the workflow webhook endpoints',
      'Adjust the leave threshold in the condition node to match policy',
      'Record a baseline run with the sample payload',
    ],
  },
};

const FINANCE_SOLUTION: IndustrySolution = {
  id: 'finance-approval-automation',
  name: 'Finance Approval Automation',
  industry: 'Finance & Accounting',
  summary: 'Route invoices and expenses through policy-based approval thresholds with a full audit trail.',
  problem: 'Approval thresholds are applied inconsistently and large invoices slip through without a second approver.',
  outcomes: [
    'Every invoice approved by the right authority',
    'Policy thresholds enforced by the engine, not by memory',
    'Auditable approval history for internal and external audit',
  ],
  recommendedPackage: 'BUSINESS',
  tags: ['finance', 'approvals', 'invoice', 'controls'],
  workflows: [
    {
      name: 'Finance: invoice approval threshold',
      description: 'Escalates invoices above the approval threshold and auto-approves the rest.',
      category: 'Approval Flow',
      definition: {
        nodes: [
          { id: 'trigger', type: 'webhook', config: {} },
          { id: 'threshold', type: 'condition', config: { field: 'amount', operator: 'greaterThan', value: 5000 } },
          { id: 'controller', type: 'log', config: { message: 'Routed to the finance controller for approval' } },
          { id: 'automatic', type: 'log', config: { message: 'Auto-approved within the delegated threshold' } },
        ],
        edges: [
          { source: 'trigger', target: 'threshold' },
          { source: 'threshold', target: 'controller', condition: 'true' },
          { source: 'threshold', target: 'automatic', condition: 'false' },
        ],
      },
    },
    {
      name: 'Finance: expense policy check',
      description: 'Flags out-of-policy expense claims for review before reimbursement.',
      category: 'Monitoring',
      definition: {
        nodes: [
          { id: 'trigger', type: 'webhook', config: {} },
          { id: 'policy', type: 'condition', config: { field: 'category', operator: 'equals', value: 'TRAVEL' } },
          { id: 'review', type: 'log', config: { message: 'Flagged for policy review with the receipt attached' } },
          { id: 'reimburse', type: 'log', config: { message: 'Within policy - queued for reimbursement' } },
        ],
        edges: [
          { source: 'trigger', target: 'policy' },
          { source: 'policy', target: 'review', condition: 'true' },
          { source: 'policy', target: 'reimburse', condition: 'false' },
        ],
      },
    },
  ],
  agents: [
    {
      name: 'Finance Review Agent',
      description: 'Summarises an invoice or claim, checks it against policy and drafts the review note.',
      systemPrompt: 'You are a finance review assistant. Summarise the submitted document, check it against the stated policy thresholds and produce a review note with a recommendation. You never approve payments - a human approver always decides.',
      orchestrationMode: 'supervisor_worker',
      toolsAllowed: ['workflow.read', 'execution.read'],
      requiredPermissions: ['AGENT_TOOL_EXECUTE'],
      memoryEnabled: false,
    },
  ],
  demoData: {
    summary: 'Sample invoices around the approval threshold plus an out-of-policy claim.',
    samplePayload: {
      invoiceId: 'INV-88213',
      vendor: 'Northwind Logistics',
      amount: 12400,
      currency: 'USD',
      category: 'TRAVEL',
    },
    sampleRuns: [
      demoRun('Invoice above threshold', { amount: 12400 }, 'Routed to the finance controller for approval'),
      demoRun('Invoice below threshold', { amount: 850 }, 'Auto-approved within the delegated threshold'),
    ],
    talkingPoints: [
      'Thresholds are configuration, not code',
      'Both branches are recorded in the audit chain',
      'The agent drafts the review note but never approves',
    ],
  },
  documentation: {
    overview: 'Install to get the invoice threshold and expense policy workflows plus the review agent. Set the threshold to match your delegation of authority.',
    prerequisites: ['AP system can post invoices to a webhook', 'Approval thresholds agreed with the finance controller'],
    setup: [
      'Install the solution into the workspace',
      'Connect the AP system to the invoice workflow webhook',
      'Set the amount threshold in the condition node',
      'Run both sample payloads to confirm the branches',
    ],
  },
};

const IT_HELPDESK_SOLUTION: IndustrySolution = {
  id: 'it-helpdesk-automation',
  name: 'IT Helpdesk Automation',
  industry: 'IT Operations',
  summary: 'Triage incidents by severity and automate standard access requests with approval controls.',
  problem: 'Incident severity is re-assessed manually and access requests are handled ad hoc without evidence.',
  outcomes: [
    'Critical incidents paged immediately with an owner',
    'Access requests provisioned with an approval record',
    'Consistent severity handling across all shifts',
  ],
  recommendedPackage: 'BUSINESS',
  tags: ['it', 'incident', 'access', 'runbook'],
  workflows: [
    {
      name: 'IT: incident triage by severity',
      description: 'Pages the on-call engineer for critical incidents and queues the rest.',
      category: 'Monitoring',
      definition: {
        nodes: [
          { id: 'trigger', type: 'webhook', config: {} },
          { id: 'critical', type: 'condition', config: { field: 'severity', operator: 'equals', value: 'CRITICAL' } },
          { id: 'page', type: 'log', config: { message: 'Paged the on-call engineer and opened an incident channel' } },
          { id: 'ticket', type: 'log', config: { message: 'Created an incident ticket in the standard queue' } },
        ],
        edges: [
          { source: 'trigger', target: 'critical' },
          { source: 'critical', target: 'page', condition: 'true' },
          { source: 'critical', target: 'ticket', condition: 'false' },
        ],
      },
    },
    {
      name: 'IT: access request provisioning',
      description: 'Provisions standard access and escalates privileged requests to the security owner.',
      category: 'Approval Flow',
      definition: {
        nodes: [
          { id: 'trigger', type: 'webhook', config: {} },
          { id: 'privileged', type: 'condition', config: { field: 'accessLevel', operator: 'equals', value: 'ADMIN' } },
          { id: 'security', type: 'log', config: { message: 'Routed to the security owner for privileged approval' } },
          { id: 'provision', type: 'log', config: { message: 'Standard access provisioned with an approval record' } },
        ],
        edges: [
          { source: 'trigger', target: 'privileged' },
          { source: 'privileged', target: 'security', condition: 'true' },
          { source: 'privileged', target: 'provision', condition: 'false' },
        ],
      },
    },
  ],
  agents: [
    {
      name: 'IT Triage Agent',
      description: 'Enriches alerts, proposes a severity and links the relevant runbook.',
      systemPrompt: 'You are an IT triage assistant. Read the incoming alert, propose a severity with reasoning, link the matching runbook and list the first three diagnostic steps. Never execute changes - propose them for a human operator.',
      orchestrationMode: 'parallel',
      toolsAllowed: ['execution.read', 'workflow.read'],
      requiredPermissions: ['AGENT_TOOL_EXECUTE'],
      memoryEnabled: false,
    },
  ],
  demoData: {
    summary: 'Sample alerts and access requests covering the critical and privileged branches.',
    samplePayload: {
      alertId: 'ALT-3391',
      service: 'workflow-api',
      severity: 'CRITICAL',
      accessLevel: 'STANDARD',
    },
    sampleRuns: [
      demoRun('Database latency alert', { severity: 'CRITICAL' }, 'On-call engineer paged and incident channel opened'),
      demoRun('Admin access request', { accessLevel: 'ADMIN' }, 'Routed to the security owner for privileged approval'),
    ],
    talkingPoints: [
      'Severity handling is identical on every shift',
      'Privileged access always has an approval record',
      'Runbook linkage shortens time to resolution',
    ],
  },
  documentation: {
    overview: 'Install to get the incident triage and access provisioning workflows plus the triage agent. Connect your monitoring and identity systems to the webhook endpoints.',
    prerequisites: ['Monitoring platform can post alerts to a webhook', 'Identity system exposes an access request webhook'],
    setup: [
      'Install the solution into the workspace',
      'Connect the alerting platform to the incident workflow webhook',
      'Connect the access request form to the provisioning workflow webhook',
      'Replay the sample payloads with the on-call rota',
    ],
  },
};


const SALES_SOLUTION: IndustrySolution = {
  id: 'sales-automation',
  name: 'Sales Automation',
  industry: 'Revenue Operations',
  summary: 'Qualify inbound leads and surface renewal risk before the customer churns.',
  problem: 'Inbound leads wait for manual qualification and renewal risk is noticed only after the renewal date passes.',
  outcomes: [
    'Every inbound lead qualified and routed within minutes',
    'Renewal risk flagged 90 days ahead with a health signal',
    'Consistent handover between sales and customer success',
  ],
  recommendedPackage: 'BUSINESS',
  tags: ['sales', 'lead', 'renewal', 'pipeline'],
  workflows: [
    {
      name: 'Sales: inbound lead qualification',
      description: 'Scores inbound leads by company size and routes enterprise demand to an account executive.',
      category: 'Automation',
      definition: {
        nodes: [
          { id: 'trigger', type: 'webhook', config: {} },
          { id: 'enterprise', type: 'condition', config: { field: 'companySize', operator: 'equals', value: '1000+' } },
          { id: 'executive', type: 'log', config: { message: 'Assigned to an enterprise account executive' } },
          { id: 'nurture', type: 'log', config: { message: 'Routed to the self-serve nurture sequence' } },
        ],
        edges: [
          { source: 'trigger', target: 'enterprise' },
          { source: 'enterprise', target: 'executive', condition: 'true' },
          { source: 'enterprise', target: 'nurture', condition: 'false' },
        ],
      },
    },
    {
      name: 'Sales: renewal risk alert',
      description: 'Alerts the account team when a renewal is close and account health is declining.',
      category: 'Notifications',
      definition: {
        nodes: [
          { id: 'trigger', type: 'webhook', config: {} },
          { id: 'atRisk', type: 'condition', config: { field: 'healthBand', operator: 'equals', value: 'at_risk' } },
          { id: 'alert', type: 'log', config: { message: 'Renewal risk raised with the account team' } },
          { id: 'monitor', type: 'log', config: { message: 'Account continues on the standard renewal cycle' } },
        ],
        edges: [
          { source: 'trigger', target: 'atRisk' },
          { source: 'atRisk', target: 'alert', condition: 'true' },
          { source: 'atRisk', target: 'monitor', condition: 'false' },
        ],
      },
    },
  ],
  agents: [
    {
      name: 'Pipeline Assistant',
      description: 'Summarises account activity and drafts the qualification brief for an inbound lead.',
      systemPrompt: 'You are a revenue operations assistant. Summarise the account activity, draft a qualification brief for the inbound lead and list the three discovery questions that matter most. Never invent usage data - quote only what the platform reports.',
      orchestrationMode: 'sequential',
      toolsAllowed: ['workflow.read', 'execution.read'],
      requiredPermissions: ['AGENT_TOOL_EXECUTE'],
      memoryEnabled: true,
    },
  ],
  demoData: {
    summary: 'Sample inbound leads and a renewal-risk signal.',
    samplePayload: {
      leadId: 'LEAD-2043',
      companySize: '1000+',
      industry: 'Financial Services',
      healthBand: 'at_risk',
      renewalInDays: 76,
    },
    sampleRuns: [
      demoRun('Enterprise inbound lead', { companySize: '1000+' }, 'Assigned to an enterprise account executive'),
      demoRun('At-risk renewal', { healthBand: 'at_risk', renewalInDays: 76 }, 'Renewal risk raised with the account team'),
    ],
    talkingPoints: [
      'Leads are qualified and routed without a manual triage step',
      'Renewal risk is driven by the same health score customer success uses',
      'Handover between sales and CS is automated and auditable',
    ],
  },
  documentation: {
    overview: 'Install to get the lead qualification and renewal risk workflows plus the pipeline assistant. Connect your form provider and billing lifecycle webhooks.',
    prerequisites: ['Lead capture form posts to a webhook', 'Subscription lifecycle events forwarded to a webhook'],
    setup: [
      'Install the solution into the workspace',
      'Connect the lead form to the qualification workflow webhook',
      'Connect subscription lifecycle events to the renewal workflow webhook',
      'Run the sample payloads to confirm both branches',
    ],
  },
};

export const SOLUTION_CATALOG: readonly IndustrySolution[] = [
  CUSTOMER_SUPPORT_SOLUTION,
  HR_SOLUTION,
  FINANCE_SOLUTION,
  IT_HELPDESK_SOLUTION,
  SALES_SOLUTION,
];



export class SolutionTemplateService {
  /** Marketing/console list view of the packaged solutions. */
  listSolutions(filters: { industry?: string | undefined; packageId?: ProductPackageId | undefined } = {}): SolutionSummary[] {
    return SOLUTION_CATALOG
      .filter((solution) => !filters.industry || solution.industry === filters.industry)
      .filter((solution) => !filters.packageId || solution.recommendedPackage === filters.packageId)
      .map(toSolutionSummary);
  }

  getSolution(solutionId: string): IndustrySolution {
    const solution = SOLUTION_CATALOG.find((entry) => entry.id === solutionId);
    if (!solution) throw new Error('SOLUTION_NOT_FOUND');
    return solution;
  }

  /**
   * Install a solution into a workspace: workflows through the existing workflow
   * service, agents through the existing agent model and (optionally) the
   * workflow templates registered in the existing template marketplace.
   */
  async install(solutionId: string, input: InstallSolutionInput): Promise<InstallSolutionResult> {
    const solution = this.getSolution(solutionId);
    validateSolutionDefinitions(solution);

    const workspaceId = input.workspaceId;
    const workspaceIdObj = new Types.ObjectId(workspaceId);
    const userIdObj = new Types.ObjectId(input.userId);
    const installWorkflows = input.installWorkflows ?? true;
    const installAgents = input.installAgents ?? true;
    const registerTemplates = input.registerMarketplaceTemplates ?? true;

    const workflowIds: string[] = [];
    const agentIds: string[] = [];
    const marketplaceTemplateIds: string[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    if (installWorkflows) {
      for (const workflow of solution.workflows) {
        try {
          const created = await createWorkflow(workflow.name, workflow.definition, input.userId, workspaceId);
          workflowIds.push(String((created as { _id: unknown })._id));
        } catch (error) {
          skipped.push({
            name: workflow.name,
            reason: error instanceof Error ? error.message : 'INSTALL_FAILED',
          });
        }
      }
    }

    if (installAgents) {
      for (const agent of solution.agents) {
        try {
          const existing = await AgentModel.findOne({ workspaceId: workspaceIdObj, name: agent.name })
            .select('_id')
            .lean();
          if (existing) {
            skipped.push({ name: agent.name, reason: 'AGENT_ALREADY_EXISTS' });
            continue;
          }
          const created = await AgentModel.create({
            workspaceId: workspaceIdObj,
            name: agent.name,
            description: agent.description,
            systemPrompt: agent.systemPrompt,
            modelConfig: { provider: 'mock' },
            orchestrationMode: agent.orchestrationMode,
            toolsAllowed: agent.toolsAllowed,
            requiredPermissions: agent.requiredPermissions,
            memoryEnabled: agent.memoryEnabled,
            status: 'DRAFT',
            version: 1,
            createdBy: userIdObj,
          });
          agentIds.push(created._id.toString());
        } catch (error) {
          skipped.push({
            name: agent.name,
            reason: error instanceof Error ? error.message : 'INSTALL_FAILED',
          });
        }
      }
    }

    if (registerTemplates) {
      for (const workflow of solution.workflows) {
        try {
          const existing = await WorkflowTemplateModel.findOne({ name: workflow.name, visibility: 'MARKETPLACE' })
            .select('_id')
            .lean();
          if (existing) {
            marketplaceTemplateIds.push(existing._id.toString());
            continue;
          }
          const template = await WorkflowTemplateModel.create({
            name: workflow.name,
            description: workflow.description,
            category: workflow.category,
            visibility: 'MARKETPLACE',
            status: 'PUBLISHED',
            marketplaceStatus: 'APPROVED',
            createdBy: userIdObj,
            workspaceId: workspaceIdObj,
            workflowDefinition: workflow.definition,
            versionCount: 1,
            tags: [solution.id, ...solution.tags].slice(0, 10),
            metadata: {
              documentation: solution.documentation.overview,
              requirements: solution.documentation.prerequisites,
            },
            statistics: { downloads: 0, installs: 1, executions: 0 },
          });
          marketplaceTemplateIds.push(template._id.toString());
        } catch (error) {
          skipped.push({
            name: `marketplace:${workflow.name}`,
            reason: error instanceof Error ? error.message : 'INSTALL_FAILED',
          });
        }
      }
    }

    await createAuditLog({
      action: 'SOLUTION_INSTALLED',
      userId: input.userId,
      workspaceId: workspaceIdObj,
      resource: 'solution',
      resourceId: solution.id,
      metadata: {
        workflows: workflowIds.length,
        agents: agentIds.length,
        marketplaceTemplates: marketplaceTemplateIds.length,
        skipped: skipped.map((entry) => entry.reason),
        recommendedPackage: solution.recommendedPackage,
      },
    });

    return {
      solutionId: solution.id,
      workspaceId,
      workflowIds,
      agentIds,
      marketplaceTemplateIds,
      skipped,
    };
  }
}

export const solutionTemplateService = new SolutionTemplateService();
