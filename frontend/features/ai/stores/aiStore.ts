import { create } from 'zustand';
import type {
  AIGenerationState,
  AIChatMessage,
  AIDraftWorkflow,
  AIValidationResult,
  AIGenerateTemplateResult,
  AIExecutionAnalysis,
  AIOptimizationResult,
} from '../types/types';

interface AIFeatureState {
  isCopilotOpen: boolean;
  messages: AIChatMessage[];
  currentPrompt: string;

  generationState: AIGenerationState;
  generatedWorkflow: AIDraftWorkflow | null;
  validation: AIValidationResult | null;
  suggestedTemplateName: string | null;
  generationError: string | null;
  createdWorkflowId: string | null;

  templateState: AIGenerationState;
  templatePrompt: string;
  generatedTemplate: AIGenerateTemplateResult | null;
  templateError: string | null;
  savedTemplateId: string | null;

  analysisState: AIGenerationState;
  analysisResults: Record<string, AIExecutionAnalysis>;
  analysisErrors: Record<string, string>;

  optimizationState: AIGenerationState;
  optimizationResults: Record<string, AIOptimizationResult>;
  optimizationErrors: Record<string, string>;
}

interface AIActions {
  setCopilotOpen: (open: boolean) => void;
  toggleCopilot: () => void;
  setCurrentPrompt: (prompt: string) => void;
  addMessage: (message: AIChatMessage) => void;
  clearMessages: () => void;

  startGeneration: () => void;
  generationSucceeded: (
    workflow: AIDraftWorkflow,
    validation: AIValidationResult,
    suggestedTemplateName?: string
  ) => void;
  generationFailed: (error: string) => void;
  setCreatedWorkflowId: (workflowId: string | null) => void;
  resetGeneration: () => void;

  setTemplatePrompt: (prompt: string) => void;
  startTemplateGeneration: () => void;
  templateGenerationSucceeded: (result: AIGenerateTemplateResult) => void;
  templateGenerationFailed: (error: string) => void;
  setSavedTemplateId: (templateId: string | null) => void;
  resetTemplateGeneration: () => void;

  startAnalysis: (executionId: string) => void;
  analysisSucceeded: (executionId: string, result: AIExecutionAnalysis) => void;
  analysisFailed: (executionId: string, error: string) => void;

  startOptimization: (workflowId: string) => void;
  optimizationSucceeded: (workflowId: string, result: AIOptimizationResult) => void;
  optimizationFailed: (workflowId: string, error: string) => void;

  reset: () => void;
}

export type AIStore = AIFeatureState & AIActions;


const initialFeatureState: AIFeatureState = {
  isCopilotOpen: false,
  messages: [],
  currentPrompt: '',

  generationState: 'IDLE',
  generatedWorkflow: null,
  validation: null,
  suggestedTemplateName: null,
  generationError: null,
  createdWorkflowId: null,

  templateState: 'IDLE',
  templatePrompt: '',
  generatedTemplate: null,
  templateError: null,
  savedTemplateId: null,

  analysisState: 'IDLE',
  analysisResults: {},
  analysisErrors: {},

  optimizationState: 'IDLE',
  optimizationResults: {},
  optimizationErrors: {},
};


export const useAIStore = create<AIStore>((set) => ({
  ...initialFeatureState,

  setCopilotOpen: (open) => set({ isCopilotOpen: open }),
  toggleCopilot: () => set((state) => ({ isCopilotOpen: !state.isCopilotOpen })),
  setCurrentPrompt: (prompt) => set({ currentPrompt: prompt }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  clearMessages: () => set({ messages: [] }),

  startGeneration: () =>
    set({
      generationState: 'GENERATING',
      generationError: null,
      generatedWorkflow: null,
      validation: null,
      suggestedTemplateName: null,
      createdWorkflowId: null,
    }),
  generationSucceeded: (workflow, validation, suggestedTemplateName) =>
    set({
      generationState: 'SUCCESS',
      generatedWorkflow: workflow,
      validation,
      suggestedTemplateName: suggestedTemplateName ?? null,
      generationError: null,
    }),
  generationFailed: (error) =>
    set({
      generationState: 'FAILED',
      generationError: error,
      generatedWorkflow: null,
      validation: null,
    }),
  setCreatedWorkflowId: (workflowId) => set({ createdWorkflowId: workflowId }),
  resetGeneration: () =>
    set({
      generationState: 'IDLE',
      generatedWorkflow: null,
      validation: null,
      suggestedTemplateName: null,
      generationError: null,
      createdWorkflowId: null,
    }),

  setTemplatePrompt: (prompt) => set({ templatePrompt: prompt }),
  startTemplateGeneration: () =>
    set({
      templateState: 'GENERATING',
      templateError: null,
      generatedTemplate: null,
      savedTemplateId: null,
    }),
  templateGenerationSucceeded: (result) =>
    set({
      templateState: 'SUCCESS',
      generatedTemplate: result,
      templateError: null,
    }),
  templateGenerationFailed: (error) =>
    set({
      templateState: 'FAILED',
      templateError: error,
      generatedTemplate: null,
    }),
  setSavedTemplateId: (templateId) => set({ savedTemplateId: templateId }),
  resetTemplateGeneration: () =>
    set({
      templateState: 'IDLE',
      generatedTemplate: null,
      templateError: null,
      savedTemplateId: null,
    }),

  startAnalysis: (executionId) =>
    set((state) => ({
      analysisState: 'GENERATING',
      analysisErrors: { ...state.analysisErrors, [executionId]: '' },
    })),
  analysisSucceeded: (executionId, result) =>
    set((state) => ({
      analysisState: 'SUCCESS',
      analysisResults: { ...state.analysisResults, [executionId]: result },
      analysisErrors: { ...state.analysisErrors, [executionId]: '' },
    })),
  analysisFailed: (executionId, error) =>
    set((state) => ({
      analysisState: 'FAILED',
      analysisErrors: { ...state.analysisErrors, [executionId]: error },
    })),

  startOptimization: (workflowId) =>
    set((state) => ({
      optimizationState: 'GENERATING',
      optimizationErrors: { ...state.optimizationErrors, [workflowId]: '' },
    })),
  optimizationSucceeded: (workflowId, result) =>
    set((state) => ({
      optimizationState: 'SUCCESS',
      optimizationResults: { ...state.optimizationResults, [workflowId]: result },
      optimizationErrors: { ...state.optimizationErrors, [workflowId]: '' },
    })),
  optimizationFailed: (workflowId, error) =>
    set((state) => ({
      optimizationState: 'FAILED',
      optimizationErrors: { ...state.optimizationErrors, [workflowId]: error },
    })),

  reset: () => set({ ...initialFeatureState }),
}));

export default useAIStore;
