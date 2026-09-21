import { Types } from 'mongoose';
import { CopilotSessionModel } from '../models/CopilotSessionModel.js';
import type {
  ICopilotSession,
  CopilotIntent,
  CopilotArtifact,
} from '../models/CopilotSessionModel.js';
import {
  CopilotMessageModel,
} from '../models/CopilotMessageModel.js';
import type {
  ICopilotMessage,
  CopilotMessageRole,
  CopilotMessageStatus,
  CopilotRepairAttempt,
} from '../models/CopilotMessageModel.js';
import { AIWorkflowService } from './aiWorkflowService.js';
import type { GenerateWorkflowResult } from './aiWorkflowService.js';
import { AIProviderFactory } from './ai/AIProviderFactory.js';
import { AIGovernanceGate } from './aiGovernanceGate.js';
import type { AIProvider, GeneratedWorkflow } from './ai/AIProvider.js';
import { AISecurityService } from './ai/aiSecurityService.js';
import { AIUsageService } from './aiUsageService.js';
import { NodeCapabilityRegistry } from './ai/nodeCapabilityRegistry.js';
import { createAuditLog } from './auditService.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import type { ValidationError, WorkflowNode, WorkflowEdge } from '../types/workflow.js';
import type { WorkflowDefinitionInput } from '../schemas/workflowSchema.js';

export type { CopilotIntent, CopilotArtifact } from '../models/CopilotSessionModel.js';

export interface CopilotSessionPayload {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  status: 'ACTIVE' | 'ARCHIVED';
  intentCounts: Record<CopilotIntent, number>;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CopilotMessagePayload {
  id: string;
  sessionId: string;
  role: CopilotMessageRole;
  content: string;
  intent: CopilotIntent | null;
  status: CopilotMessageStatus;
  artifacts: CopilotArtifact[];
  repairCount: number;
  repairAttempts: Array<{
    attempt: number;
    validationErrors: Array<{ type: string; message: string; nodeId?: string }>;
  }>;
  createdAt: string;
}

export interface CreateSessionResult {
  session: CopilotSessionPayload;
}

export interface GetSessionResult {
  session: CopilotSessionPayload;
  messages: CopilotMessagePayload[];
}

export interface SendMessageResult {
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  intent: CopilotIntent;
  response: CopilotMessagePayload | null;
}

export class AICopilotService {
  private static instance: AICopilotService;
  private readonly registry: NodeCapabilityRegistry;

  constructor() {
    this.registry = NodeCapabilityRegistry.getInstance();
  }

  public static getInstance(): AICopilotService {
    if (!AICopilotService.instance) {
      AICopilotService.instance = new AICopilotService();
    }
    return AICopilotService.instance;
  }

  /** Create a copilot conversation session for a workspace member. */
  async createSession(
    workspaceId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    options: { title?: string; intent?: CopilotIntent } = {},
  ): Promise<CopilotSessionPayload> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const uid = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const title = typeof options.title === 'string' ? options.title.slice(0, 200) : 'New copilot session';

    const session = await CopilotSessionModel.create({
      workspaceId: wsId,
      userId: uid,
      title,
      status: 'ACTIVE',
      intentCounts: { BUILD_WORKFLOW: 0, MODIFY_WORKFLOW: 0, EXPLAIN_WORKFLOW: 0, VALIDATE_WORKFLOW: 0 },
    });

    await createAuditLog({
      action: 'AI_COPILOT_SESSION_CREATED',
      userId: uid,
      workspaceId: wsId,
      resource: 'copilot_session',
      resourceId: session._id.toString(),
      metadata: { title },
    });

    return this.toSessionPayload(session as unknown as ICopilotSession);
  }

