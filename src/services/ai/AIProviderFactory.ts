import { Types } from 'mongoose';
import type { AIProvider } from './AIProvider.js';
import { MockAIProvider } from './MockAIProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { AIConfigurationModel } from '../../models/AIConfigurationModel.js';
import type { EvaluateRequestInput } from '../aiGovernancePolicyService.js';
import type { GovernedProviderResult } from '../aiGovernanceGate.js';

export class AIProviderFactory {
  private static mockInstance: AIProvider = new MockAIProvider();

  /**
   * Get the current mock provider instance.
   */
  static getMockInstance(): AIProvider {
    return this.mockInstance;
  }

  /**
   * Set a custom mock or test provider instance.
   */
  static setMockProvider(provider: AIProvider): void {
    this.mockInstance = provider;
  }

  /**
   * Reset mock provider to default MockAIProvider.
   */
  static resetMockProvider(): void {
    this.mockInstance = new MockAIProvider();
  }

  /**
   * Get a governance-checked provider for an AI operation (Phase 12.6).
   * Runs the governance gate first: DENY and REQUIRE_APPROVAL throw mapped errors;
   * ALLOW_REDACTED returns the sanitized prompt; THROTTLE uses cost-optimized routing.
   */
  static async getGovernedProviderForWorkspace(context: EvaluateRequestInput): Promise<GovernedProviderResult> {
    const { AIGovernanceGate } = await import('../aiGovernanceGate.js');
    return AIGovernanceGate.getInstance().authorizeProvider(context);
  }

  /**
   * Get an AI provider for a given workspace.
   */
  static async getProviderForWorkspace(
    workspaceId?: Types.ObjectId | string | null,
    feature?: 'workflowGeneration' | 'failureAnalysis' | 'optimization'
  ): Promise<{ provider: AIProvider; model: string; providerName: string }> {
    if (!workspaceId || !Types.ObjectId.isValid(workspaceId.toString())) {
      return { provider: this.mockInstance, model: 'mock-model', providerName: 'mock' };
    }

    try {
      const config = await AIConfigurationModel.findOne({
        workspaceId: typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId,
      });

      if (!config) {
        return { provider: this.mockInstance, model: 'mock-model', providerName: 'mock' };
      }

      if (!config.enabled) {
        throw new Error('AI_FEATURE_DISABLED: AI features are disabled for this workspace');
      }

      if (feature && !config.features[feature]) {
        throw new Error(`AI_FEATURE_DISABLED: The '${feature}' AI feature is disabled for this workspace`);
      }

      const model = config.model || 'default';

      if (config.provider === 'mock') {
        return { provider: this.mockInstance, model, providerName: 'mock' };
      }

      if (config.provider === 'openai') {
        const apiKey = config.getDecryptedApiKey();
        return {
          provider: new OpenAIProvider(apiKey, config.model),
          model: config.model,
          providerName: 'openai',
        };
      }

      if (config.provider === 'anthropic') {
        const apiKey = config.getDecryptedApiKey();
        return {
          provider: new AnthropicProvider(apiKey, config.model),
          model: config.model,
          providerName: 'anthropic',
        };
      }

      if (config.provider === 'gemini') {
        const apiKey = config.getDecryptedApiKey();
        return {
          provider: new OpenAIProvider(apiKey, config.model, 'https://generativelanguage.googleapis.com/v1beta/openai'),
          model: config.model,
          providerName: 'gemini',
        };
      }

      if (config.provider === 'openrouter') {
        const apiKey = config.getDecryptedApiKey();
        return {
          provider: new OpenAIProvider(apiKey, config.model, 'https://openrouter.ai/api/v1'),
          model: config.model,
          providerName: 'openrouter',
        };
      }

      return { provider: this.mockInstance, model, providerName: 'mock' };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('AI_FEATURE_DISABLED')) {
        throw error;
      }
      // Fallback to mock on error in testing environments
      return { provider: this.mockInstance, model: 'mock-model', providerName: 'mock' };
    }
  }
}
