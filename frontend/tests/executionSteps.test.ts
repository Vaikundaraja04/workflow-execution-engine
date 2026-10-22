import { describe, it, expect } from 'vitest';
import { buildExecutionNodes, errorText } from '@/features/execution-console/utils/executionSteps';
import type { WorkflowExecution } from '@/types/execution';
import type { WorkflowNode } from '@/types/workflow';

const definition: WorkflowNode[] = [
  { id: 'start', type: 'webhook', config: {} },
  { id: 'check', type: 'condition', config: { field: 'status', operator: 'equals', value: 'paid' } },
  { id: 'paid', type: 'log', config: { message: 'Paid' } },
  { id: 'notpaid', type: 'log', config: { message: 'Not paid' } },
];

const t = (ms: number) => new Date(Date.UTC(2026, 9, 22, 6, 0, 0, ms)).toISOString();

function run(overrides: Partial<WorkflowExecution>): WorkflowExecution {
  return {
    _id: 'run-1',
    workflowId: 'wf-1',
    workspaceId: 'ws-1',
    status: 'SUCCEEDED',
    version: 1,
    createdAt: t(0),
    updatedAt: t(0),
    attemptsMade: 1,
    ...overrides,
  };
}

describe('run detail steps', () => {
  it('shows each step with the status, timing and output the engine recorded', () => {
    const nodes = buildExecutionNodes(run({
      input: { status: 'paid' },
      result: {
        status: 'SUCCEEDED',
        stepStatuses: { start: 'SUCCEEDED', check: 'SUCCEEDED', paid: 'SUCCEEDED', notpaid: 'SKIPPED' },
        outputs: { start: { triggered: true }, check: { result: true }, paid: { message: 'Paid' } },
        executionHistory: [
          { nodeId: 'paid', fromStatus: 'READY', toStatus: 'RUNNING', timestamp: t(10) },
          { nodeId: 'paid', fromStatus: 'RUNNING', toStatus: 'SUCCEEDED', timestamp: t(25) },
          { nodeId: 'notpaid', fromStatus: 'PENDING', toStatus: 'SKIPPED', timestamp: t(26) },
        ],
      },
    }), definition);

    expect(nodes.map((node) => [node.name, node.status])).toEqual([
      ['Trigger', 'SUCCEEDED'],
      ['Check: status equals paid', 'SUCCEEDED'],
      ['Log: Paid', 'SUCCEEDED'],
      ['Log: Not paid', 'SKIPPED'],
    ]);
    expect(nodes[0].input).toEqual({ status: 'paid' });
    expect(nodes[1].input).toEqual({ field: 'status', operator: 'equals', value: 'paid' });
    expect(nodes[1].output).toEqual({ result: true });
    expect(nodes[2].duration).toBe(15);
    expect(nodes[3].output).toBeNull();
  });

  it('shows steps as queued while the run waits', () => {
    const nodes = buildExecutionNodes(run({ status: 'QUEUED' }), definition);
    expect(nodes.every((node) => node.status === 'QUEUED')).toBe(true);
  });

  it('puts a failure on the step that failed', () => {
    const nodes = buildExecutionNodes(run({
      status: 'FAILED',
      error: { code: 'NON_NUMERIC_OPERAND', message: 'Workflow execution failed' },
      result: {
        status: 'FAILED',
        stepStatuses: { start: 'SUCCEEDED', check: 'FAILED' },
        errors: [{ code: 'NON_NUMERIC_OPERAND', message: 'Condition needs numbers', nodeId: 'check' }],
      },
    }), definition);
    expect(nodes[1]).toMatchObject({ status: 'FAILED', error: 'NON_NUMERIC_OPERAND: Condition needs numbers' });
    expect(nodes[0].error).toBeNull();
  });

  it('turns the API error object into readable text', () => {
    expect(errorText({ code: 'EXECUTION_LOST', message: 'The queue lost this run' })).toBe('EXECUTION_LOST: The queue lost this run');
    expect(errorText('plain text')).toBe('plain text');
    expect(errorText(undefined)).toBeNull();
  });
});