  /** Fetch a session with its messages, enforcing workspace scoping. */
  async getSession(
    sessionId: string,
    workspaceId: Types.ObjectId | string,
  ): Promise<GetSessionResult | null> {
    if (!Types.ObjectId.isValid(sessionId)) {
      throw new Error('INVALID_REQUEST');
    }
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const session = (await CopilotSessionModel.findOne({ _id: sessionId, workspaceId: wsId })) as ICopilotSession | null;
    if (!session) {
      return null;
    }
    const messages = (await CopilotMessageModel.find({ sessionId: session._id }).sort({ createdAt: 1 }).lean()) as unknown as ICopilotMessage[];
    return {
      session: this.toSessionPayload(session),
      messages: messages.map((message) => this.toMessagePayload(message)),
    };
  }

  /** Append a message (user or system) to an existing session. */
  async appendMessage(input: {
    sessionId: string;
    workspaceId: Types.ObjectId | string;
    userId: Types.ObjectId | string;
    role: CopilotMessageRole;
    content: string;
    intent?: CopilotIntent;
    status?: CopilotMessageStatus;
    artifacts?: CopilotArtifact[];
    repairAttempts?: CopilotRepairAttempt[];
  }): Promise<ICopilotMessage> {
    const wsId = typeof input.workspaceId === 'string' ? new Types.ObjectId(input.workspaceId) : input.workspaceId;
    const uid = typeof input.userId === 'string' ? new Types.ObjectId(input.userId) : input.userId;

    const createInput: {
      sessionId: string;
      workspaceId: Types.ObjectId;
      userId: Types.ObjectId;
      role: CopilotMessageRole;
      content: string;
      status: CopilotMessageStatus;
      artifacts: CopilotArtifact[];
      repairAttempts: CopilotRepairAttempt[];
      repairCount: number;
      intent?: CopilotIntent;
    } = {
      sessionId: input.sessionId,
      workspaceId: wsId,
      userId: uid,
      role: input.role,
      content: input.content,
      status: input.status ?? 'COMPLETED',
      artifacts: input.artifacts ?? [],
      repairAttempts: input.repairAttempts ?? [],
      repairCount: input.repairAttempts?.length ?? 0,
    };
    if (input.intent !== undefined) {
      createInput.intent = input.intent;
    }
    const message = await CopilotMessageModel.create(createInput);

    await CopilotSessionModel.updateOne(
      { _id: new Types.ObjectId(input.sessionId), workspaceId: wsId },
      { $set: { lastMessageAt: new Date() } },
    );

    return message;
  }

  /**
   * Rule-based intent classification. Deterministic, provider-independent, and
   * covered by tests: BUILD > MODIFY > VALIDATE > EXPLAIN.
   */
  classifyIntent(content: string): CopilotIntent {
    const text = (content ?? '').toLowerCase();

    if (/\b(build|create|generate|make)\b/.test(text)) {
      return 'BUILD_WORKFLOW';
    }
    if (/\b(modify|change|update|add|remove|replace|rename)\b/.test(text)) {
      return 'MODIFY_WORKFLOW';
    }
    if (/\b(validate|check|verify|lint|errors?|valid)\b/.test(text)) {
      return 'VALIDATE_WORKFLOW';
    }
    return 'EXPLAIN_WORKFLOW';
  }

  /**
   * Store a user message, classify intent, dispatch to the matching handler,
   * and persist the assistant response with artifacts.
   */
  async processMessage(input: {
    sessionId: string;
    workspaceId: Types.ObjectId | string;
    userId: Types.ObjectId | string;
    content: string;
  }): Promise<SendMessageResult> {
    const wsId = typeof input.workspaceId === 'string' ? new Types.ObjectId(input.workspaceId) : input.workspaceId;
    const uid = typeof input.userId === 'string' ? new Types.ObjectId(input.userId) : input.userId;

    const session = await CopilotSessionModel.findOne({ _id: input.sessionId, workspaceId: wsId });
    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }
    if (session.status === 'ARCHIVED') {
      throw new Error('COPILOT_SESSION_ARCHIVED');
    }

