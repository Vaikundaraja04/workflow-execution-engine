import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { executeWorkflow } from '../src/engine/executeWorkflow.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';

const workflowPath = fileURLToPath(
  new URL('../src/examples/booking-workflow.json', import.meta.url)
);
const bookingWorkflow: WorkflowDefinition = JSON.parse(readFileSync(workflowPath, 'utf-8'));

describe('executeWorkflow', () => {
  it('correct execution order', async () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'l', type: 'log', config: { message: 'done' } },
      ],
      edges: [{ source: 'w', target: 'l' }],
    };
    const result = await executeWorkflow(wf);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.stepStatuses.w).toBe('SUCCEEDED');
    expect(result.stepStatuses.l).toBe('SUCCEEDED');
  });

  it('equals operator', async () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'c', type: 'condition', config: { field: 'x', operator: 'equals', value: 1 } },
        { id: 'l', type: 'log', config: { message: 'eq' } },
      ],
      edges: [{ source: 'w', target: 'c' }, { source: 'c', target: 'l', condition: 'true' }],
    };
    const result = await executeWorkflow(wf, { x: 1 });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.outputs.c).toEqual({ result: true });
  });

  it('notEquals operator', async () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'c', type: 'condition', config: { field: 'x', operator: 'notEquals', value: 1 } },
        { id: 'l', type: 'log', config: { message: 'neq' } },
      ],
      edges: [{ source: 'w', target: 'c' }, { source: 'c', target: 'l', condition: 'true' }],
    };
    const result = await executeWorkflow(wf, { x: 2 });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.outputs.c).toEqual({ result: true });
  });

  it('greaterThan operator', async () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'c', type: 'condition', config: { field: 'x', operator: 'greaterThan', value: 10 } },
        { id: 'l', type: 'log', config: { message: 'gt' } },
      ],
      edges: [{ source: 'w', target: 'c' }, { source: 'c', target: 'l', condition: 'true' }],
    };
    const result = await executeWorkflow(wf, { x: 15 });
    expect(result.status).toBe('SUCCEEDED');
  });

  it('lessThan operator', async () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'c', type: 'condition', config: { field: 'x', operator: 'lessThan', value: 10 } },
        { id: 'l', type: 'log', config: { message: 'lt' } },
      ],
      edges: [{ source: 'w', target: 'c' }, { source: 'c', target: 'l', condition: 'true' }],
    };
    const result = await executeWorkflow(wf, { x: 5 });
    expect(result.status).toBe('SUCCEEDED');
  });

  it('unknown operator fails', async () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'c', type: 'condition', config: { field: 'x', operator: 'foo', value: 1 } },
      ],
      edges: [{ source: 'w', target: 'c' }],
    };
    const result = await executeWorkflow(wf, { x: 1 });
    expect(result.status).toBe('FAILED');
    expect(result.errors?.[0]?.code).toBe('UNKNOWN_OPERATOR');
  });

  it('missing condition field fails', async () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'c', type: 'condition', config: { operator: 'equals', value: 1 } },
      ],
      edges: [{ source: 'w', target: 'c' }],
    };
    const result = await executeWorkflow(wf);
    expect(result.status).toBe('FAILED');
    expect(result.errors?.[0]?.code).toBe('MISSING_FIELD');
  });

  it('missing condition operator fails', async () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'c', type: 'condition', config: { field: 'x', value: 1 } },
      ],
      edges: [{ source: 'w', target: 'c' }],
    };
    const result = await executeWorkflow(wf, { x: 1 });
    expect(result.status).toBe('FAILED');
    expect(result.errors?.[0]?.code).toBe('MISSING_OPERATOR');
  });

  it('true condition branch', async () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'c', type: 'condition', config: { field: 'x', operator: 'equals', value: 1 } },
        { id: 'l', type: 'log', config: { message: 'true' } },
      ],
      edges: [
        { source: 'w', target: 'c' },
        { source: 'c', target: 'l', condition: 'true' },
      ],
    };
    const result = await executeWorkflow(wf, { x: 1 });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.outputs.c).toEqual({ result: true });
  });

  it('false condition branch', async () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'c', type: 'condition', config: { field: 'x', operator: 'equals', value: 1 } },
        { id: 'l', type: 'log', config: { message: 'false' } },
      ],
      edges: [
        { source: 'w', target: 'c' },
        { source: 'c', target: 'l', condition: 'false' },
      ],
    };
    const result = await executeWorkflow(wf, { x: 2 });
    expect(result.status).toBe('SUCCEEDED');
  });

  it('invalid condition configuration', async () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'c', type: 'condition', config: {} },
      ],
      edges: [{ source: 'w', target: 'c' }],
    };
    const result = await executeWorkflow(wf);
    expect(result.status).toBe('FAILED');
  });

  it('final successful execution status', async () => {
    const wf: WorkflowDefinition = {
      nodes: [{ id: 'w', type: 'webhook', config: {} }],
      edges: [],
    };
    const result = await executeWorkflow(wf);
    expect(result.status).toBe('SUCCEEDED');
  });

  it('booking workflow with cost 15000 selects managerLog and skips autoLog', async () => {
    const result = await executeWorkflow(bookingWorkflow, { estimatedCost: 15000 });
    expect(result.stepStatuses.managerLog).toBe('SUCCEEDED');
    expect(result.stepStatuses.autoLog).toBe('SKIPPED');
    expect(result.outputs.autoLog).toBeUndefined();
  });

  it('booking workflow with cost 5000 selects autoLog and skips managerLog', async () => {
    const result = await executeWorkflow(bookingWorkflow, { estimatedCost: 5000 });
    expect(result.stepStatuses.managerLog).toBe('SKIPPED');
    expect(result.stepStatuses.autoLog).toBe('SUCCEEDED');
    expect(result.outputs.managerLog).toBeUndefined();
  });

  it('example JSON with true branch', async () => {
    const result = await executeWorkflow(bookingWorkflow, { estimatedCost: 15000 });
    expect(result.stepStatuses.managerLog).toBe('SUCCEEDED');
    expect(result.stepStatuses.autoLog).toBe('SKIPPED');
  });

  it('example JSON with false branch', async () => {
    const result = await executeWorkflow(bookingWorkflow, { estimatedCost: 5000 });
    expect(result.stepStatuses.managerLog).toBe('SKIPPED');
    expect(result.stepStatuses.autoLog).toBe('SUCCEEDED');
  });

  it('complete READY transition history', async () => {
    const wf: WorkflowDefinition = {
      nodes: [{ id: 'w', type: 'webhook', config: {} }],
      edges: [],
    };
    const result = await executeWorkflow(wf);
    const events = result.executionHistory.filter(e => e.nodeId === 'w');
    expect(events.map(e => e.toStatus)).toEqual(['READY', 'RUNNING', 'SUCCEEDED']);
  });

  it('SKIPPED transition history', async () => {
    const result = await executeWorkflow(bookingWorkflow, { estimatedCost: 15000 });
    const skipEvents = result.executionHistory.filter(e => e.toStatus === 'SKIPPED');
    expect(skipEvents.length).toBeGreaterThan(0);
    expect(skipEvents[0]!.fromStatus).toBe('PENDING');
  });
});
