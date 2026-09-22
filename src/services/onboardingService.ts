import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import {
  OnboardingSessionModel,
  ONBOARDING_STEPS,
  REQUIRED_ONBOARDING_STEPS,
} from '../models/OnboardingSessionModel.js';
import type { IOnboardingSession, OnboardingStep } from '../models/OnboardingSessionModel.js';

type OnboardingSessionDoc = HydratedDocument<IOnboardingSession>;
import { TenantAccountModel } from '../models/TenantAccountModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { solutionTemplateService } from './solutionTemplateService.js';
import type { SolutionId } from './solutionTemplateService.js';
import { createWorkflow } from './workflowService.js';
import { inviteMember } from './memberService.js';
import { conversionTrackingService } from './conversionTrackingService.js';
import { createAuditLog } from './auditService.js';
import type { WorkspaceRole } from '../models/WorkspaceMemberModel.js';

/**
 * Phase 15.5 - Customer onboarding wizard.
 *
 * Drives the guided activation flow on top of existing services: the workspace
 * already exists (the caller is a member), industry selection picks a
 * recommended packaged solution, the solution installs through
 * solutionTemplateService, the first workflow is created through the existing
 * workflow service and the first invitation goes through memberService. State
 * lives in OnboardingSessionModel; the coarse record stays on
 * TenantAccountModel.onboarding.
 */

/** Industry -> recommended packaged solution. */
export const INDUSTRY_SOLUTION_MAP: Record<string, SolutionId> = {
  Technology: 'customer-support-automation',
  'Financial Services': 'finance-approval-automation',
  Healthcare: 'customer-support-automation',
  Retail: 'sales-automation',
  Manufacturing: 'it-helpdesk-automation',
  Logistics: 'it-helpdesk-automation',
  'Professional Services': 'sales-automation',
  Telecommunications: 'customer-support-automation',
  'Public Sector': 'finance-approval-automation',
  Other: 'customer-support-automation',
};

const STARTER_WORKFLOW_NAME = 'Getting started';

export interface OnboardingStepView {
  step: OnboardingStep;
  status: 'COMPLETED' | 'SKIPPED' | 'CURRENT' | 'PENDING';
  required: boolean;
}

export interface OnboardingProgress {
  workspaceId: string;
  status: IOnboardingSession['status'];
  currentStep: OnboardingStep;
  completedSteps: string[];
  skippedSteps: string[];
  selectedIndustry: string | null;
  selectedSolution: string | null;
  recommendedSolution: SolutionId | null;
  steps: OnboardingStepView[];
  startedAt: Date;
  completedAt: Date | null;
}

export interface OnboardingStartResult {
  session: OnboardingProgress;
  created: boolean;
}

function toProgress(session: OnboardingSessionDoc | IOnboardingSession): OnboardingProgress {
  const completed = new Set(session.completedSteps);
  const skipped = new Set(session.skippedSteps);
  const steps: OnboardingStepView[] = ONBOARDING_STEPS.map((step) => ({
    step,
    status: completed.has(step)
      ? 'COMPLETED'
      : skipped.has(step)
        ? 'SKIPPED'
        : step === session.currentStep && session.status === 'IN_PROGRESS'
          ? 'CURRENT'
          : 'PENDING',
    required: REQUIRED_ONBOARDING_STEPS.includes(step),
  }));

  return {
    workspaceId: session.workspaceId.toString(),
    status: session.status,
    currentStep: session.currentStep,
    completedSteps: session.completedSteps,
    skippedSteps: session.skippedSteps,
    selectedIndustry: session.selectedIndustry,
    selectedSolution: session.selectedSolution,
    recommendedSolution: session.selectedIndustry
      ? (INDUSTRY_SOLUTION_MAP[session.selectedIndustry] ?? 'customer-support-automation')
      : null,
    steps,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
  };
}

function nextStep(completed: Set<string>): OnboardingStep {
  const remaining = ONBOARDING_STEPS.find((step) => !completed.has(step));
  return remaining ?? 'invite_team';
}

