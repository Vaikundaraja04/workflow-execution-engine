import { Types } from 'mongoose';
import { AIModelRouterConfigModel, type IAIModelRouterConfig } from '../../models/AIModelRouterConfigModel.js';
import { AIProviderFactory } from './AIProviderFactory.js';
import { AIGovernanceService } from './aiGovernanceService.js';
import type {
  AIProvider,
  AIGenerationOptions,
  GeneratedWorkflow,
  ExecutionAnalysisResult,
  OptimizationResult,
  ExecutionAnalysisInput,
  WorkflowOptimizationInput,
} from './AIProvider.js';

export type AIModelRouterConfig = IAIModelRouterConfig;

export class AIModelRouter {
  private static instance: AIModelRouter;

  private constructor() {}

  public static getInstance(): AIModelRouter {
    if (!AIModelRouter.instance) {
      AIModelRouter.instance = new AIModelRouter();
    }
    return AIModelRouter.instance;
  }

  /**
   * Get AI model router configuration for a workspace
   */
  async getConfig(workspaceId: Types.ObjectId | string): Promise<IAIModelRouterConfig> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;

    let config = await AIModelRouterConfigModel.findOne({ workspaceId: wsId });
    if (!config) {
      // Create default configuration
      config = await AIModelRouterConfigModel.create({
        workspaceId: wsId,
        providerPriority: ['openai', 'anthropic', 'mock'],
        modelConfigs: {},
        complexityRules: {
          simple: {
            preferredProvider: 'openai',
            fallbackProvider: 'anthropic',
            maxCostPer1KTokens: 0.5
          },
          medium: {
            preferredProvider: 'openai',
            fallbackProvider: 'anthropic',
            maxCostPer1KTokens: 1.0
          },
          complex: {
            preferredProvider: 'openai',
            fallbackProvider: 'anthropic',
            maxCostPer1KTokens: 2.0
          }
        },
        enableFallback: true,
        enableCostOptimization: true,
        enableLatencyOptimization: false,
      });
    }

