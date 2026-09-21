import { Types } from 'mongoose';
import { AIProviderFactory } from './ai/AIProviderFactory.js';
import { AISecurityService } from './ai/aiSecurityService.js';
import { AIUsageService } from './aiUsageService.js';
import { createAuditLog } from './auditService.js';
import type { ValidationError, WorkflowDefinition } from '../types/workflow.js';
import type { WorkflowNode, WorkflowEdge } from '../types/workflow.js';
import type { WorkflowDefinitionInput } from '../schemas/workflowSchema.js';
import type { TemplateVisibility } from '../models/WorkflowTemplateModel.js';
import { NodeCapabilityRegistry } from './ai/nodeCapabilityRegistry.js';
import { AIGovernanceGate } from './aiGovernanceGate.js';

export interface GenerateWorkflowResult {
  draftWorkflow: {
    workflowName: string;
    description: string;
    nodes: any[];
    connections: any[];
    variables: Record<string, any>;
    definition: WorkflowDefinitionInput;
    status: 'DRAFT';
    isPublished: false;
    riskLevel?: import('./ai/nodeCapabilityRegistry.js').NodeRiskLevel;
  };
  validation: {
    isValid: boolean;
    errors: ValidationError[];
  };
  suggestedTemplateName: string;
}

export interface GenerateTemplateResult {
  draftWorkflow: {
    workflowName: string;
    description: string;
    nodes: any[];
    connections: any[];
    variables: Record<string, any>;
    definition: WorkflowDefinitionInput;
    status: 'DRAFT';
    isPublished: false;
  };
  validation: {
    isValid: boolean;
    errors: ValidationError[];
  };
  templateMetadata: {
    suggestedCategory: string;
    suggestedTags: string[];
    suggestedVisibility: TemplateVisibility;
  };
}

export class AIWorkflowService {
  private static instance: AIWorkflowService;

  public static getInstance(): AIWorkflowService {
    if (!AIWorkflowService.instance) {
      AIWorkflowService.instance = new AIWorkflowService();
    }
    return AIWorkflowService.instance;
  }

  async generateWorkflowFromPrompt(
    prompt: string,
    workspaceId: Types.ObjectId | string,
    userId: Types.ObjectId | string
  ): Promise<GenerateWorkflowResult> {
    // 1. Security: Validate prompt length and sanitize input
    const validatedPrompt = AISecurityService.validatePrompt(prompt);
    const sanitizedPrompt = AISecurityService.sanitizePrompt(validatedPrompt);

    // 2. Resolve Provider for workspace
    const { provider, model, providerName } = await AIProviderFactory.getProviderForWorkspace(
      workspaceId,
      'workflowGeneration'
    );

    const governance = await AIGovernanceGate.getInstance().authorize({
      workspaceId: workspaceId.toString(),
      userId: userId.toString(),
      feature: 'AI_WORKFLOW_CREATE',
      model,
      prompt: sanitizedPrompt,
    });
    if (governance.decision === 'DENY') throw new Error('AI_GOVERNANCE_DENIED');
    if (governance.decision === 'REQUIRE_APPROVAL') throw new Error('AI_GOVERNANCE_APPROVAL_REQUIRED');
    const governedPrompt = governance.redactedPrompt ?? sanitizedPrompt;

    // 3. AI generation (node capability catalog is injected so providers do not
    // hardcode node knowledge; see NodeCapabilityRegistry)
    const registry = NodeCapabilityRegistry.getInstance();
    const generated = await provider.generateWorkflow(governedPrompt, {
      systemContext: registry.buildGenerationContext(),
    });

    // 4. Normalize definition format
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

    const definitionCandidate: WorkflowDefinitionInput = {
      nodes: nodes as any,
      edges: edges as any,
    };

    // 5. Schema & Graph Validation
    const validation = AISecurityService.validateGeneratedWorkflow(definitionCandidate);

    const draftWorkflow = {
      workflowName: generated.workflowName || 'AI Generated Workflow',
      description: generated.description || `Draft workflow generated from prompt: ${sanitizedPrompt.slice(0, 60)}`,
      nodes,
      connections: generated.connections || [],
      variables: generated.variables || {},
      definition: definitionCandidate,
      status: 'DRAFT' as const,
      isPublished: false as const, // Never auto publish!
      riskLevel: registry.maxRiskLevel(nodes.map((node) => node.type)),
    };

    const suggestedTemplateName = generated.workflowName
      ? `${generated.workflowName} Template`
      : 'Automated Workflow Template';

    // 6. Record Usage
    await AIUsageService.recordUsage({
      workspaceId,
      userId,
      feature: 'workflow_generation',
      model: model,
    });

    // 7. Audit Log (Ensuring no secrets in metadata)
    await createAuditLog({
      action: 'AI_WORKFLOW_GENERATED',
      userId,
      workspaceId,
      metadata: {
        promptPreview: AISecurityService.filterSensitiveData(sanitizedPrompt.slice(0, 100)),
        provider: providerName,
        model,
        nodesCount: nodes.length,
        edgesCount: edges.length,
        isValid: validation.isValid,
        riskLevel: registry.maxRiskLevel(nodes.map((node) => node.type)),
      },
    });

    return {
      draftWorkflow,
      validation: {
        isValid: validation.isValid,
        errors: validation.errors,
      },
      suggestedTemplateName,
    };
  }

