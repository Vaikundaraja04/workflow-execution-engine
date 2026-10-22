import type { WorkflowDefinition, ExecutionResult, ExecutionHistoryEvent, StepStatus, WorkflowNode, ExecutionError } from '../types/workflow.js';
import type { AgentNodeConfig } from '../types/agent.types.js';
import { AgentRunnerService } from '../services/agent/agentRunnerService.js';
import { validateGraph } from './validateGraph.js';
import type { ReadyContext } from './getReadyNodes.js';
import { getReadyNodes } from './getReadyNodes.js';
import { safeParseWorkflowDefinition } from '../schemas/workflowSchema.js';

function recordEvent(history: ExecutionHistoryEvent[], nodeId: string, from: StepStatus, to: StepStatus) {
  history.push({
    nodeId,
    fromStatus: from,
    toStatus: to,
    timestamp: new Date().toISOString(),
  });
}

/**
 * The run input value a condition checks. Accepts a plain key ("status"), the console's
 * "input." form ("input.status") and nested paths ("customer.tier").
 */
export function readConditionField(context: Record<string, unknown>, field: string): unknown {
  if (Object.hasOwn(context, field)) return context[field];
  const parts = field.split('.');
  if (parts[0] === 'input' && !Object.hasOwn(context, 'input')) parts.shift();
  let current: unknown = context;
  for (const part of parts) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** A number, or text holding one: the console saves every expected value as text ("100"). */
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return undefined;
}

function conditionValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left === 'number' || typeof right === 'number') {
    const l = asNumber(left);
    const r = asNumber(right);
    return l !== undefined && l === r;
  }
  if (typeof left === 'boolean' && typeof right === 'string') return String(left) === right.trim();
  if (typeof right === 'boolean' && typeof left === 'string') return String(right) === left.trim();
  return false;
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
  const left = readConditionField(context, field);
  if (operator === 'greaterThan' || operator === 'lessThan') {
    const l = asNumber(left);
    const r = asNumber(value);
    if (l === undefined || r === undefined) return { result: false, error: 'NON_NUMERIC_OPERAND' };
    return { result: operator === 'greaterThan' ? l > r : l < r };
  }
  const same = conditionValuesEqual(left, value);
  return { result: operator === 'equals' ? same : !same };
}

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  initialContext: Record<string, unknown> = {}
): Promise<ExecutionResult> {
  const schemaResult = safeParseWorkflowDefinition(workflow);
  if (!schemaResult.success) {
    return {
      status: 'FAILED',
      stepStatuses: {},
      outputs: {},
      executionHistory: [],
      errors: [{ code: 'INVALID_WORKFLOW_SCHEMA', message: schemaResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }],
    };
  }

  const validatedWorkflow = schemaResult.data as WorkflowDefinition;

  const validationErrors = validateGraph(validatedWorkflow);
  if (validationErrors.length > 0) {
    return {
      status: 'FAILED',
      stepStatuses: {},
      outputs: {},
      executionHistory: [],
      errors: validationErrors.map(e => e.nodeId ? { code: e.type, message: e.message, nodeId: e.nodeId } : { code: e.type, message: e.message }),
    };
  }

  const stepStatuses: Record<string, StepStatus> = Object.create(null);
  const outputs: Record<string, unknown> = Object.create(null);
  const executionHistory: ExecutionHistoryEvent[] = [];
  const completedNodes = new Set<string>();
  const conditionResults: Record<string, boolean> = Object.create(null);
  const context = { ...initialContext };
  const errors: ExecutionError[] = [];

  for (const node of validatedWorkflow.nodes) {
    stepStatuses[node.id] = 'PENDING';
  }

  // Set initial roots to READY
  const initialReady = getReadyNodes(validatedWorkflow, stepStatuses, completedNodes, { conditionResults });
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
        } else if (node.type === 'agent') {
          const agentService = AgentRunnerService.getInstance();
          const agentConfig = node.config as unknown as AgentNodeConfig;
          const agentRes = await agentService.runAgentNode({
            workspaceId: (context.workspaceId as string) || 'default-workspace',
            userId: (context.userId as string) || 'system',
            ...(context.executionId ? { executionId: context.executionId as string } : {}),
            input: context,
            config: agentConfig,
            contextVariables: context,
          });
          outputs[node.id] = {
            output: agentRes.output,
            trace: agentRes.trace,
            tokenUsage: agentRes.tokenUsage,
            delegatedTo: agentRes.delegatedTo,
            consensusVote: agentRes.consensusVote,
          };
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
    for (const node of validatedWorkflow.nodes) {
      if (Object.hasOwn(conditionResults, node.id)) {
        const res = conditionResults[node.id];
        const outgoing = validatedWorkflow.edges.filter(e => e.source === node.id && e.condition);
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

    currentReady = getReadyNodes(validatedWorkflow, stepStatuses, completedNodes, { conditionResults });
    for (const node of currentReady) {
      if (stepStatuses[node.id] === 'PENDING') {
        stepStatuses[node.id] = 'READY';
        recordEvent(executionHistory, node.id, 'PENDING', 'READY');
      }
    }
  }

  // Mark all remaining PENDING steps as SKIPPED (unreached due to branches)
  for (const node of validatedWorkflow.nodes) {
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
