import type { WorkflowDefinition, ExecutionResult, ExecutionHistoryEvent, StepStatus, WorkflowNode } from '../types/workflow.js';
import { validateGraph } from './validateGraph.js';
import { getReadyNodes } from './getReadyNodes.js';

function recordEvent(history: ExecutionHistoryEvent[], nodeId: string, from: StepStatus, to: StepStatus) {
  history.push({
    nodeId,
    fromStatus: from,
    toStatus: to,
    timestamp: new Date().toISOString(),
  });
}

function evaluateCondition(config: Record<string, unknown>, context: Record<string, unknown>): boolean {
  const { field, operator, value } = config as { field?: string; operator?: string; value?: unknown };
  if (!field || !operator) throw new Error('Invalid condition configuration');
  const left = context[field];
  switch (operator) {
    case 'equals': return left === value;
    case 'notEquals': return left !== value;
    case 'greaterThan': return typeof left === 'number' && typeof value === 'number' && left > value;
    case 'lessThan': return typeof left === 'number' && typeof value === 'number' && left < value;
    default: return false;
  }
}

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  initialContext: Record<string, unknown> = {}
): Promise<ExecutionResult> {
  const validationErrors = validateGraph(workflow);
  if (validationErrors.length > 0) {
    return {
      status: 'FAILED',
      stepStatuses: {},
      outputs: {},
      executionHistory: [],
    };
  }

  const stepStatuses: Record<string, StepStatus> = {};
  const outputs: Record<string, unknown> = {};
  const executionHistory: ExecutionHistoryEvent[] = [];
  const completedNodes = new Set<string>();
  const context = { ...initialContext };

  // Initialize all to PENDING
  for (const node of workflow.nodes) {
    stepStatuses[node.id] = 'PENDING';
  }

  let currentReady = getReadyNodes(workflow, stepStatuses, completedNodes);

  while (currentReady.length > 0) {
    for (const node of currentReady) {
      stepStatuses[node.id] = 'RUNNING';
      recordEvent(executionHistory, node.id, 'PENDING', 'RUNNING');

      try {
        if (node.type === 'webhook') {
          outputs[node.id] = { triggered: true };
          stepStatuses[node.id] = 'SUCCEEDED';
          recordEvent(executionHistory, node.id, 'RUNNING', 'SUCCEEDED');
        } else if (node.type === 'condition') {
          const result = evaluateCondition(node.config, context);
          outputs[node.id] = { result };
          stepStatuses[node.id] = 'SUCCEEDED';
          recordEvent(executionHistory, node.id, 'RUNNING', 'SUCCEEDED');
          // Note: actual branching handled by getReadyNodes next iteration via edges
        } else if (node.type === 'log') {
          const message = node.config.message as string || 'log';
          outputs[node.id] = { message };
          stepStatuses[node.id] = 'SUCCEEDED';
          recordEvent(executionHistory, node.id, 'RUNNING', 'SUCCEEDED');
        } else {
          throw new Error('Unknown node type');
        }
      } catch (err) {
        stepStatuses[node.id] = 'FAILED';
        recordEvent(executionHistory, node.id, 'RUNNING', 'FAILED');
        return {
          status: 'FAILED',
          stepStatuses: { ...stepStatuses },
          outputs: { ...outputs },
          executionHistory: [...executionHistory],
        };
      }

      completedNodes.add(node.id);
    }

    // Recompute ready after batch
    currentReady = getReadyNodes(workflow, stepStatuses, completedNodes);
  }

  const finalStatus = Object.values(stepStatuses).every(s => s === 'SUCCEEDED' || s === 'SKIPPED') ? 'SUCCEEDED' : 'FAILED';

  return {
    status: finalStatus,
    stepStatuses,
    outputs,
    executionHistory,
  };
}