    const content = typeof input.content === 'string' ? input.content : '';
    if (!content.trim()) {
      throw new Error('INVALID_REQUEST');
    }

    const intent = this.classifyIntent(content);
    const userMessage = await this.appendMessage({
      sessionId: session._id.toString(),
      workspaceId: wsId,
      userId: uid,
      role: 'user',
      content,
      intent,
    });

    let response: ICopilotMessage | null = null;
    let responseIntent: CopilotIntent = intent;
    let responseStatus: CopilotMessageStatus = 'COMPLETED';
    let responseContent = '';
    let responseArtifacts: CopilotArtifact[] = [];
    let responseRepairAttempts: CopilotRepairAttempt[] = [];
    try {
      if (intent === 'BUILD_WORKFLOW' || intent === 'MODIFY_WORKFLOW') {
        let modifyContext: CopilotArtifact | null = null;
        if (intent === 'MODIFY_WORKFLOW') {
          modifyContext = await this.getLatestDraftArtifact(session._id.toString());
          if (!modifyContext) {
            responseIntent = 'EXPLAIN_WORKFLOW';
            responseStatus = 'NEEDS_REVIEW';
            responseContent =
              'No draft workflow exists in this session yet. Ask me to build a workflow first, then I can modify it.';
          }
        }
        if (responseContent === '') {
          const draftInput = modifyContext
            ? `${content}\n\nCurrent draft:\n${JSON.stringify(modifyContext.data).slice(0, 4000)}`
            : content;
          const repair = await this.generateDraftWithRepair(wsId, uid, draftInput);
          responseRepairAttempts = repair.repairAttempts;
          const artifacts: CopilotArtifact[] = [{ kind: 'DRAFT_WORKFLOW', data: repair.draft }];
          if (intent === 'MODIFY_WORKFLOW') {
            const plan = this.buildChangePlan(repair.draft, content);
            artifacts.push({ kind: 'CHANGE_PLAN', data: plan });
          }
          artifacts.push({
            kind: 'VALIDATION_REPORT',
            data: { isValid: repair.validation.isValid, errors: repair.validation.errors },
          });
          responseStatus = repair.validation.isValid ? 'COMPLETED' : 'REPAIR_EXHAUSTED';
          responseContent = repair.validation.isValid
            ? (repair.repaired
              ? `Draft validated after ${repair.repairAttempts.length} repair attempt(s). "${repair.draft.workflowName}" is ready for review.`
              : `Generated draft workflow "${repair.draft.workflowName}" with ${repair.draft.definition.nodes.length} node(s). The draft passed validation.`)
            : `Draft validation still fails after ${repair.repairAttempts.length} repair attempt(s). Review the validation report before publishing.`;
          responseArtifacts = artifacts;
          await this.auditCopilot('AI_COPILOT_MESSAGE_SENT', wsId, uid, session._id.toString(), {
            intent, repairAttempts: repair.repairAttempts.length, isValid: repair.validation.isValid,
          });
        }
      } else if (intent === 'EXPLAIN_WORKFLOW') {
        response = await this.handleExplain(session, userMessage, uid, wsId);
      } else {
        response = await this.handleValidate(session, userMessage, uid, wsId);
      }
    } catch (error) {
      response = await this.appendMessage({
        sessionId: session._id.toString(),
        workspaceId: wsId,
        userId: uid,
        role: 'assistant',
        content: `Copilot request failed: ${error instanceof Error ? error.message : String(error)}`,
        intent,
        status: 'FAILED',
      });
    }

    if (response === null && responseContent !== '') {
      response = await this.appendMessage({
        sessionId: session._id.toString(),
        workspaceId: wsId,
        userId: uid,
        role: 'assistant',
        content: responseContent,
        intent: responseIntent,
        status: responseStatus,
        artifacts: responseArtifacts,
        repairAttempts: responseRepairAttempts,
      });
    }

