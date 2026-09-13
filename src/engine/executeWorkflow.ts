import type { WorkflowDefinition, ExecutionResult, ExecutionHistoryEvent, StepStatus, WorkflowNode, ExecutionError } from '../types/workflow.js';
import { validateGraph } from './validateGraph.js';
import type { ReadyContext } from './getReadyNodes.js';
import { getReadyNodes } from './getReadyNodes.js';

function recordEvent(history: ExecutionHistoryEvent[], nodeId: string, from: StepStatus, to: StepStatus) {
  history.push({
    nodeId,
    fromStatus: from,
    toStatus: to,
    timestamp: new Date().toISOString(),
  });
}

function evaluateCondition(config: Record<string, unknown>, context: Record<string, unknown>): { result: boolean; error?: string } {
  const field = config.field as string | undefined;
  const operator = config.operator as string | undefined;
  const value = config.value;

  if (!field || typeof field !== 'string') {
    return { result: false, error: 'MISSING_FIELD' };
  }
  if (!operator || typeof operator !== 'string') {
    return { result: false, error: 'MISSING_OPERATOR' };
  }
  if (!['equals', 'notEquals', 'greaterThan', 'lessThan'].includes(operator)) {
    return { result: false, error: 'UNKNOWN_OPERATOR' };
  }
  const left = context[field];
  if ((operator === 'greaterThan' || operator === 'lessThan') && (typeof left !== 'number' || typeof value !== 'number')) {
    return { result: false, error: 'NON_NUMERIC_OPERAND' };
  }
  let res: boolean;
  switch (operator) {
    case 'equals': res = left === value; break;
    case 'notEquals': res = left !== value; break;
    case 'greaterThan': res = (left as number) > (value as number); break;
    case 'lessThan': res = (left as number) < (value as number); break;
    default: return { result: false, error: 'UNKNOWN_OPERATOR' };
  }
  return { result: res };
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
      errors: validationErrors.map(e => e.nodeId ? { code: e.type, message: e.message, nodeId: e.nodeId } : { code: e.type, message: e.message }),
    };
  }

  const stepStatuses: Record<string, StepStatus> = {};
  const outputs: Record<string, unknown> = {};
  const executionHistory: ExecutionHistoryEvent[] = [];
  const completedNodes = new Set<string>();
  const conditionResults: Record<string, boolean> = {};
  const context = { ...initialContext };
  const errors: ExecutionError[] = [];

  for (const node of workflow.nodes) {
    stepStatuses[node.id] = 'PENDING';
  }

  // Set initial roots to READY
  const initialReady = getReadyNodes(workflow, stepStatuses, completedNodes, { conditionResults });
  for (const node of initialReady) {
    stepStatuses[node.id] = 'READY';
    recordEvent(executionHistory, node.id, 'PENDING', 'READY');
  }

  let currentReady = initialReady;

  while (currentReady.length > 0) {
    for (const node of [...currentReady]) {
      stepStatuses[node.id] = 'RUNNING';
      recordEvent(executionHistory, node.id, 'READY', 'RUNNING');

      try {
        if (node.type === 'webhook') {
          outputs[node.id] = { triggered: true };
          stepStatuses[node.id] = 'SUCCEEDED';
          recordEvent(executionHistory, node.id, 'RUNNING', 'SUCCEEDED');
        } else if (node.type === 'condition') {
          const evalRes = evaluateCondition(node.config, context);
          if (evalRes.error) {
            throw new Error(evalRes.error);
          }
          const res = evalRes.result;
          conditionResults[node.id] = res;
          outputs[node.id] = { result: res };
          stepStatuses[node.id] = 'SUCCEEDED';
          recordEvent(executionHistory, node.id, 'RUNNING', 'SUCCEEDED');
        } else if (node.type === 'log') {
          const message = (node.config.message as string) || 'log';
          outputs[node.id] = { message };
          stepStatuses[node.id] = 'SUCCEEDED';
          recordEvent(executionHistory, node.id, 'RUNNING', 'SUCCEEDED');
        } else {
          throw new Error('UNKNOWN_NODE_TYPE');
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
        stepStatuses[node.id] = 'FAILED';
        recordEvent(executionHistory, node.id, 'RUNNING', 'FAILED');
        errors.push({ nodeId: node.id, code: errorMsg, message: `Node ${node.id} failed: ${errorMsg}` });
        return {
          status: 'FAILED',
          stepStatuses: { ...stepStatuses },
          outputs: { ...outputs },
          executionHistory: [...executionHistory],
          errors,
        };
      }

      completedNodes.add(node.id);
    }

    // After processing ready set, mark non-selected branches as SKIPPED
    for (const node of workflow.nodes) {
      if (conditionResults.hasOwnProperty(node.id)) {
        const res = conditionResults[node.id];
        const outgoing = workflow.edges.filter(e => e.source === node.id && e.condition);
        for (const edge of outgoing) {
          if ((edge.condition === 'true' && !res) || (edge.condition === 'false' && res)) {
            const targetStatus = stepStatuses[edge.target];
            if (targetStatus === 'PENDING' || targetStatus === 'READY') {
              stepStatuses[edge.target] = 'SKIPPED';
              recordEvent(executionHistory, edge.target, targetStatus, 'SKIPPED');
              completedNodes.add(edge.target);
            }
          }
        }
      }
    }

    currentReady = getReadyNodes(workflow, stepStatuses, completedNodes, { conditionResults });
    for (const node of currentReady) {
      if (stepStatuses[node.id] === 'PENDING') {
        stepStatuses[node.id] = 'READY';
        recordEvent(executionHistory, node.id, 'PENDING', 'READY');
      }
    }
  }

  // Mark any remaining PENDING as SKIPPED (unreached due to branches)
  for (const node of workflow.nodes) {
    if (stepStatuses[node.id] === 'PENDING') {
      stepStatuses[node.id] = 'SKIPPED';
      recordEvent(executionHistory, node.id, 'PENDING', 'SKIPPED');
    }
  }

  const finalStatus = Object.values(stepStatuses).every(s => s === 'SUCCEEDED' || s === 'SKIPPED') ? 'SUCCEEDED' : 'FAILED';

  const result: ExecutionResult = {
    status: finalStatus,
    stepStatuses,
    outputs,
    executionHistory,
  };
  if (errors.length > 0) {
    result.errors = errors;
  }
  return result;
}
