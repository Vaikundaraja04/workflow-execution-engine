import { describe, it, expect } from 'vitest';
import { executeWorkflow } from '../src/engine/executeWorkflow.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';

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
});
