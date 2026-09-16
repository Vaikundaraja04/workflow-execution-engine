import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { AIWorkflowService } from '../src/services/aiWorkflowService.js';
import { AIFailureAnalysisService } from '../src/services/aiFailureAnalysisService.js';
import { AIOptimizationService } from '../src/services/aiOptimizationService.js';
import { AIProviderFactory } from '../src/services/ai/AIProviderFactory.js';
import { AISecurityService } from '../src/services/ai/aiSecurityService.js';
import { AIUsageService } from '../src/services/aiUsageService.js';
import { MockAIProvider } from '../src/services/ai/MockAIProvider.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { ExecutionAnalyticsModel } from '../src/models/ExecutionAnalyticsModel.js';
import { AIConfigurationModel } from '../src/models/AIConfigurationModel.js';
import { AIUsageModel } from '../src/models/AIUsageModel.js';
import * as auditService from '../src/services/auditService.js';

describe('AI Workflow Intelligence Platform Tests', () => {
  const mockWorkspaceId = new Types.ObjectId();
  const mockUserId = new Types.ObjectId();
  const mockExecutionId = new Types.ObjectId();
  const mockWorkflowId = new Types.ObjectId();

  beforeEach(() => {
    vi.restoreAllMocks();
    AIProviderFactory.resetMockProvider();
    vi.spyOn(AIConfigurationModel, 'findOne').mockResolvedValue(null);
  });

  describe('AIWorkflowService', () => {
    it('should generate a workflow from a prompt', async () => {
      const mockProvider = new MockAIProvider();
      vi.spyOn(AIProviderFactory, 'getProviderForWorkspace').mockResolvedValue({
        provider: mockProvider,
        model: 'mock-model',
        providerName: 'mock',
      });

      vi.spyOn(AIUsageService, 'recordUsage').mockResolvedValue({} as any);
      vi.spyOn(auditService, 'createAuditLog').mockResolvedValue({} as any);

      const result = await AIWorkflowService.getInstance().generateWorkflowFromPrompt(
        'Create an employee onboarding workflow',
        mockWorkspaceId,
        mockUserId
      );

      expect(result).toBeDefined();
      expect(result.draftWorkflow).toBeDefined();
      expect(result.draftWorkflow.status).toBe('DRAFT');
      expect(result.draftWorkflow.isPublished).toBe(false);
      expect(result.validation.isValid).toBe(true);
      expect(result.suggestedTemplateName).toBeDefined();
      expect(result.draftWorkflow.nodes.length).toBeGreaterThan(0);
    });

    it('should reject invalid or empty prompts', async () => {
      await expect(
        AIWorkflowService.getInstance().generateWorkflowFromPrompt(
          '',
          mockWorkspaceId,
          mockUserId
        )
      ).rejects.toThrow('PROMPT_EMPTY');

      await expect(
        AIWorkflowService.getInstance().generateWorkflowFromPrompt(
          '   ',
          mockWorkspaceId,
          mockUserId
        )
      ).rejects.toThrow('PROMPT_EMPTY');
    });

    it('should handle workflow validation errors from faulty AI generation', async () => {
      const faultyProvider = new MockAIProvider();
      // Mock generateWorkflow returning invalid definition (cyclic or duplicate)
      vi.spyOn(faultyProvider, 'generateWorkflow').mockResolvedValue({
        workflowName: 'Faulty Workflow',
        description: 'Faulty',
        nodes: [
          { id: 'node_1', type: 'webhook', config: {} },
          { id: 'node_1', type: 'log', config: {} },
        ],
        connections: [],
      });

      vi.spyOn(AIProviderFactory, 'getProviderForWorkspace').mockResolvedValue({
        provider: faultyProvider,
        model: 'mock-model',
        providerName: 'mock',
      });
      vi.spyOn(AIUsageService, 'recordUsage').mockResolvedValue({} as any);
      vi.spyOn(auditService, 'createAuditLog').mockResolvedValue({} as any);

      const result = await AIWorkflowService.getInstance().generateWorkflowFromPrompt(
        'Create a workflow with duplicate nodes',
        mockWorkspaceId,
        mockUserId
      );

      expect(result.validation.isValid).toBe(false);
      expect(result.validation.errors.length).toBeGreaterThan(0);
    });

    it('should generate template from prompt with suggested metadata', async () => {
      const mockProvider = new MockAIProvider();
      vi.spyOn(AIProviderFactory, 'getProviderForWorkspace').mockResolvedValue({
        provider: mockProvider,
        model: 'mock-model',
        providerName: 'mock',
      });
      vi.spyOn(AIUsageService, 'recordUsage').mockResolvedValue({} as any);
      vi.spyOn(auditService, 'createAuditLog').mockResolvedValue({} as any);

      const result = await AIWorkflowService.getInstance().generateTemplateFromPrompt(
        'Generate an invoice approval process template',
        mockWorkspaceId,
        mockUserId
      );

      expect(result.draftWorkflow).toBeDefined();
      expect(result.draftWorkflow.status).toBe('DRAFT');
      expect(result.draftWorkflow.isPublished).toBe(false);
      expect(result.templateMetadata).toBeDefined();
      expect(result.templateMetadata.suggestedCategory).toBe('Approval Flow');
      expect(result.templateMetadata.suggestedVisibility).toBe('PRIVATE');
      expect(result.templateMetadata.suggestedTags).toContain('invoice');
    });

    it('should never auto-publish generated workflows', async () => {
      const mockProvider = new MockAIProvider();
      vi.spyOn(AIProviderFactory, 'getProviderForWorkspace').mockResolvedValue({
        provider: mockProvider,
        model: 'mock-model',
        providerName: 'mock',
      });
      vi.spyOn(AIUsageService, 'recordUsage').mockResolvedValue({} as any);
      vi.spyOn(auditService, 'createAuditLog').mockResolvedValue({} as any);

      const result = await AIWorkflowService.getInstance().generateWorkflowFromPrompt(
        'Create an automated deployment pipeline',
        mockWorkspaceId,
        mockUserId
      );

      expect(result.draftWorkflow.status).toBe('DRAFT');
      expect(result.draftWorkflow.isPublished).toBe(false);
    });
  });

  describe('AIFailureAnalysisService', () => {
    it('should analyze a failed execution', async () => {
      const mockExecution = {
        id: mockExecutionId,
        _id: mockExecutionId,
        workflowId: mockWorkflowId,
        workspaceId: mockWorkspaceId,
        status: 'FAILED',
        error: 'Node execution failed: Connection timeout',
        errors: [{ nodeId: 'step1', code: 'NODE_ERROR', message: 'Connection timeout' }],
        stepStatuses: { step1: 'FAILED', step2: 'SUCCEEDED' },
        executionHistory: [
          { nodeId: 'step1', fromStatus: 'PENDING', toStatus: 'FAILED', timestamp: new Date().toISOString() },
        ],
        duration: 5000,
        retryAttempts: 3,
      };

      const mockWorkflow = {
        _id: mockWorkflowId,
        id: mockWorkflowId,
        workspaceId: mockWorkspaceId,
        name: 'Order Processing',
        draftDefinition: {
          nodes: [{ id: 'step1', type: 'log', config: { message: 'Test step' } }],
          edges: [],
        },
      };

      vi.spyOn(WorkflowExecutionModel, 'findById').mockResolvedValue(mockExecution);
      vi.spyOn(WorkflowModel, 'findById').mockResolvedValue(mockWorkflow);
      vi.spyOn(AIUsageService, 'recordUsage').mockResolvedValue({} as any);
      vi.spyOn(auditService, 'createAuditLog').mockResolvedValue({} as any);

      const result = await AIFailureAnalysisService.getInstance().analyzeExecution(
        mockExecutionId,
        mockUserId
      );

      expect(result).toBeDefined();
      expect(result.summary).toContain('failed');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.suggestedFix.length).toBeGreaterThan(0);
    });

    it('should handle execution not found', async () => {
      vi.spyOn(WorkflowExecutionModel, 'findById').mockResolvedValue(null);

      await expect(
        AIFailureAnalysisService.getInstance().analyzeExecution(mockExecutionId, mockUserId)
      ).rejects.toThrow('EXECUTION_NOT_FOUND');
    });
  });

  describe('AIOptimizationService', () => {
    it('should generate optimization recommendations', async () => {
      const mockWorkflow = {
        _id: mockWorkflowId,
        id: mockWorkflowId,
        name: 'Test Workflow',
        workspaceId: mockWorkspaceId,
        ownerId: mockUserId,
        draftDefinition: {
          nodes: [
            { id: 'webhook_1', type: 'webhook', config: {} },
            { id: 'log_1', type: 'log', config: { message: 'Step 1' } },
            { id: 'log_2', type: 'log', config: { message: 'Step 2' } },
          ],
          edges: [
            { source: 'webhook_1', target: 'log_1' },
            { source: 'log_1', target: 'log_2' },
          ],
        },
      };

      const mockAnalytics = [
        { workflowId: mockWorkflowId, durationMs: 1000, retryCount: 0, status: 'SUCCEEDED' },
        { workflowId: mockWorkflowId, durationMs: 1500, retryCount: 1, status: 'FAILED' },
      ];

      vi.spyOn(WorkflowModel, 'findById').mockResolvedValue(mockWorkflow as any);
      vi.spyOn(ExecutionAnalyticsModel, 'find').mockReturnValue({
        sort: () => ({
          limit: () => ({
            lean: () => Promise.resolve(mockAnalytics),
          }),
        }),
      } as any);

      vi.spyOn(AIUsageService, 'recordUsage').mockResolvedValue({} as any);
      vi.spyOn(auditService, 'createAuditLog').mockResolvedValue({} as any);

      const result = await AIOptimizationService.getInstance().suggestOptimization(
        mockWorkflowId,
        mockUserId
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result.issues)).toBe(true);
      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    it('should handle workflow not found', async () => {
      vi.spyOn(WorkflowModel, 'findById').mockResolvedValue(null);

      await expect(
        AIOptimizationService.getInstance().suggestOptimization(mockWorkflowId, mockUserId)
      ).rejects.toThrow('WORKFLOW_NOT_FOUND');
    });
  });

  describe('AIUsageService', () => {
    it('should record usage in database', async () => {
      const mockUsageDoc = {
        _id: new Types.ObjectId(),
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        feature: 'workflow_generation',
        tokensUsed: 150,
        requests: 1,
        costEstimate: 0.003,
        model: 'mock-model',
      };

      vi.spyOn(AIUsageModel, 'create').mockResolvedValue(mockUsageDoc as any);

      const result = await AIUsageService.recordUsage({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        feature: 'workflow_generation',
        tokensUsed: 150,
        costEstimate: 0.003,
        model: 'mock-model',
      });

      expect(result).toBeDefined();
      expect(result.tokensUsed).toBe(150);
      expect(result.feature).toBe('workflow_generation');
    });

    it('should calculate usage summary', async () => {
      const mockRecords = [
        {
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
          feature: 'workflow_generation',
          tokensUsed: 100,
          requests: 1,
          costEstimate: 0.002,
        },
        {
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
          feature: 'failure_analysis',
          tokensUsed: 50,
          requests: 1,
          costEstimate: 0.001,
        },
      ];

      vi.spyOn(AIUsageModel, 'find').mockReturnValue({
        lean: () => Promise.resolve(mockRecords),
      } as any);

      const summary = await AIUsageService.getUsageSummary(mockWorkspaceId);
      expect(summary.workspaceId).toBe(mockWorkspaceId.toString());
      expect(summary.totalTokens).toBe(150);
      expect(summary.totalRequests).toBe(2);
      expect(summary.totalCost).toBe(0.003);
      expect(summary.byFeature.workflow_generation.tokens).toBe(100);
      expect(summary.byFeature.failure_analysis.tokens).toBe(50);
    });
  });

  describe('AIProviderFactory', () => {
    it('should return mock provider for null/invalid workspace', async () => {
      const result = await AIProviderFactory.getProviderForWorkspace(null, 'workflowGeneration');
      expect(result.provider).toBeInstanceOf(MockAIProvider);
      expect(result.providerName).toBe('mock');
    });

    it('should throw error when AI is disabled for workspace', async () => {
      vi.spyOn(AIConfigurationModel, 'findOne').mockResolvedValue({
        enabled: false,
        features: {
          workflowGeneration: false,
          failureAnalysis: false,
          optimization: false,
        },
        getDecryptedApiKey: () => 'fake-key',
      } as any);

      await expect(
        AIProviderFactory.getProviderForWorkspace(mockWorkspaceId, 'workflowGeneration')
      ).rejects.toThrow('AI_FEATURE_DISABLED');
    });

    it('should throw error when specific feature is disabled', async () => {
      vi.spyOn(AIConfigurationModel, 'findOne').mockResolvedValue({
        enabled: true,
        features: {
          workflowGeneration: false, // disabled
          failureAnalysis: true,
          optimization: true,
        },
        getDecryptedApiKey: () => 'fake-key',
      } as any);

      await expect(
        AIProviderFactory.getProviderForWorkspace(mockWorkspaceId, 'workflowGeneration')
      ).rejects.toThrow('AI_FEATURE_DISABLED');
    });

    it('should return mock provider when provider is configured as mock', async () => {
      vi.spyOn(AIConfigurationModel, 'findOne').mockResolvedValue({
        enabled: true,
        provider: 'mock',
        model: 'mock-model-custom',
        features: {
          workflowGeneration: true,
          failureAnalysis: true,
          optimization: true,
        },
        getDecryptedApiKey: () => '',
      } as any);

      const result = await AIProviderFactory.getProviderForWorkspace(mockWorkspaceId, 'workflowGeneration');
      expect(result.provider).toBeInstanceOf(MockAIProvider);
      expect(result.providerName).toBe('mock');
      expect(result.model).toBe('mock-model-custom');
    });
  });
});