  async generateTemplateFromPrompt(
    prompt: string,
    workspaceId: Types.ObjectId | string,
    userId: Types.ObjectId | string
  ): Promise<GenerateTemplateResult> {
    // 1. Security: Validate prompt length and sanitize input
    const validatedPrompt = AISecurityService.validatePrompt(prompt);
    const sanitizedPrompt = AISecurityService.sanitizePrompt(validatedPrompt);

    // 2. Resolve Provider for workspace
    const { provider, model, providerName } = await AIProviderFactory.getProviderForWorkspace(
      workspaceId,
      'workflowGeneration' // We use workflowGeneration feature to generate the workflow part
    );

    const governance = await AIGovernanceGate.getInstance().authorize({
      workspaceId: workspaceId.toString(),
      userId: userId.toString(),
      feature: 'AI_WORKFLOW_CREATE',
      model,
      prompt: sanitizedPrompt,
    });
    if (governance.decision === 'DENY') throw new Error('AI_GOVERNANCE_DENIED');
    if (governance.decision === 'REQUIRE_APPROVAL') throw new Error('AI_GOVERNANCE_APPROVAL_REQUIRED');
    const governedPrompt = governance.redactedPrompt ?? sanitizedPrompt;

    // 3. AI generation for workflow
    const generated = await provider.generateWorkflow(governedPrompt);

    // 4. Normalize definition format
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

    const definitionCandidate: WorkflowDefinitionInput = {
      nodes: nodes as any,
      edges: edges as any,
    };

    // 5. Schema & Graph Validation
    const validation = AISecurityService.validateGeneratedWorkflow(definitionCandidate);

    const draftWorkflow = {
      workflowName: generated.workflowName || 'AI Generated Workflow',
      description: generated.description || `Draft workflow generated from prompt: ${sanitizedPrompt.slice(0, 60)}`,
      nodes,
      connections: generated.connections || [],
      variables: generated.variables || {},
      definition: definitionCandidate,
      status: 'DRAFT' as const,
      isPublished: false as const, // Never auto publish!
    };

    // 6. Generate template metadata
    // We can use a simple mapping or use the AI provider again for more sophisticated suggestions
    // For now, we'll use a rule-based approach based on keywords in the prompt
    const templateMetadata = this.generateTemplateMetadata(sanitizedPrompt, generated.workflowName);

    // 7. Record Usage (for template_generation feature)
    await AIUsageService.recordUsage({
      workspaceId,
      userId,
      feature: 'template_generation',
      model: model,
    });

    // 8. Audit Log
    await createAuditLog({
      action: 'AI_TEMPLATE_GENERATED',
      userId,
      workspaceId,
      metadata: {
        promptPreview: AISecurityService.filterSensitiveData(sanitizedPrompt.slice(0, 100)),
        provider: providerName,
        model,
        nodesCount: nodes.length,
        edgesCount: edges.length,
        isValid: validation.isValid,
        suggestedCategory: templateMetadata.suggestedCategory,
      },
    });

    return {
      draftWorkflow,
      validation: {
        isValid: validation.isValid,
        errors: validation.errors,
      },
      templateMetadata,
    };
  }

