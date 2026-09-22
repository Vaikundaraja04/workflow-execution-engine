import mongoose, { Schema, Types } from 'mongoose';

/**
 * Phase 15.5 - Customer onboarding wizard state.
 *
 * One session per workspace tracks the guided activation flow:
 * create_workspace -> select_industry -> install_solution -> create_workflow ->
 * invite_team. TenantAccountModel.onboarding stays the coarse record; this model
 * holds the step-level state the wizard renders.
 */

export const ONBOARDING_STEPS = [
  'create_workspace',
  'select_industry',
  'install_solution',
  'create_workflow',
  'invite_team',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Steps that must complete before the wizard can finish. */
export const REQUIRED_ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'create_workspace',
  'select_industry',
];

export const ONBOARDING_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'ABANDONED'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export interface IOnboardingSession {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  currentStep: OnboardingStep;
  status: OnboardingStatus;
  selectedIndustry: string | null;
  selectedSolution: string | null;
  completedSteps: string[];
  skippedSteps: string[];
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const OnboardingSessionSchema = new Schema<IOnboardingSession>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  currentStep: { type: String, enum: [...ONBOARDING_STEPS], required: true, default: 'create_workspace' },
  status: { type: String, enum: [...ONBOARDING_STATUSES], required: true, default: 'IN_PROGRESS' },
  selectedIndustry: { type: String, maxlength: 80, default: null },
  selectedSolution: { type: String, maxlength: 80, default: null },
  completedSteps: { type: [String], default: [] },
  skippedSteps: { type: [String], default: [] },
  startedAt: { type: Date, required: true, default: Date.now },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

OnboardingSessionSchema.index({ status: 1, updatedAt: -1 });
OnboardingSessionSchema.index({ userId: 1, status: 1 });

export const OnboardingSessionModel = mongoose.model<IOnboardingSession>('OnboardingSession', OnboardingSessionSchema);

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value);
}
