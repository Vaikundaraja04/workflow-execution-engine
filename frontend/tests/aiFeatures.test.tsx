import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AIChatMessage } from '@/features/ai/components/AIChatMessage';
import { AIErrorState } from '@/features/ai/components/AIErrorState';
import { ConfidenceBadge } from '@/features/ai/components/ConfidenceBadge';
import { PromptInput } from '@/features/ai/components/PromptInput';
import { WorkflowValidationChecklist } from '@/features/ai/workflow-generation/WorkflowValidationChecklist';
import { WorkflowGenerator } from '@/features/ai/workflow-generation/WorkflowGenerator';
import { TemplateGenerator } from '@/features/ai/template-generation/TemplateGenerator';
import { WorkflowOptimizer } from '@/features/ai/optimization/WorkflowOptimizer';
import { ExecutionAIAnalysis } from '@/features/ai/analysis/ExecutionAIAnalysis';
import { AIUsageDashboard } from '@/features/ai/usage/AIUsageDashboard';
import { useAIStore } from '@/features/ai/stores/aiStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { aiApi, summarizeAIUsage } from '@/services/aiApi';
import { templateApi } from '@/services/templateApi';
import { workflowApi } from '@/services/workflowApi';
import type { AIDraftWorkflow, AIValidationResult } from '@/features/ai/types/types';

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/ai/workflow-generator',
}));

vi.mock('@/services/aiApi', async () => {
  const actual = await vi.importActual<typeof import('@/services/aiApi')>('@/services/aiApi');
  return {
    ...actual,
    aiApi: {
      generateWorkflow: vi.fn(),
      generateTemplate: vi.fn(),
      analyzeExecution: vi.fn(),
      optimizeWorkflow: vi.fn(),
      getAIUsage: vi.fn(),
      getAIConfig: vi.fn(),
      updateAIConfig: vi.fn(),
    },
  };
});

vi.mock('@/services/templateApi', () => ({
  templateApi: {
    createTemplate: vi.fn(),
  },
}));

vi.mock('@/services/workflowApi', () => ({
  workflowApi: {
    createWorkflow: vi.fn(),
  },
}));

const mockWorkspace = {
  _id: 'workspace-1',
  id: 'workspace-1',
  name: 'Test Workspace',
  slug: 'test-workspace',
  ownerId: 'user-1',
  role: 'OWNER' as const,
  createdAt: '2026-01-01T10:00:00Z',
  updatedAt: '2026-01-01T10:00:00Z',
};

const validValidation: AIValidationResult = { isValid: true, errors: [] };

const mockDraftWorkflow: AIDraftWorkflow = {
  workflowName: 'Invoice Approval',
  description: 'Generated invoice approval workflow',
  nodes: [
    { id: 'trigger_1', type: 'webhook', config: {} },
    { id: 'action_1', type: 'email', config: {} },
  ],
  connections: [{ source: 'trigger_1', target: 'action_1' }],
  variables: {},
  definition: {
    nodes: [
      { id: 'trigger_1', type: 'webhook', config: {} },
      { id: 'action_1', type: 'email', config: {} },
    ],
    edges: [{ source: 'trigger_1', target: 'action_1' }],
  },
  status: 'DRAFT',
  isPublished: false,
};

