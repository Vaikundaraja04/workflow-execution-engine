import type {
  AIProvider,
  AIGenerationOptions,
  GeneratedWorkflow,
  ExecutionAnalysisInput,
  ExecutionAnalysisResult,
  WorkflowOptimizationInput,
  OptimizationResult,
  OptimizationIssue,
  OptimizationRecommendation,
} from './AIProvider.js';

export class MockAIProvider implements AIProvider {
  async generateText(prompt: string, options: AIGenerationOptions = {}): Promise<string> {
    return `AI response for: ${prompt.slice(0, 100)}`;
  }

  async generateWorkflow(prompt: string, options: AIGenerationOptions = {}): Promise<GeneratedWorkflow> {
    const lower = prompt.toLowerCase();

    // Special test hooks for negative/security test cases
    if (prompt.includes('__INVALID_SCHEMA__')) {
      return {
        workflowName: 'Invalid Workflow',
        description: 'Workflow with invalid node type',
        nodes: [
          { id: 'start', type: 'invalid_node_type' as any, config: {} },
        ],
        connections: [],
        variables: {},
      };
    }

    if (prompt.includes('__CYCLE_ERROR__')) {
      return {
        workflowName: 'Cyclic Workflow',
        description: 'Workflow with a cycle',
        nodes: [
          { id: 'webhook_1', type: 'webhook', config: {} },
          { id: 'log_1', type: 'log', config: { message: 'Step 1' } },
          { id: 'log_2', type: 'log', config: { message: 'Step 2' } },
        ],
        connections: [
          { source: 'webhook_1', target: 'log_1' },
          { source: 'log_1', target: 'log_2' },
          { source: 'log_2', target: 'log_1' }, // Cycle!
        ],
        variables: {},
      };
    }

    if (lower.includes('invoice') || lower.includes('approval')) {
      const nodes = [
        { id: 'webhook_invoice_in', type: 'webhook' as const, config: {} },
        {
          id: 'cond_check_amount',
          type: 'condition' as const,
          config: { field: 'amount', operator: 'greaterThan' as const, value: 1000 },
        },
        {
          id: 'log_manager_approval',
          type: 'log' as const,
          config: { message: 'Invoice requires manager approval' },
        },
        {
          id: 'log_auto_approve',
          type: 'log' as const,
          config: { message: 'Invoice auto-approved under threshold' },
        },
      ];
      const connections = [
        { source: 'webhook_invoice_in', target: 'cond_check_amount' },
        { source: 'cond_check_amount', target: 'log_manager_approval', condition: 'true' as const },
        { source: 'cond_check_amount', target: 'log_auto_approve', condition: 'false' as const },
      ];
      return {
        workflowName: 'Invoice Approval Workflow',
        description: 'Automated invoice routing and approval based on total amount',
        nodes,
        connections,
        variables: { threshold: 1000 },
        definition: {
          nodes,
          edges: connections.map((c) => ({
            source: c.source,
            target: c.target,
            ...(c.condition ? { condition: c.condition } : {}),
          })),
        },
      };
    }

    if (lower.includes('onboard') || lower.includes('employee')) {
      const nodes = [
        { id: 'webhook_onboard_start', type: 'webhook' as const, config: {} },
        {
          id: 'log_welcome_email',
          type: 'log' as const,
          config: { message: 'Welcome email sent to new hire' },
        },
        {
          id: 'log_provision_accounts',
          type: 'log' as const,
          config: { message: 'IT accounts and access privileges provisioned' },
        },
      ];
      const connections = [
        { source: 'webhook_onboard_start', target: 'log_welcome_email' },
        { source: 'log_welcome_email', target: 'log_provision_accounts' },
      ];
      return {
        workflowName: 'Employee Onboarding Workflow',
        description: 'Orchestrates new employee welcome communications and IT provisioning',
        nodes,
        connections,
        variables: { department: 'Engineering' },
        definition: {
          nodes,
          edges: connections.map((c) => ({ source: c.source, target: c.target })),
        },
      };
    }

    if (lower.includes('lead') || lower.includes('crm')) {
      const nodes = [
        { id: 'webhook_lead_received', type: 'webhook' as const, config: {} },
        {
          id: 'cond_high_score',
          type: 'condition' as const,
          config: { field: 'score', operator: 'greaterThan' as const, value: 80 },
        },
        {
          id: 'log_sales_alert',
          type: 'log' as const,
          config: { message: 'High priority lead assigned to sales team' },
        },
        {
          id: 'log_nurture_campaign',
          type: 'log' as const,
          config: { message: 'Lead added to email nurture sequence' },
        },
      ];
      const connections = [
        { source: 'webhook_lead_received', target: 'cond_high_score' },
        { source: 'cond_high_score', target: 'log_sales_alert', condition: 'true' as const },
        { source: 'cond_high_score', target: 'log_nurture_campaign', condition: 'false' as const },
      ];
      return {
        workflowName: 'CRM Lead Qualification Workflow',
        description: 'Qualifies incoming CRM leads and routes to sales or nurture sequence',
        nodes,
        connections,
        variables: { minScore: 80 },
        definition: {
          nodes,
          edges: connections.map((c) => ({
            source: c.source,
            target: c.target,
            ...(c.condition ? { condition: c.condition } : {}),
          })),
        },
      };
    }

    // Default workflow
    const nodes = [
      { id: 'webhook_event', type: 'webhook' as const, config: {} },
      { id: 'log_process_event', type: 'log' as const, config: { message: 'Processing event notification' } },
    ];
    const connections = [{ source: 'webhook_event', target: 'log_process_event' }];
    return {
      workflowName: 'Custom Automated Workflow',
      description: `Workflow generated from prompt: ${prompt.slice(0, 50)}`,
      nodes,
      connections,
      variables: {},
      definition: {
        nodes,
        edges: connections.map((c) => ({ source: c.source, target: c.target })),
      },
    };
  }

