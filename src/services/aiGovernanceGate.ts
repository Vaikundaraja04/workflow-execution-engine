import { AIGovernancePolicyService } from './aiGovernancePolicyService.js';
import type {
  AIGovernanceDecision,
  EvaluateRequestInput,
} from './aiGovernancePolicyService.js';
import { AIProviderFactory } from './ai/AIProviderFactory.js';
import { AIModelRouter } from './ai/aiModelRouter.js';
import type { AIProvider } from './ai/AIProvider.js';

export interface GovernedProviderResult {
  provider: AIProvider;
  model: string;
  providerName: string;
  decision: AIGovernanceDecision;
  prompt?: string;
  throttled: boolean;
}

export interface GovernedExecutionContext {
  prompt?: string;
  provider: AIProvider;
  model: string;
  providerName: string;
  throttled: boolean;
  decision: AIGovernanceDecision;
}

export type GovernedRunResult<T> =
  | { status: 'COMPLETED'; result: T; decision: AIGovernanceDecision }
  | { status: 'PENDING_APPROVAL'; approvalId?: string; decision: AIGovernanceDecision };

function routerFeature(feature: EvaluateRequestInput['feature']): 'workflow_generation' | 'failure_analysis' | 'optimization' {
  if (feature === 'AI_ANALYSIS') return 'failure_analysis';
  if (feature === 'AI_OPTIMIZATION') return 'optimization';
  return 'workflow_generation';
}

function governanceError(code: string, decision: AIGovernanceDecision): Error {
  const error = new Error(code) as Error & { decision?: AIGovernanceDecision };
  error.decision = decision;
  return error;
}
export class AIGovernanceGate {
  private static instance: AIGovernanceGate;

  private constructor() {}

  public static getInstance(): AIGovernanceGate {
    if (!AIGovernanceGate.instance) {
      AIGovernanceGate.instance = new AIGovernanceGate();
    }
    return AIGovernanceGate.instance;
  }

  /** Evaluate governance for an AI operation without executing it. */
  async authorize(input: EvaluateRequestInput): Promise<AIGovernanceDecision> {
    return AIGovernancePolicyService.getInstance().evaluateRequest(input);
  }

  /**
   * Evaluate governance and resolve a provider for allowed operations.
   * Throws AI_GOVERNANCE_DENIED and AI_GOVERNANCE_APPROVAL_REQUIRED (with the
   * decision attached) so HTTP layers map them to the standard error envelope.
   * When throttled, routing falls back to the cost-optimized router path.
   */
  async authorizeProvider(input: EvaluateRequestInput): Promise<GovernedProviderResult> {
    const decision = await this.authorize(input);
    if (decision.decision === 'DENY') {
      throw governanceError('AI_GOVERNANCE_DENIED', decision);
    }
    if (decision.decision === 'REQUIRE_APPROVAL') {
      throw governanceError('AI_GOVERNANCE_APPROVAL_REQUIRED', decision);
    }

    let provider: AIProvider;
    let model: string;
    let providerName: string;
    if (decision.throttled) {
      const routed = await AIModelRouter.getInstance().selectProviderForTask(
        input.workspaceId,
        input.prompt ?? input.feature,
        routerFeature(input.feature),
      );
      provider = routed.provider;
      model = routed.model;
      providerName = routed.providerName;
    } else {
      const resolved = await AIProviderFactory.getProviderForWorkspace(input.workspaceId, input.feature === 'AI_OPTIMIZATION' ? 'optimization' : undefined);
      provider = resolved.provider;
      model = resolved.model;
      providerName = resolved.providerName;
    }

    const result: GovernedProviderResult = {
      provider,
      model,
      providerName,
      decision,
      throttled: decision.throttled,
    };
    if (decision.redactedPrompt !== undefined) result.prompt = decision.redactedPrompt;
    return result;
  }
  /**
   * Evaluate governance and run the executor when the operation is allowed.
   * Returns a PENDING_APPROVAL result instead of executing when human approval
   * is required; throws AI_GOVERNANCE_DENIED when the operation is denied.
   */
  async runGoverned<T>(
    input: EvaluateRequestInput,
    executor: (context: GovernedExecutionContext) => Promise<T>,
  ): Promise<GovernedRunResult<T>> {
    let governed: GovernedProviderResult;
    try {
      governed = await this.authorizeProvider(input);
    } catch (error) {
      const approvalError = error as Error & { decision?: AIGovernanceDecision };
      if (
        error instanceof Error
        && error.message === 'AI_GOVERNANCE_APPROVAL_REQUIRED'
        && approvalError.decision !== undefined
      ) {
        const pending: GovernedRunResult<T> = { status: 'PENDING_APPROVAL', decision: approvalError.decision };
        if (approvalError.decision.approvalId) pending.approvalId = approvalError.decision.approvalId;
        return pending;
      }
      throw error;
    }
    const prompt = governed.prompt ?? input.prompt;
    const context: GovernedExecutionContext = {
      provider: governed.provider,
      model: governed.model,
      providerName: governed.providerName,
      throttled: governed.throttled,
      decision: governed.decision,
    };
    if (prompt !== undefined) context.prompt = prompt;
    const result = await executor(context);
    return { status: 'COMPLETED', result, decision: governed.decision };
  }
}

export default AIGovernanceGate.getInstance();