function setRole(role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | null) {
  useWorkspaceStore.setState({
    currentWorkspace: mockWorkspace,
    workspaces: [mockWorkspace],
    currentRole: role,
    isLoading: false,
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAIStore.getState().reset();
  setRole('EDITOR');

  vi.mocked(aiApi.generateWorkflow).mockResolvedValue({
    draftWorkflow: mockDraftWorkflow,
    validation: validValidation,
    suggestedTemplateName: 'Invoice Approvals',
  });
  vi.mocked(aiApi.generateTemplate).mockResolvedValue({
    draftWorkflow: mockDraftWorkflow,
    validation: validValidation,
    templateMetadata: {
      suggestedCategory: 'Approval Flow',
      suggestedTags: ['invoice', 'approval'],
      suggestedVisibility: 'PRIVATE',
    },
  });
  vi.mocked(aiApi.analyzeExecution).mockResolvedValue({
    summary: 'Upstream returned HTTP 401',
    rootCause: 'Expired API credential',
    affectedNode: 'http_1',
    suggestedFix: 'Rotate the API key and retry the execution',
    confidence: 0.92,
  });
  vi.mocked(aiApi.optimizeWorkflow).mockResolvedValue({
    issues: [
      {
        type: 'LATENCY',
        description: 'Sequential email step adds latency',
        severity: 'high',
        affectedNodeId: 'action_1',
      },
    ],
    recommendations: [
      {
        title: 'Parallelize notifications',
        description: 'Run email and logging steps in parallel',
        impact: '-35% latency',
        action: 'Reorder nodes',
      },
    ],
    estimatedImprovement: '-40% runtime',
  });
  vi.mocked(aiApi.getAIUsage).mockResolvedValue({
    totalRequests: 12,
    totalTokens: 3400,
    estimatedCost: 0.045,
    featureUsage: [
      { feature: 'workflow_generation', requests: 8, tokens: 2400, cost: 0.03 },
      { feature: 'failure_analysis', requests: 4, tokens: 1000, cost: 0.015 },
    ],
    records: [
      {
        _id: 'rec-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        feature: 'workflow_generation',
        tokensUsed: 1200,
        requests: 1,
        costEstimate: 0.01,
        model: 'mock-model',
        createdAt: '2026-01-01T10:00:00Z',
      },
    ],
    latestActivity: '2026-01-01T10:00:00Z',
  });
  vi.mocked(templateApi.createTemplate).mockResolvedValue({
    _id: 'template-1',
    name: 'Invoice Approval',
    category: 'Approval Flow',
    visibility: 'PRIVATE',
    tags: ['invoice'],
  });
  vi.mocked(workflowApi.createWorkflow).mockResolvedValue({
    _id: 'workflow-1',
    name: 'Invoice Approval',
  } as never);
});

describe('AI Chat and Prompt Components', () => {
  it('renders user and assistant chat messages', () => {
    render(
      <AIChatMessage
        message={{
          id: 'm1',
          role: 'user',
          content: 'Build an approval workflow',
          createdAt: '2026-01-01T10:00:00Z',
        }}
      />
    );
    render(
      <AIChatMessage
        message={{
          id: 'm2',
          role: 'assistant',
          content: 'Generated "Invoice Approval" with 2 nodes',
          createdAt: '2026-01-01T10:00:01Z',
          nodeCount: 2,
          connectionCount: 1,
          isValid: true,
        }}
      />
    );

    expect(screen.getByTestId('ai-chat-message-user')).toBeInTheDocument();
    expect(screen.getByTestId('ai-chat-message-assistant')).toBeInTheDocument();
    expect(screen.getByText('Build an approval workflow')).toBeInTheDocument();
    expect(screen.getAllByText(/2 nodes/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 connections/).length).toBeGreaterThan(0);
    expect(screen.getByText('Validated')).toBeInTheDocument();
  });

  it('flags failed assistant generations', () => {
    render(
      <AIChatMessage
        message={{
          id: 'm3',
          role: 'assistant',
          content: 'Generation failed: provider timeout',
          createdAt: '2026-01-01T10:00:02Z',
          error: 'Generation failed: provider timeout',
        }}
      />
    );

    expect(screen.getByText('Generation failed')).toBeInTheDocument();
    expect(screen.getByText(/provider timeout/)).toBeInTheDocument();
  });

  it('renders confidence badge percentages', () => {
    render(<ConfidenceBadge confidence={0.92} showBar />);

    expect(screen.getByTestId('confidence-badge')).toBeInTheDocument();
    expect(screen.getByText(/92% confidence/)).toBeInTheDocument();
  });

  it('submits prompts and blocks submission when disabled', () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    const { rerender } = render(
      <PromptInput value="Create a workflow" onChange={onChange} onSubmit={onSubmit} />
    );

    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    expect(onSubmit).toHaveBeenCalledWith('Create a workflow');

    rerender(
      <PromptInput value="Create a workflow" onChange={onChange} onSubmit={onSubmit} disabled />
    );
    expect(screen.getByText(/AI_WORKFLOW_CREATE permission required/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('renders permission error states with hints', () => {
    render(
      <AIErrorState
        variant="permission"
        title="AI generation restricted"
        message="Your role cannot generate workflows."
        hint={<span>Requires AI_WORKFLOW_CREATE</span>}
      />
    );

    expect(screen.getByTestId('ai-error-state')).toBeInTheDocument();
    expect(screen.getByText('AI generation restricted')).toBeInTheDocument();
    expect(screen.getByText('Requires AI_WORKFLOW_CREATE')).toBeInTheDocument();
  });
});

describe('Workflow Validation Checklist', () => {
  it('reports a ready workflow when all checks pass', () => {
    render(
      <WorkflowValidationChecklist workflow={mockDraftWorkflow} validation={validValidation} canCreate />
    );

    expect(screen.getByTestId('ai-validation-checklist')).toBeInTheDocument();
    expect(screen.getByText('Workflow ready')).toBeInTheDocument();
    expect(screen.getByText('6/6 checks passed')).toBeInTheDocument();
  });

  it('surfaces validation failures with details', () => {
    const invalidWorkflow: AIDraftWorkflow = {
      ...mockDraftWorkflow,
      nodes: [{ id: 'action_1', type: 'email', config: {} }],
      connections: [],
      definition: { nodes: [{ id: 'action_1', type: 'email', config: {} }], edges: [] },
    };

    render(
      <WorkflowValidationChecklist
        workflow={invalidWorkflow}
        validation={{
          isValid: false,
          errors: [{ type: 'INVALID_WORKFLOW_SCHEMA', message: 'Entry point node is required' }],
        }}
        canCreate={false}
      />
    );

    expect(screen.getByText('Validation failed')).toBeInTheDocument();
    expect(screen.getByText(/Workflow requires at least one trigger node/)).toBeInTheDocument();
    expect(screen.getByText(/Entry point node is required/)).toBeInTheDocument();
    expect(screen.getByText(/Draft creation is restricted for your role/)).toBeInTheDocument();
  });
});

describe('Workflow Generator', () => {
  it('blocks generation for roles without AI write access', () => {
    setRole('VIEWER');
    render(<WorkflowGenerator />);

    expect(screen.getByText('AI generation restricted')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-prompt-input')).not.toBeInTheDocument();
  });

  it('generates a workflow draft and persists it', async () => {
    render(<WorkflowGenerator />);

    fireEvent.change(screen.getByTestId('ai-prompt-input'), {
      target: { value: 'Create an invoice approval workflow' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => {
      expect(aiApi.generateWorkflow).toHaveBeenCalledWith('Create an invoice approval workflow', 'workspace-1');
    });

    await waitFor(() => {
      expect(screen.getByText('Invoice Approval')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-validation-checklist')).toBeInTheDocument();
    expect(screen.getAllByText('Workflow ready').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => {
      expect(workflowApi.createWorkflow).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText(/Draft workflow created/)).toBeInTheDocument();
    });
  });
});

describe('Template Generator', () => {
  it('restricts template generation for viewers', () => {
    setRole('VIEWER');
    render(<TemplateGenerator />);

    expect(screen.getByText('AI template generation restricted')).toBeInTheDocument();
  });

  it('generates a template and persists it with suggested metadata', async () => {
    render(<TemplateGenerator />);

    fireEvent.change(screen.getByTestId('ai-prompt-input'), {
      target: { value: 'Create an invoice approval template' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => {
      expect(aiApi.generateTemplate).toHaveBeenCalledWith('Create an invoice approval template', 'workspace-1');
    });

    await waitFor(() => {
      expect(screen.getByTestId('template-metadata')).toBeInTheDocument();
    });
    expect(screen.getByText('Approval Flow')).toBeInTheDocument();
    expect(screen.getByText('invoice')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create template/i }));

    await waitFor(() => {
      expect(templateApi.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Invoice Approval',
          category: 'Approval Flow',
          visibility: 'PRIVATE',
          tags: ['invoice', 'approval'],
        }),
        'workspace-1'
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/Template created/)).toBeInTheDocument();
    });
  });
});

describe('Workflow Optimizer', () => {
  it('restricts optimization for viewers', () => {
    setRole('VIEWER');
    render(<WorkflowOptimizer workflowId="workflow-1" />);

    expect(screen.getByText('AI optimization restricted')).toBeInTheDocument();
  });

  it('renders issues and recommendations after analysis', async () => {
    render(<WorkflowOptimizer workflowId="workflow-1" workflowName="Invoice Approval" />);

    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }));

    await waitFor(() => {
      expect(aiApi.optimizeWorkflow).toHaveBeenCalledWith('workflow-1', 'workspace-1');
    });

    await waitFor(() => {
      expect(screen.getByTestId('optimization-issues')).toBeInTheDocument();
    });
    expect(screen.getByText(/Sequential email step adds latency/)).toBeInTheDocument();
    expect(screen.getByTestId('optimization-recommendations')).toBeInTheDocument();
    expect(screen.getByText('Parallelize notifications')).toBeInTheDocument();
    expect(screen.getByText(/-40% runtime/)).toBeInTheDocument();
  });
});

describe('Execution AI Analysis', () => {
  it('requires AI_ANALYSIS_READ permission', () => {
    setRole(null);
    render(<ExecutionAIAnalysis executionId="exec-1" />);

    expect(screen.getByText('AI diagnostics restricted')).toBeInTheDocument();
  });

  it('runs analysis automatically and renders the diagnosis', async () => {
    render(<ExecutionAIAnalysis executionId="exec-1" />);

    await waitFor(() => {
      expect(aiApi.analyzeExecution).toHaveBeenCalledWith('exec-1', 'workspace-1');
    });

    await waitFor(() => {
      expect(screen.getByText('Expired API credential')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-root-cause')).toBeInTheDocument();
    expect(screen.getByText(/Rotate the API key/)).toBeInTheDocument();
    expect(screen.getByText(/92% confidence/)).toBeInTheDocument();
  });
});

describe('AI Usage Dashboard', () => {
  it('restricts usage reporting for editors', () => {
    setRole('EDITOR');
    render(<AIUsageDashboard />);

    expect(screen.getByText('AI usage restricted')).toBeInTheDocument();
  });

  it('renders usage totals and records for admins', async () => {
    setRole('ADMIN');
    render(<AIUsageDashboard />);

    await waitFor(() => {
      expect(aiApi.getAIUsage).toHaveBeenCalledWith('workspace-1');
    });

    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-dashboard')).toBeInTheDocument();
    });
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3,400')).toBeInTheDocument();
    expect(screen.getByText('$0.0450')).toBeInTheDocument();
    expect(screen.getByTestId('ai-usage-features')).toBeInTheDocument();
    expect(screen.getAllByText('Workflow Generation').length).toBeGreaterThan(0);
    expect(screen.getByText('mock-model')).toBeInTheDocument();
  });
});

describe('AI usage aggregation', () => {
  it('summarizes raw usage records by feature', () => {
    const summary = summarizeAIUsage([
      {
        workspaceId: 'w1',
        userId: 'u1',
        feature: 'workflow_generation',
        tokensUsed: 100,
        requests: 2,
        costEstimate: 0.01,
      },
      {
        workspaceId: 'w1',
        userId: 'u1',
        feature: 'workflow_generation',
        tokensUsed: 50,
        requests: 1,
        costEstimate: 0.005,
      },
      {
        workspaceId: 'w1',
        userId: 'u1',
        feature: 'optimization',
        tokensUsed: 20,
        requests: 1,
        costEstimate: 0.002,
      },
    ]);

    expect(summary.totalRequests).toBe(4);
    expect(summary.totalTokens).toBe(170);
    expect(summary.estimatedCost).toBeCloseTo(0.017, 4);
    expect(summary.featureUsage).toHaveLength(2);

    const generation = summary.featureUsage.find((feature) => feature.feature === 'workflow_generation');
    expect(generation?.requests).toBe(3);
    expect(generation?.tokens).toBe(150);
  });
});