export class OnboardingService {
  /** Start (or resume) the wizard for a workspace. */
  async startOnboarding(workspaceId: string, userId: string): Promise<OnboardingStartResult> {
    const workspaceIdObj = new Types.ObjectId(workspaceId);
    const workspace = await WorkspaceModel.findById(workspaceIdObj).select('_id').lean();
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

    let session = await OnboardingSessionModel.findOne({ workspaceId: workspaceIdObj });
    let created = false;
    if (!session) {
      session = await OnboardingSessionModel.create({
        workspaceId: workspaceIdObj,
        userId: new Types.ObjectId(userId),
        currentStep: 'create_workspace',
        status: 'IN_PROGRESS',
        completedSteps: ['create_workspace'],
        skippedSteps: [],
        startedAt: new Date(),
      });
      created = true;
      await this.syncTenantOnboarding(workspaceIdObj, ['create_workspace'], false);
      await createAuditLog({
        action: 'ONBOARDING_STARTED',
        userId,
        workspaceId: workspaceIdObj,
        resource: 'onboarding_session',
        resourceId: session._id.toString(),
        metadata: { steps: [...ONBOARDING_STEPS] },
      });
      await conversionTrackingService.recordSafely({
        event: 'SIGNUP_STARTED',
        workspaceId,
        userId,
        source: 'ONBOARDING',
      });
    }

    session.currentStep = nextStep(new Set(session.completedSteps));
    await session.save();
    return { session: toProgress(session), created };
  }

  /** Current wizard state. */
  async getProgress(workspaceId: string): Promise<OnboardingProgress> {
    const workspaceIdObj = new Types.ObjectId(workspaceId);
    const session = await OnboardingSessionModel.findOne({ workspaceId: workspaceIdObj });
    if (!session) throw new Error('ONBOARDING_NOT_STARTED');
    return toProgress(session);
  }

  /** Step 2 - record the industry and resolve the recommended solution. */
  async selectIndustry(workspaceId: string, userId: string, industry: string): Promise<OnboardingProgress> {
    const session = await this.requireSession(workspaceId);
    const normalized = industry.trim();
    const recommended = INDUSTRY_SOLUTION_MAP[normalized] ?? 'customer-support-automation';

    session.selectedIndustry = normalized;
    session.selectedSolution = recommended;
    await this.markStep(session, 'select_industry', userId, { industry: normalized, recommendedSolution: recommended });
    return toProgress(session);
  }

  /** Step 3 - install the recommended (or explicitly chosen) packaged solution. */
  async installRecommendedSolution(
    workspaceId: string,
    userId: string,
    solutionId?: string | undefined,
  ): Promise<{ progress: OnboardingProgress; installed: { solutionId: string; workflowIds: string[]; agentIds: string[] } }> {
    const session = await this.requireSession(workspaceId);
    const target = solutionId
      ?? session.selectedSolution
      ?? (session.selectedIndustry ? INDUSTRY_SOLUTION_MAP[session.selectedIndustry] : undefined)
      ?? 'customer-support-automation';

    const solution = solutionTemplateService.getSolution(target);
    const result = await solutionTemplateService.install(solution.id, { workspaceId, userId });

    session.selectedSolution = solution.id;
    await this.markStep(session, 'install_solution', userId, {
      solutionId: solution.id,
      workflows: result.workflowIds.length,
      agents: result.agentIds.length,
      skipped: result.skipped.length,
    });

    return {
      progress: toProgress(session),
      installed: {
        solutionId: solution.id,
        workflowIds: result.workflowIds,
        agentIds: result.agentIds,
      },
    };
  }

  /** Step 4 - create the first workflow through the existing workflow service. */
  async createFirstWorkflow(
    workspaceId: string,
    userId: string,
    name?: string | undefined,
  ): Promise<{ progress: OnboardingProgress; workflowId: string }> {
    const session = await this.requireSession(workspaceId);
    const definition = {
      nodes: [
        { id: 'trigger', type: 'webhook' as const, config: {} },
        { id: 'log', type: 'log' as const, config: { message: 'First workflow payload received' } },
      ],
      edges: [{ source: 'trigger', target: 'log' }],
    };
    const created = await createWorkflow(name?.trim() || STARTER_WORKFLOW_NAME, definition, userId, workspaceId);
    const workflowId = String((created as { _id: unknown })._id);

    await this.markStep(session, 'create_workflow', userId, { workflowId });
    return { progress: toProgress(session), workflowId };
  }