    await CopilotSessionModel.updateOne(
      { _id: session._id, workspaceId: wsId },
      { $inc: { [`intentCounts.${intent}`]: 1 } },
    );

    return {
      sessionId: session._id.toString(),
      userMessageId: (userMessage._id as Types.ObjectId).toString(),
      assistantMessageId: response ? (response._id as Types.ObjectId).toString() : '',
      intent,
      response: response ? this.toMessagePayload(response) : null,
    };
  }

  /**
   * BUILD: reuse AIWorkflowService (which already validates + repairs) and
   * attach the validated draft as an artifact.
   */
  private async handleBuild(
    session: ICopilotSession,
    userMessage: ICopilotMessage,
    userId: Types.ObjectId,
    workspaceId: Types.ObjectId,
  ): Promise<ICopilotMessage> {
    const result = await AIWorkflowService.getInstance().generateWorkflowFromPrompt(
      userMessage.content,
      workspaceId,
      userId,
    );

    const validationErrors = (result.validation.errors ?? []).map((error) => ({
      type: error.type,
      message: error.message,
      ...(error.nodeId ? { nodeId: error.nodeId } : {}),
    }));

    await this.auditCopilot('AI_COPILOT_MESSAGE_SENT', workspaceId, userId, session._id.toString(), {
      intent: 'BUILD_WORKFLOW',
      draftName: result.draftWorkflow.workflowName,
      isValid: result.validation.isValid,
      riskLevel: result.draftWorkflow.riskLevel ?? null,
    });

    return this.appendMessage({
      sessionId: session._id.toString(),
      workspaceId,
      userId,
      role: 'assistant',
      content:
        `Generated draft workflow "${result.draftWorkflow.workflowName}" with ` +
        `${result.draftWorkflow.definition.nodes.length} node(s). ` +
        (result.validation.isValid
          ? 'The draft passed graph validation and is ready for review.'
          : `Validation reported ${validationErrors.length} issue(s); the draft needs review before publishing.`),
      intent: 'BUILD_WORKFLOW',
      status: result.validation.isValid ? 'COMPLETED' : 'NEEDS_REVIEW',
      artifacts: [
        { kind: 'DRAFT_WORKFLOW', data: result.draftWorkflow },
        { kind: 'VALIDATION_REPORT', data: { isValid: result.validation.isValid, errors: validationErrors } },
      ],
    });
  }

  /**
   * MODIFY: generate a structured workflow change plan against the most recent
   * draft artifact in the session. Plans require approval before application.
   */
  private async handleModify(
    session: ICopilotSession,
    userMessage: ICopilotMessage,
    userId: Types.ObjectId,
    workspaceId: Types.ObjectId,
  ): Promise<ICopilotMessage> {
    const lastDraftMessage = (await CopilotMessageModel
      .findOne({ sessionId: session._id, 'artifacts.kind': 'DRAFT_WORKFLOW' })
      .sort({ createdAt: -1 })
      .lean()) as unknown as ICopilotMessage | null;

    const draftArtifact = lastDraftMessage?.artifacts?.find((artifact) => artifact.kind === 'DRAFT_WORKFLOW');

    if (!draftArtifact) {
      return this.appendMessage({
        sessionId: session._id.toString(),
        workspaceId,
        userId,
        role: 'assistant',
        content:
          'No draft workflow exists in this session yet. Ask me to build a workflow first, then I can modify it.',
        intent: 'MODIFY_WORKFLOW',
        status: 'INTENT_UNSUPPORTED',
      });
    }

    const plan = this.buildChangePlan(draftArtifact.data, userMessage.content);

    await this.auditCopilot('AI_COPILOT_MESSAGE_SENT', workspaceId, userId, session._id.toString(), {
      intent: 'MODIFY_WORKFLOW',
      planId: plan.planId,
      actions: plan.actions.length,
      requiresApproval: plan.requiresApproval,
    });

    return this.appendMessage({
      sessionId: session._id.toString(),
      workspaceId,
      userId,
      role: 'assistant',
      content:
        `Prepared a change plan with ${plan.actions.length} action(s) for draft ` +
        `"${plan.basedOnWorkflowName}". The plan requires approval before it is applied.`,
      intent: 'MODIFY_WORKFLOW',
      status: 'COMPLETED',
      artifacts: [{ kind: 'CHANGE_PLAN', data: plan }],
    });
  }

  /**
   * EXPLAIN: produce an AI-safe, registry-driven explanation of a workflow
   * (by ID in the message, or the latest draft in this session).
   */
  private async handleExplain(
    session: ICopilotSession,
    userMessage: ICopilotMessage,
    userId: Types.ObjectId,
    workspaceId: Types.ObjectId,
  ): Promise<ICopilotMessage> {
    const workflowId = this.extractObjectId(userMessage.content);

    let nodes: Array<{ id: string; type: string }> = [];
    let edges: Array<{ source: string; target: string; condition?: string }> = [];
    let explainedName: string;
    let explainedId: string | null = workflowId;

    if (workflowId) {
      const workflow = await WorkflowModel.findOne({ _id: workflowId, workspaceId });
      if (!workflow) {
        return this.appendMessage({
          sessionId: session._id.toString(),
          workspaceId,
          userId,
          role: 'assistant',
          content: `Workflow ${workflowId} was not found in this workspace.`,
          intent: 'EXPLAIN_WORKFLOW',
          status: 'NEEDS_REVIEW',
        });
      }
      const definition = (workflow.draftDefinition ?? {}) as {
        nodes?: Array<{ id: string; type: string }>;
        edges?: Array<{ source: string; target: string; condition?: string }>;
      };
      nodes = definition.nodes ?? [];
      edges = definition.edges ?? [];
      explainedName = (workflow as { name?: string }).name ?? workflowId;
    } else {
      const draft = await this.getLatestDraftArtifact(session._id.toString());
      if (!draft) {
        return this.appendMessage({
          sessionId: session._id.toString(),
          workspaceId,
          userId,
          role: 'assistant',
          content:
            'Tell me which workflow to explain (include its ID), or build a draft in this session first.',
          intent: 'EXPLAIN_WORKFLOW',
          status: 'NEEDS_REVIEW',
        });
      }
      const data = draft.data as {
        workflowName?: string;
        definition?: { nodes?: Array<{ id: string; type: string }>; edges?: Array<{ source: string; target: string; condition?: string }> };
      };
      nodes = data.definition?.nodes ?? [];
      edges = data.definition?.edges ?? [];
      explainedName = data.workflowName ?? 'Untitled draft';
      explainedId = null;
    }

    const explanation = this.buildExplanation(explainedName, nodes, edges);

    await this.auditCopilot('AI_COPILOT_MESSAGE_SENT', workspaceId, userId, session._id.toString(), {
      intent: 'EXPLAIN_WORKFLOW',
      workflowId: explainedId,
      nodesCount: nodes.length,
    });

    return this.appendMessage({
      sessionId: session._id.toString(),
      workspaceId,
      userId,
      role: 'assistant',
      content: explanation.summary,
      intent: 'EXPLAIN_WORKFLOW',
      status: 'COMPLETED',
      artifacts: [{ kind: 'EXPLANATION', data: explanation }],
    });
  }

  /**
   * VALIDATE: run graph validation against a stored workflow (by ID) or the
   * latest draft artifact, and return a structured validation report.
   */
  private async handleValidate(
    session: ICopilotSession,
    userMessage: ICopilotMessage,
    userId: Types.ObjectId,
    workspaceId: Types.ObjectId,
  ): Promise<ICopilotMessage> {
    const workflowId = this.extractObjectId(userMessage.content);

    let definition: unknown;
    let validatedId: string | null = workflowId;
    let displayName: string;

    if (workflowId) {
      const workflow = await WorkflowModel.findOne({ _id: workflowId, workspaceId });
      if (!workflow) {
        return this.appendMessage({
          sessionId: session._id.toString(),
          workspaceId,
          userId,
          role: 'assistant',
          content: `Workflow ${workflowId} was not found in this workspace.`,
          intent: 'VALIDATE_WORKFLOW',
          status: 'NEEDS_REVIEW',
        });
      }
      definition = workflow.draftDefinition;
      displayName = workflow.name ?? workflowId;
    } else {
      const draft = await this.getLatestDraftArtifact(session._id.toString());
      if (!draft) {
        return this.appendMessage({
          sessionId: session._id.toString(),
          workspaceId,
          userId,
          role: 'assistant',
          content: 'Tell me which workflow to validate (include its ID), or build a draft in this session first.',
          intent: 'VALIDATE_WORKFLOW',
          status: 'NEEDS_REVIEW',
        });
      }
      const data = draft.data as { workflowName?: string; definition?: unknown };
      definition = data.definition ?? {};
      displayName = data.workflowName ?? 'Untitled draft';
      validatedId = null;
    }

    const validation = AISecurityService.validateGeneratedWorkflow(definition);
    const errors = (validation.errors ?? []).map((error) => ({
      type: String(error.type),
      message: error.message,
      ...(error.nodeId ? { nodeId: error.nodeId } : {}),
    }));
    const nodeTypes = (definition as { nodes?: Array<{ type: string }> }).nodes?.map((node) => node.type) ?? [];
    const riskLevel = this.registry.maxRiskLevel(nodeTypes);
    const report = { workflowId: validatedId, workflowName: displayName, isValid: validation.isValid, errors, riskLevel };

    await this.auditCopilot('AI_COPILOT_MESSAGE_SENT', workspaceId, userId, session._id.toString(), {
      intent: 'VALIDATE_WORKFLOW', isValid: report.isValid, errorCount: errors.length,
    });

    return this.appendMessage({
      sessionId: session._id.toString(),
      workspaceId,
      userId,
      role: 'assistant',
      content: report.isValid
        ? `"${displayName}" passed graph validation with no errors (risk level: ${riskLevel}).`
        : `"${displayName}" failed graph validation with ${errors.length} error(s). See the validation report artifact.`,
      intent: 'VALIDATE_WORKFLOW',
      status: 'COMPLETED',
      artifacts: [{ kind: 'VALIDATION_REPORT', data: report }],
    });
  }

  /**
   * Auto Repair Loop: validate a draft, and on errors feed the validation
   * errors + the node capability registry back to the provider for a retry.
   * Retries up to MAX_REPAIR_ATTEMPTS times, then returns the last draft.
   */
  async generateDraftWithRepair(
    workspaceId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    prompt: string,
  ): Promise<{
    draft: GenerateWorkflowResult['draftWorkflow'];
    validation: GenerateWorkflowResult['validation'];
    repairAttempts: CopilotRepairAttempt[];
    repaired: boolean;
  }> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const uid = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const providerResult = await AIProviderFactory.getProviderForWorkspace(wsId, 'workflowGeneration');
    const validatedPrompt = AISecurityService.validatePrompt(prompt);
    const sanitizedPrompt = AISecurityService.sanitizePrompt(validatedPrompt);

    const governance = await AIGovernanceGate.getInstance().authorize({
      workspaceId: wsId.toString(),
      userId: uid.toString(),
      feature: 'AI_WORKFLOW_CREATE',
      model: providerResult.model,
      prompt: sanitizedPrompt,
    });
    if (governance.decision === 'DENY') throw new Error('AI_GOVERNANCE_DENIED');
    if (governance.decision === 'REQUIRE_APPROVAL') throw new Error('AI_GOVERNANCE_APPROVAL_REQUIRED');
    const governedPrompt = governance.redactedPrompt ?? sanitizedPrompt;

    let generated = await providerResult.provider.generateWorkflow(governedPrompt, {
      systemContext: this.registry.buildGenerationContext(),
    });
    let result = this.normalizeDraft(generated, sanitizedPrompt);
    const repairAttempts: CopilotRepairAttempt[] = [];

    for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS && !result.validation.isValid; attempt += 1) {
      const errors = result.validation.errors.map((error) => ({
        type: String(error.type),
        message: error.message,
        ...(error.nodeId ? { nodeId: error.nodeId } : {}),
      }));
      repairAttempts.push({ attempt, validationErrors: errors });
      const repairPrompt =
        `${sanitizedPrompt}\n\n` +
        `Previous draft failed validation (attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}).\n` +
        this.registry.buildRepairContext(result.validation.errors) +
        `\nRegenerate the complete workflow JSON honoring every constraint above.`;
      generated = await providerResult.provider.generateWorkflow(repairPrompt, {
        systemContext: this.registry.buildGenerationContext(),
      });
      result = this.normalizeDraft(generated, sanitizedPrompt);
    }

    await AIUsageService.recordUsage({ workspaceId: wsId, userId: uid, feature: 'workflow_generation', model: providerResult.model });

    return {
      draft: result.draftWorkflow,
      validation: result.validation,
      repairAttempts,
      repaired: repairAttempts.length > 0 && result.validation.isValid,
    };
  }

  private normalizeDraft(generated: GeneratedWorkflow, sanitizedPrompt: string): GenerateWorkflowResult {
    const nodes = (generated.nodes || []).map((node) => ({
      id: node.id,
      type: node.type,
      config: node.config || {},
    }));
    const edges = (generated.connections || []).map((conn) => ({
      source: conn.source || conn.from || '',
      target: conn.target || conn.to || '',
      ...(conn.condition ? { condition: conn.condition } : {}),
    }));
    const definitionCandidate: WorkflowDefinitionInput = { nodes: nodes as never, edges: edges as never };
    const validation = AISecurityService.validateGeneratedWorkflow(definitionCandidate);
    return {
      draftWorkflow: {
        workflowName: generated.workflowName || 'AI Generated Workflow',
        description: generated.description || `Draft: ${sanitizedPrompt.slice(0, 60)}`,
        nodes,
        connections: generated.connections || [],
        variables: generated.variables || {},
        definition: definitionCandidate,
        status: 'DRAFT',
        isPublished: false,
        riskLevel: this.registry.maxRiskLevel(nodes.map((node) => node.type)),
      },
      validation: { isValid: validation.isValid, errors: validation.errors },
      suggestedTemplateName: generated.workflowName ? `${generated.workflowName} Template` : 'Automated Workflow Template',
    };
  }

  private extractObjectId(text: string): string | null {
    const match = (text ?? '').match(/\b[0-9a-fA-F]{24}\b/);
    return match?.[0] ?? null;
  }

  private async getLatestDraftArtifact(sessionId: string): Promise<CopilotArtifact | null> {
    const message = (await CopilotMessageModel
      .findOne({ sessionId: new Types.ObjectId(sessionId), 'artifacts.kind': 'DRAFT_WORKFLOW' })
      .sort({ createdAt: -1 })
      .lean()) as unknown as ICopilotMessage | null;
    return message?.artifacts?.find((artifact) => artifact.kind === 'DRAFT_WORKFLOW') ?? null;
  }

  private buildChangePlan(draftData: unknown, instruction: string): {
    planId: string;
    basedOnWorkflowName: string;
    actions: Array<{ action: string; nodeId?: string; detail: string }>;
    requiresApproval: boolean;
  } {
    const data = (draftData ?? {}) as {
      workflowName?: string;
      definition?: { nodes?: Array<{ id: string; type: string }> };
    };
    const nodes = data.definition?.nodes ?? [];
    const actions: Array<{ action: string; nodeId?: string; detail: string }> = [];
    const text = (instruction ?? '').toLowerCase();
    if (/\b(add|insert|include)\b/.test(text)) {
      actions.push({
        action: 'ADD_NODE',
        detail: `Add the requested step using one of: ${this.registry.listTypes().join(', ')}. Requires approval.`,
      });
    }
    if (/\b(remove|delete|drop)\b/.test(text)) {
      for (const node of nodes.slice(0, 3)) {
        actions.push({ action: 'REMOVE_NODE', nodeId: node.id, detail: `Remove node '${node.id}' (${node.type}).` });
      }
    }
    if (actions.length === 0) {
      actions.push({
        action: 'UPDATE_WORKFLOW',
        detail: `Apply requested change: "${instruction.slice(0, 200)}". Regenerate and re-validate before publishing.`,
      });
    }
    return {
      planId: new Types.ObjectId().toString(),
      basedOnWorkflowName: data.workflowName ?? 'Untitled draft',
      actions,
      requiresApproval: true,
    };
  }

  private buildExplanation(
    name: string,
    nodes: Array<{ id: string; type: string }>,
    edges: Array<{ source: string; target: string; condition?: string }>,
  ): { workflowName: string; summary: string; steps: Array<{ id: string; type: string; description: string }>; riskLevel: string } {
    const steps = nodes.map((node, index) => {
      const capability = this.registry.getCapability(node.type);
      return {
        id: node.id,
        type: node.type,
        description: `Step ${index + 1}: ${capability?.displayName ?? node.type} - ${capability?.aiDescription ?? 'Custom node'}`,
      };
    });
    const riskLevel = this.registry.maxRiskLevel(nodes.map((node) => node.type));
    const summary = nodes.length === 0
      ? `"${name}" has no steps yet.`
      : `"${name}" runs ${nodes.length} step(s) across ${edges.length} connection(s): ` +
        steps.map((step) => `${step.id} (${step.type})`).join(' -> ') +
        `. Highest node risk: ${riskLevel}.`;
    return { workflowName: name, summary, steps, riskLevel };
  }

  private toSessionPayload(session: ICopilotSession): CopilotSessionPayload {
    return {
      id: session._id.toString(),
      workspaceId: session.workspaceId.toString(),
      userId: session.userId.toString(),
      title: session.title,
      status: session.status,
      intentCounts: { ...session.intentCounts },
      lastMessageAt: session.lastMessageAt ? new Date(session.lastMessageAt).toISOString() : null,
      createdAt: new Date(session.createdAt ?? Date.now()).toISOString(),
      updatedAt: new Date(session.updatedAt ?? Date.now()).toISOString(),
    };
  }

  private toMessagePayload(message: ICopilotMessage): CopilotMessagePayload {
    const raw = message as unknown as { _id: Types.ObjectId; sessionId: Types.ObjectId | string; createdAt?: Date };
    return {
      id: raw._id.toString(),
      sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : raw.sessionId.toString(),
      role: message.role,
      content: message.content,
      intent: message.intent ?? null,
      status: message.status,
      artifacts: message.artifacts ?? [],
      repairCount: message.repairCount ?? (message.repairAttempts?.length ?? 0),
      repairAttempts: (message.repairAttempts ?? []).map((attempt) => ({
        attempt: attempt.attempt,
        validationErrors: attempt.validationErrors ?? [],
      })),
      createdAt: new Date(raw.createdAt ?? Date.now()).toISOString(),
    };
  }

  private async auditCopilot(
    action: 'AI_COPILOT_SESSION_CREATED' | 'AI_COPILOT_MESSAGE_SENT',
    workspaceId: Types.ObjectId,
    userId: Types.ObjectId,
    sessionId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await createAuditLog({
      action,
      userId,
      workspaceId,
      resource: 'copilot_session',
      resourceId: sessionId,
      metadata: AISecurityService.sanitizeMetadata(metadata),
    });
  }
}

export const MAX_REPAIR_ATTEMPTS = 3;

export default AICopilotService.getInstance();

