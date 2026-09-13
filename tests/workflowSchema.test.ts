import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { safeParseWorkflowDefinition, WorkflowDefinitionSchema, WorkflowNodeSchema, WorkflowEdgeSchema, parseWorkflowDefinition } from '../src/schemas/workflowSchema.js';
import { executeWorkflow, validateGraph, getReadyNodes } from '../src/index.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';

const bookingPath = fileURLToPath(
  new URL('../src/examples/booking-workflow.json', import.meta.url)
);
const bookingContent = readFileSync(bookingPath, 'utf-8');

describe('workflowSchema', () => {
  const validBooking: WorkflowDefinition = JSON.parse(bookingContent) as WorkflowDefinition;

  it('valid booking workflow schema', () => {
    const result = safeParseWorkflowDefinition(validBooking);
    expect(result.success).toBe(true);
  });

  it('empty node id fails', () => {
    const bad = { nodes: [{ id: '', type: 'webhook', config: {} }], edges: [] };
    const result = safeParseWorkflowDefinition(bad);
    expect(result.success).toBe(false);
  });

  it('unknown node type fails', () => {
    const bad = { nodes: [{ id: 'x', type: 'foo', config: {} }], edges: [] } as unknown as WorkflowDefinition;
    const result = safeParseWorkflowDefinition(bad);
    expect(result.success).toBe(false);
  });

  it('missing condition field fails', () => {
    const bad = { nodes: [{ id: 'c', type: 'condition', config: { operator: 'equals', value: 1 } }], edges: [] } as unknown as WorkflowDefinition;
    const result = safeParseWorkflowDefinition(bad);
    expect(result.success).toBe(false);
  });

  it('missing condition operator fails', () => {
    const bad = { nodes: [{ id: 'c', type: 'condition', config: { field: 'x', value: 1 } }], edges: [] } as unknown as WorkflowDefinition;
    const result = safeParseWorkflowDefinition(bad);
    expect(result.success).toBe(false);
  });

  it('missing condition value fails', () => {
    const bad = { nodes: [{ id: 'c', type: 'condition', config: { field: 'x', operator: 'equals' } }], edges: [] } as unknown as WorkflowDefinition;
    const result = safeParseWorkflowDefinition(bad);
    expect(result.success).toBe(false);
  });

  it('invalid operator fails', () => {
    const bad = { nodes: [{ id: 'c', type: 'condition', config: { field: 'x', operator: 'foo', value: 1 } }], edges: [] } as unknown as WorkflowDefinition;
    const result = safeParseWorkflowDefinition(bad);
    expect(result.success).toBe(false);
  });

  it('empty log message fails', () => {
    const bad = { nodes: [{ id: 'l', type: 'log', config: { message: '' } }], edges: [] } as unknown as WorkflowDefinition;
    const result = safeParseWorkflowDefinition(bad);
    expect(result.success).toBe(false);
  });

  it('unexpected config property fails', () => {
    const bad = { nodes: [{ id: 'w', type: 'webhook', config: { foo: 'bar' } }], edges: [] } as unknown as WorkflowDefinition;
    const result = safeParseWorkflowDefinition(bad);
    expect(result.success).toBe(false);
  });

  it('malformed null input fails', () => {
    const result = safeParseWorkflowDefinition(null);
    expect(result.success).toBe(false);
  });

  it('malformed array input fails', () => {
    const result = safeParseWorkflowDefinition([]);
    expect(result.success).toBe(false);
  });

  it('malformed string input fails', () => {
    const result = safeParseWorkflowDefinition('bad');
    expect(result.success).toBe(false);
  });

  it('whitespace-only node id is rejected', () => {
    const bad = { nodes: [{ id: '   ', type: 'webhook', config: {} }], edges: [] };
    const result = safeParseWorkflowDefinition(bad);
    expect(result.success).toBe(false);
  });

  it('whitespace-only condition field is rejected', () => {
    const bad = { nodes: [{ id: 'c', type: 'condition', config: { field: '   ', operator: 'equals', value: 1 } }], edges: [] } as unknown as WorkflowDefinition;
    const result = safeParseWorkflowDefinition(bad);
    expect(result.success).toBe(false);
  });

  it('whitespace-only log message is rejected', () => {
    const bad = { nodes: [{ id: 'l', type: 'log', config: { message: '   ' } }], edges: [] } as unknown as WorkflowDefinition;
    const result = safeParseWorkflowDefinition(bad);
    expect(result.success).toBe(false);
  });
});