  async analyzeExecution(executionData: ExecutionAnalysisInput): Promise<ExecutionAnalysisResult> {
    const isFailed = executionData.status === 'FAILED' || (executionData.errors && executionData.errors.length > 0);

    if (isFailed) {
      // Find affected node
      let affectedNode: string | null = null;
      if (executionData.errors && executionData.errors.length > 0 && executionData.errors[0]?.nodeId) {
        affectedNode = executionData.errors[0].nodeId;
      } else if (executionData.stepStatuses) {
        for (const [nodeId, status] of Object.entries(executionData.stepStatuses)) {
          if (status === 'FAILED') {
            affectedNode = nodeId;
            break;
          }
        }
      }

      const errorMessage = executionData.error || executionData.errors?.[0]?.message || 'Unknown node execution error';

      return {
        summary: `Execution ${executionData.executionId} failed during execution${affectedNode ? ` at node '${affectedNode}'` : ''}.`,
        rootCause: `Node execution error: ${errorMessage}. Node evaluation failed with retry attempts: ${executionData.retryAttempts ?? 0}.`,
        affectedNode: affectedNode || 'execution_pipeline',
        suggestedFix: `Inspect input payload configuration for node '${affectedNode || 'failed step'}', ensure all referenced variables exist, and verify webhook payload schema.`,
        confidence: 0.94,
      };
    }

    return {
      summary: `Execution ${executionData.executionId} completed successfully without errors.`,
      rootCause: 'None - all steps executed according to the workflow graph.',
      affectedNode: null,
      suggestedFix: 'No corrective action required. The workflow is operating within normal parameters.',
      confidence: 0.98,
    };
  }

  async suggestOptimization(workflowData: WorkflowOptimizationInput): Promise<OptimizationResult> {
    const issues: OptimizationIssue[] = [];
    const recommendations: OptimizationRecommendation[] = [];

    const nodes = workflowData.definition?.nodes || [];
    const edges = workflowData.definition?.edges || [];

    // Analyze unused nodes or deep nesting
    const targetNodeIds = new Set(edges.map((e) => e.target));
    const sourceNodeIds = new Set(edges.map((e) => e.source));

    for (const node of nodes) {
      if (node.type !== 'webhook' && !targetNodeIds.has(node.id)) {
        issues.push({
          type: 'UNUSED_NODE',
          description: `Node '${node.id}' is not targeted by any incoming edge.`,
          severity: 'medium',
          affectedNodeId: node.id,
        });
        recommendations.push({
          title: `Connect or remove unused node '${node.id}'`,
          description: `Remove unreachable step '${node.id}' to reduce graph complexity.`,
          impact: 'Improves maintainability and clarity',
          action: 'REMOVE_NODE',
        });
      }
    }

    // Check for slow nodes or high retry metrics if available
    if (workflowData.metrics?.slowNodes && workflowData.metrics.slowNodes.length > 0) {
      for (const slow of workflowData.metrics.slowNodes) {
        issues.push({
          type: 'HIGH_LATENCY_STEP',
          description: `Node '${slow.nodeId}' has an average duration of ${slow.avgDuration}ms.`,
          severity: 'high',
          affectedNodeId: slow.nodeId,
        });
        recommendations.push({
          title: `Optimize execution for '${slow.nodeId}'`,
          description: 'Consider caching external lookups or simplifying condition expressions.',
          impact: 'Estimated 25-40% latency reduction',
          action: 'OPTIMIZE_NODE',
        });
      }
    }

    // If no issues found, provide general optimization recommendations
    if (issues.length === 0) {
      recommendations.push({
        title: 'Streamline execution path',
        description: 'Consolidate redundant logging steps and enable parallel branching where possible.',
        impact: 'Estimated 15% execution efficiency gain',
      });
    }

    return {
      issues,
      recommendations,
      estimatedImprovement: issues.length > 0 ? '25%' : '10%',
    };
  }
}