  /**
   * Generate template metadata based on the prompt and workflow name.
   * This is a simple rule-based implementation. In a real system, we might use AI for this.
   */
  private generateTemplateMetadata(prompt: string, workflowName: string | undefined): {
    suggestedCategory: string;
    suggestedTags: string[];
    suggestedVisibility: TemplateVisibility;
  } {
    const lowerPrompt = prompt.toLowerCase();
    const lowerName = (workflowName || '').toLowerCase();

    // Default values
    let category = 'Automation';
    const tags: string[] = [];
    let visibility: TemplateVisibility = 'PRIVATE';

    // Determine category based on keywords
    if (lowerPrompt.includes('invoice') || lowerPrompt.includes('billing') || lowerPrompt.includes('payment')) {
      category = 'Approval Flow';
      tags.push('invoice', 'billing', 'payment');
    } else if (lowerPrompt.includes('employee') || lowerPrompt.includes('onboard') || lowerPrompt.includes('hr') || lowerPrompt.includes('human resources')) {
      category = 'Automation';
      tags.push('employee', 'onboarding', 'hr');
    } else if (lowerPrompt.includes('lead') || lowerPrompt.includes('crm') || lowerPrompt.includes('sales') || lowerPrompt.includes('customer')) {
      category = 'Integration';
      tags.push('lead', 'crm', 'sales', 'crm');
    } else if (lowerPrompt.includes('data') || lowerPrompt.includes('etl') || lowerPrompt.includes('transform') || lowerPrompt.includes('process')) {
      category = 'Data Processing';
      tags.push('data', 'etl', 'processing');
    } else if (lowerPrompt.includes('webhook') || lowerPrompt.includes('api') || lowerPrompt.includes('integration')) {
      category = 'Integration';
      tags.push('webhook', 'api', 'integration');
    } else if (lowerPrompt.includes('monitor') || lowerPrompt.includes('alert') || lowerPrompt.includes('notification')) {
      category = 'Monitoring';
      tags.push('monitoring', 'alert', 'notification');
    } else if (lowerPrompt.includes('ai') || lowerPrompt.includes('ml') || lowerPrompt.includes('machine learning')) {
      category = 'AI Workflow';
      tags.push('ai', 'ml', 'machine learning');
    } else {
      // Fallback to workflow name
      if (lowerName.includes('invoice') || lowerName.includes('billing')) {
        category = 'Approval Flow';
      } else if (lowerName.includes('employee') || lowerName.includes('onboard')) {
        category = 'Automation';
      } else if (lowerName.includes('lead') || lowerName.includes('crm')) {
        category = 'Integration';
      } else if (lowerName.includes('data')) {
        category = 'Data Processing';
      } else if (lowerName.includes('webhook') || lowerName.includes('api')) {
        category = 'Integration';
      } else if (lowerName.includes('monitor') || lowerName.includes('alert')) {
        category = 'Monitoring';
      } else if (lowerName.includes('ai') || lowerName.includes('ml')) {
        category = 'AI Workflow';
      }
    }

    // Add workflow name as a tag if not already present
    if (workflowName && !tags.includes(workflowName.toLowerCase())) {
      tags.push(workflowName.toLowerCase());
    }

    // Limit tags to 5
    const limitedTags = tags.slice(0, 5);

    // Visibility: For now, we default to PRIVATE as per requirement (do not publish automatically)
    // In a real system, we might suggest based on context, but we keep it PRIVATE for safety.
    visibility = 'PRIVATE';

    return {
      suggestedCategory: category,
      suggestedTags: limitedTags,
      suggestedVisibility: visibility,
    };
  }
}

export default AIWorkflowService.getInstance();