import mongoose, { Schema, Document, Types, model } from 'mongoose';

export interface IAIModelRouterConfig extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  // Provider priorities in order of preference
  providerPriority: Array<'openai' | 'anthropic' | 'mock'>;
  // Model-specific configurations
  modelConfigs: Record<string, {
    provider: 'openai' | 'anthropic' | 'mock';
    modelName: string;
    maxTokens: number;
    temperature: number;
    costPer1KTokens: number; // in USD
    latencyMs: number; // average latency
  }>;
  // Routing rules based on task complexity
  complexityRules: {
    simple: { // e.g., summarization, classification
      preferredProvider: 'openai' | 'anthropic' | 'mock';
      fallbackProvider: 'openai' | 'anthropic' | 'mock';
      maxCostPer1KTokens: number;
    };
    medium: { // e.g., workflow generation, analysis
      preferredProvider: 'openai' | 'anthropic' | 'mock';
      fallbackProvider: 'openai' | 'anthropic' | 'mock';
      maxCostPer1KTokens: number;
    };
    complex: { // e.g., optimization, reasoning
      preferredProvider: 'openai' | 'anthropic' | 'mock';
      fallbackProvider: 'openai' | 'anthropic' | 'mock';
      maxCostPer1KTokens: number;
    };
  };
  // Global settings
  enableFallback: boolean;
  enableCostOptimization: boolean;
  enableLatencyOptimization: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AIModelRouterConfigSchema = new Schema<IAIModelRouterConfig>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
    providerPriority: {
      type: [String],
      required: true,
      enum: ['openai', 'anthropic', 'mock'],
      default: ['openai', 'anthropic', 'mock']
    },
    modelConfigs: {
      type: Schema.Types.Mixed,
      required: true,
      default: {}
    },
    complexityRules: {
      type: Schema.Types.Mixed,
      required: true,
      default: {
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
      }
    },
    enableFallback: { type: Boolean, required: true, default: true },
    enableCostOptimization: { type: Boolean, required: true, default: true },
    enableLatencyOptimization: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: true,
  }
);

export const AIModelRouterConfigModel = model<IAIModelRouterConfig>('AIModelRouterConfig', AIModelRouterConfigSchema);