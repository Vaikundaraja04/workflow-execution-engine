import type { WorkflowExecution } from '@/types/execution';
import type { WorkflowNode } from '@/types/workflow';
import type { ExecutionNode } from '../types/types';

const FINISHED_STEP_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'SKIPPED']);

export function errorText(error: WorkflowExecution['error']): string | null {
  if (!error) return null;
  if (typeof error === 'string') return error;
  return [error.code, error.message].filter(Boolean).join(': ') || null;
}

function stepName(node: WorkflowNode): string {
  const config = (node.config ?? {}) as Record<string, unknown>;
  if (node.name) return node.name;
  if (node.type === 'webhook') return 'Trigger';
  if (node.type === 'log') return `Log: ${String(config.message ?? node.id)}`;
  if (node.type === 'condition') {
    return `Check: ${String(config.field ?? '?')} ${String(config.operator ?? '?')} ${String(config.value ?? '?')}`;
  }
  if (node.type === 'agent') return `AI agent (${node.id})`;
  return `${node.type} (${node.id})`;
}

/** One entry per step of the run, with the status, timing and output the engine recorded. */
export function buildExecutionNodes(execution: WorkflowExecution, definitionNodes: WorkflowNode[]): ExecutionNode[] {
  const result = execution.result;
  const stepStatuses = result?.stepStatuses ?? {};
  const outputs = result?.outputs ?? {};
  const history = result?.executionHistory ?? [];
  const waiting = execution.status === 'QUEUING' || execution.status === 'QUEUED' || execution.status === 'RUNNING' || execution.status === 'RETRYING';

  return definitionNodes.map((node) => {
    const events = history.filter((event) => event.nodeId === node.id);
    const startedAt = events.find((event) => event.toStatus === 'RUNNING')?.timestamp ?? null;
    const finishedAt = [...events].reverse().find((event) => FINISHED_STEP_STATUSES.has(event.toStatus))?.timestamp ?? null;
    const stepError = result?.errors?.find((error) => error.nodeId === node.id);
    const status = (stepStatuses[node.id] ?? (waiting ? 'QUEUED' : 'PENDING')) as ExecutionNode['status'];
    return {
      id: node.id,
      name: stepName(node),
      type: node.type,
      status,
      startedAt,
      finishedAt,
      duration: startedAt && finishedAt ? new Date(finishedAt).getTime() - new Date(startedAt).getTime() : null,
      attempt: execution.attemptsMade || 1,
      // The trigger receives the run's input; every other step shows its settings.
      input: node.type === 'webhook'
        ? (execution.input ?? execution.initialInput ?? {})
        : (node.config ?? {}) as Record<string, unknown>,
      output: Object.hasOwn(outputs, node.id) ? (outputs[node.id] as Record<string, unknown>) : null,
      error: stepError ? `${stepError.code}: ${stepError.message}` : status === 'FAILED' ? errorText(execution.error) : null,
    };
  });
}