    return config;
  }

  /**
   * Determine task complexity based on prompt characteristics
   */
  private determineTaskComplexity(prompt: string): 'simple' | 'medium' | 'complex' {
    const wordCount = prompt.trim().split(/\s+/).length;
    const hasCode = /`{3,}|\{[\s\S]*\}|\[[\s\S]*\]/.test(prompt);
    const hasJson = /\{[\s\S]*\}|\[[\s\S]*\]/.test(prompt);

    if (wordCount > 200 || hasCode || hasJson) {
      return 'complex';
    } else if (wordCount > 50) {
      return 'medium';
    } else {
      return 'simple';
    }
  }

  /**
   * Select the best provider/model for a given task
   */
  async selectProviderForTask(
    workspaceId: Types.ObjectId | string,
    prompt: string,
    feature: 'workflow_generation' | 'failure_analysis' | 'optimization' | 'template_generation' = 'workflow_generation'
  ): Promise<{ provider: AIProvider; model: string; providerName: string; config: IAIModelRouterConfig }> {
    const wsId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const routerConfig = await this.getConfig(wsId);
    const governanceService = AIGovernanceService.getInstance();

    // Check if AI features are enabled for this workspace via governance
    try {
      await governanceService.getOrCreateBudget(wsId);
    } catch (_error) {
      // If we can't get budget, fall back to mock
      return {
        provider: AIProviderFactory.getMockInstance(),
        model: 'mock-model',
        providerName: 'mock',
        config: routerConfig
      };
    }

    // Determine task complexity
    const complexity = this.determineTaskComplexity(prompt);
    const complexityRule = routerConfig.complexityRules[complexity];

    // Get preferred provider for this complexity level
    const preferredProvider = complexityRule.preferredProvider;
    const fallbackProvider = complexityRule.fallbackProvider;
    const maxCostPer1KTokens = complexityRule.maxCostPer1KTokens;

    // Try providers in order: preferred, then fallback, then priority list
    const providerOrder = [
      preferredProvider,
      fallbackProvider,
      ...routerConfig.providerPriority.filter(p => p !== preferredProvider && p !== fallbackProvider)
    ];

    // Try each provider until we find one that works
    for (const providerId of providerOrder) {
      try {
        // Find the best model for this provider based on cost optimization
        let selectedModel = routerConfig.modelConfigs[providerId] ||
                          Object.values(routerConfig.modelConfigs).find(
                            (config: any) => config.provider === providerId
                          ) ||
                          { provider: providerId as any, modelName: 'default', maxTokens: 1000, temperature: 0.7, costPer1KTokens: 0.01, latencyMs: 1000 };

        // Apply cost optimization if enabled
        if (routerConfig.enableCostOptimization) {
          // Find the cheapest model that meets requirements
          const providerModels = Object.entries(routerConfig.modelConfigs)
            .filter(([_, modelConfig]: [string, any]) => modelConfig.provider === providerId)
            .map(([modelName, modelConfig]) => ({ ...(modelConfig as any), modelName }));

          if (providerModels.length > 0) {
            // Sort by cost per token (ascending)
            providerModels.sort((a, b) => a.costPer1KTokens - b.costPer1KTokens);
            const cheapestModel = providerModels[0];

            // Check if cheapest model meets complexity requirements
            if (cheapestModel && cheapestModel.costPer1KTokens <= maxCostPer1KTokens) {
              selectedModel = cheapestModel;
            }
          }
        }

        // Apply latency optimization if enabled
        if (routerConfig.enableLatencyOptimization && !routerConfig.enableCostOptimization) {
          // Find the fastest model that meets requirements
          const providerModels = Object.entries(routerConfig.modelConfigs)
            .filter(([_, modelConfig]: [string, any]) => modelConfig.provider === providerId)
            .map(([modelName, modelConfig]) => ({ ...(modelConfig as any), modelName }));

          if (providerModels.length > 0) {
            // Sort by latency (ascending)
            providerModels.sort((a, b) => a.latencyMs - b.latencyMs);
            const fastestModel = providerModels[0];

            // Check if fastest model meets complexity requirements
            if (fastestModel && fastestModel.latencyMs > 0) {
              selectedModel = fastestModel;
            }
          }
        }

        // Get provider instance from factory
        const { model: modelName } = await AIProviderFactory.getProviderForWorkspace(
          wsId,
          feature as any // Cast to match the expected feature type
        );

        // Override with our selected model if different
        const finalModel = selectedModel.modelName || modelName;

        // Try to get provider with our selected model
        try {
          const modelProvider = await AIProviderFactory.getProviderForWorkspace(wsId, feature as any);
          return {
            provider: modelProvider.provider,
            model: finalModel || modelProvider.model,
            providerName: modelProvider.providerName,
            config: routerConfig
          };
        } catch (_modelError) {
          // If specific model fails, fall back to factory default for this workspace
          const { provider, model, providerName } = await AIProviderFactory.getProviderForWorkspace(wsId, feature as any);
          return {
            provider,
            model,
            providerName,
            config: routerConfig
          };
        }
      } catch (_providerError) {
        // If this provider fails, try the next one
        if (providerId === providerOrder[providerOrder.length - 1]) {
          // Last provider in list failed, fall back to mock
          return {
            provider: AIProviderFactory.getMockInstance(),
            model: 'mock-model',
            providerName: 'mock',
            config: routerConfig
          };
        }
        continue; // Try next provider
      }
    }

    // Fallback (should not reach here)
    return {
      provider: AIProviderFactory.getMockInstance(),
      model: 'mock-model',
      providerName: 'mock',
      config: routerConfig
    };
  }

  /**
   * Generate text using the optimal provider/model for the task
   */
  async generateText(
    workspaceId: Types.ObjectId | string,
    prompt: string,
    options?: AIGenerationOptions,
    feature: 'workflow_generation' | 'failure_analysis' | 'optimization' | 'template_generation' = 'workflow_generation'
  ): Promise<string> {
    const { provider, model } = await this.selectProviderForTask(workspaceId, prompt, feature);
    return provider.generateText(prompt, { ...options, model });
  }

  /**
   * Generate workflow using the optimal provider/model for the task
   */
  async generateWorkflow(
    workspaceId: Types.ObjectId | string,
    prompt: string,
    options?: AIGenerationOptions,
    feature: 'workflow_generation' | 'failure_analysis' | 'optimization' | 'template_generation' = 'workflow_generation'
  ): Promise<GeneratedWorkflow> {
    const { provider, model } = await this.selectProviderForTask(workspaceId, prompt, feature);
    return provider.generateWorkflow(prompt, { ...options, model });
  }

  /**
   * Analyze execution using the optimal provider/model for the task
   */
  async analyzeExecution(
    workspaceId: Types.ObjectId | string,
    executionData: ExecutionAnalysisInput,
    _options?: AIGenerationOptions,
    feature: 'workflow_generation' | 'failure_analysis' | 'optimization' | 'template_generation' = 'failure_analysis'
  ): Promise<ExecutionAnalysisResult> {
    const { provider } = await this.selectProviderForTask(workspaceId, JSON.stringify(executionData), feature);
    return provider.analyzeExecution(executionData);
  }

  /**
   * Suggest optimization using the optimal provider/model for the task
   */
  async suggestOptimization(
    workspaceId: Types.ObjectId | string,
    workflowData: WorkflowOptimizationInput,
    _options?: AIGenerationOptions,
    feature: 'workflow_generation' | 'failure_analysis' | 'optimization' | 'template_generation' = 'optimization'
  ): Promise<OptimizationResult> {
    const { provider } = await this.selectProviderForTask(workspaceId, JSON.stringify(workflowData), feature);
    return provider.suggestOptimization(workflowData);
  }
}