describe('Phase 2A additional proofs', () => {
  it('exact duplicate edge returns DUPLICATE_EDGE', () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'l', type: 'log', config: { message: 'x' } },
      ],
      edges: [
        { source: 'w', target: 'l' },
        { source: 'w', target: 'l' },
      ],
    };
    const errs = validateGraph(wf);
    expect(errs.some(e => e.type === 'DUPLICATE_EDGE')).toBe(true);
  });

  it('conditional edge from webhook returns INVALID_EDGE_CONDITION', () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'l', type: 'log', config: { message: 'x' } },
      ],
      edges: [{ source: 'w', target: 'l', condition: 'true' }],
    };
    const errs = validateGraph(wf);
    expect(errs.some(e => e.type === 'INVALID_EDGE_CONDITION')).toBe(true);
  });

  it('distinct colon-containing edges are not duplicates', () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'a:b', type: 'webhook', config: {} },
        { id: 'c', type: 'log', config: { message: '1' } },
        { id: 'a', type: 'log', config: { message: '2' } },
        { id: 'b:c', type: 'log', config: { message: '3' } },
      ],
      edges: [
        { source: 'a:b', target: 'c' },
        { source: 'a', target: 'b:c' },
      ],
    };
    const errs = validateGraph(wf);
    expect(errs.filter(e => e.type === 'DUPLICATE_EDGE')).toHaveLength(0);
  });

  it('executeWorkflow handles webhook with ID __proto__', async () => {
    const wf: WorkflowDefinition = {
      nodes: [{ id: '__proto__', type: 'webhook', config: {} }],
      edges: [],
    };
    const result = await executeWorkflow(wf);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.stepStatuses['__proto__']).toBe('SUCCEEDED');
    expect(Object.prototype.hasOwnProperty.call(result.stepStatuses, '__proto__')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result.outputs, '__proto__')).toBe(true);
  });

  it('null input to executeWorkflow returns INVALID_WORKFLOW_SCHEMA without throwing', async () => {
    const result = await executeWorkflow(null as unknown as WorkflowDefinition);
    expect(result.status).toBe('FAILED');
    expect(result.errors?.[0]?.code).toBe('INVALID_WORKFLOW_SCHEMA');
  });

  it('array input to executeWorkflow returns INVALID_WORKFLOW_SCHEMA without throwing', async () => {
    const result = await executeWorkflow([] as unknown as WorkflowDefinition);
    expect(result.status).toBe('FAILED');
    expect(result.errors?.[0]?.code).toBe('INVALID_WORKFLOW_SCHEMA');
  });

  it('string input to executeWorkflow returns INVALID_WORKFLOW_SCHEMA without throwing', async () => {
    const result = await executeWorkflow('bad' as unknown as WorkflowDefinition);
    expect(result.status).toBe('FAILED');
    expect(result.errors?.[0]?.code).toBe('INVALID_WORKFLOW_SCHEMA');
  });

  it('new schemas and helpers exported from src/index.ts', () => {
    expect(WorkflowDefinitionSchema).toBeDefined();
    expect(WorkflowNodeSchema).toBeDefined();
    expect(WorkflowEdgeSchema).toBeDefined();
    expect(typeof parseWorkflowDefinition).toBe('function');
    expect(typeof safeParseWorkflowDefinition).toBe('function');
    expect(typeof executeWorkflow).toBe('function');
    expect(typeof validateGraph).toBe('function');
    expect(typeof getReadyNodes).toBe('function');
  });
});