  /** Step 5 - invite the first teammate through memberService. */
  async inviteTeamMember(
    workspaceId: string,
    actorUserId: string,
    input: { email: string; role?: WorkspaceRole | undefined },
  ): Promise<{ progress: OnboardingProgress; memberId: string }> {
    const session = await this.requireSession(workspaceId);
    const membership = await inviteMember(workspaceId, actorUserId, {
      email: input.email,
      ...(input.role !== undefined ? { role: input.role } : {}),
    });

    await this.markStep(session, 'invite_team', actorUserId, { email: input.email, role: membership.role });
    return { progress: toProgress(session), memberId: membership.id };
  }

  /** Skip an optional step so the wizard can finish without it. */
  async skipStep(workspaceId: string, userId: string, step: OnboardingStep): Promise<OnboardingProgress> {
    const session = await this.requireSession(workspaceId);
    if (REQUIRED_ONBOARDING_STEPS.includes(step)) throw new Error('ONBOARDING_STEP_REQUIRED');
    if (!session.skippedSteps.includes(step)) session.skippedSteps.push(step);
    await this.markStep(session, step, userId, { skipped: true });
    return toProgress(session);
  }

  /** Finish the wizard once the required steps are complete. */
  async completeOnboarding(workspaceId: string, userId: string): Promise<OnboardingProgress> {
    const session = await this.requireSession(workspaceId);
    const completed = new Set(session.completedSteps);
    const missing = REQUIRED_ONBOARDING_STEPS.filter((step) => !completed.has(step));
    if (missing.length > 0) throw new Error('ONBOARDING_INCOMPLETE');

    session.status = 'COMPLETED';
    session.completedAt = new Date();
    session.currentStep = 'invite_team';
    await session.save();

    await this.syncTenantOnboarding(session.workspaceId, session.completedSteps, true);
    await createAuditLog({
      action: 'ONBOARDING_COMPLETED',
      userId,
      workspaceId: session.workspaceId,
      resource: 'onboarding_session',
      resourceId: session._id.toString(),
      metadata: {
        completedSteps: session.completedSteps,
        skippedSteps: session.skippedSteps,
        industry: session.selectedIndustry,
        solution: session.selectedSolution,
        durationMs: session.completedAt.getTime() - session.startedAt.getTime(),
      },
    });
    await conversionTrackingService.recordSafely({
      event: 'SIGNUP_COMPLETED',
      workspaceId,
      userId,
      source: 'ONBOARDING',
    });

    return toProgress(session);
  }

  /** Shared step completion: persist, cascade, audit. */
  private async markStep(
    session: OnboardingSessionDoc,
    step: OnboardingStep,
    actorUserId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!session.completedSteps.includes(step)) session.completedSteps.push(step);
    session.currentStep = nextStep(new Set(session.completedSteps));
    await session.save();

    await this.syncTenantOnboarding(session.workspaceId, session.completedSteps, false);
    await createAuditLog({
      action: 'ONBOARDING_STEP_COMPLETED',
      userId: actorUserId,
      workspaceId: session.workspaceId,
      resource: 'onboarding_session',
      resourceId: session._id.toString(),
      metadata: { step, ...metadata },
    });
  }

  /** Mirror wizard progress onto the existing tenant onboarding record. */
  private async syncTenantOnboarding(
    workspaceId: Types.ObjectId,
    steps: string[],
    completed: boolean,
  ): Promise<void> {
    const update: Record<string, unknown> = {
      'onboarding.steps': steps,
      'onboarding.completed': completed,
    };
    if (completed) update['onboarding.completedAt'] = new Date();
    await TenantAccountModel.updateOne({ workspaceId }, { $set: update });
  }

  private async requireSession(workspaceId: string) {
    const workspaceIdObj = new Types.ObjectId(workspaceId);
    const session = await OnboardingSessionModel.findOne({ workspaceId: workspaceIdObj });
    if (!session) throw new Error('ONBOARDING_NOT_STARTED');
    return session;
  }
}

export const onboardingService = new OnboardingService();
