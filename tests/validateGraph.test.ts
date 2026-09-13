import { describe, it, expect } from 'vitest';
import { validateGraph } from '../src/engine/validateGraph.js';
import type { WorkflowDefinition, ValidationError } from '../src/types/workflow.js';

describe('validateGraph', () => {
  it('valid workflow', () => {
    const wf: WorkflowDefinition = {
      nodes: [{ id: 'w', type: 'webhook', config: {} }],
      edges: [],
    };
    expect(validateGraph(wf)).toHaveLength(0);
  });

  it('detects duplicate node', () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'a', type: 'webhook', config: {} },
        { id: 'a', type: 'log', config: {} },
      ],
      edges: [],
    };
    const errs = validateGraph(wf);
    expect(errs.some((e: ValidationError) => e.type === 'DUPLICATE_NODE')).toBe(true);
  });

  it('detects missing edge target', () => {
    const wf: WorkflowDefinition = {
      nodes: [{ id: 'w', type: 'webhook', config: {} }],
      edges: [{ source: 'w', target: 'missing' }],
    };
    const errs = validateGraph(wf);
    expect(errs.some((e: ValidationError) => e.type === 'MISSING_TARGET')).toBe(true);
  });

  it('detects missing source node', () => {
    const wf: WorkflowDefinition = {
      nodes: [{ id: 'w', type: 'webhook', config: {} }],
      edges: [{ source: 'missing', target: 'w' }],
    };
    const errs = validateGraph(wf);
    expect(errs.some((e: ValidationError) => e.type === 'MISSING_SOURCE')).toBe(true);
  });

  it('detects self-connection', () => {
    const wf: WorkflowDefinition = {
      nodes: [{ id: 'w', type: 'webhook', config: {} }],
      edges: [{ source: 'w', target: 'w' }],
    };
    const errs = validateGraph(wf);
    expect(errs.some((e: ValidationError) => e.type === 'SELF_CONNECTION')).toBe(true);
  });

  it('detects circular graph', () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'c', type: 'condition', config: {} },
      ],
      edges: [
        { source: 'w', target: 'c' },
        { source: 'c', target: 'w' },
      ],
    };
    const errs = validateGraph(wf);
    expect(errs.some((e: ValidationError) => e.type === 'CYCLE')).toBe(true);
  });

  it('detects unreachable node', () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w', type: 'webhook', config: {} },
        { id: 'u', type: 'log', config: {} },
      ],
      edges: [],
    };
    const errs = validateGraph(wf);
    expect(errs.some((e: ValidationError) => e.type === 'UNREACHABLE')).toBe(true);
  });

  it('detects zero webhooks', () => {
    const wf: WorkflowDefinition = {
      nodes: [{ id: 'l', type: 'log', config: {} }],
      edges: [],
    };
    const errs = validateGraph(wf);
    expect(errs.some((e: ValidationError) => e.type === 'WEBHOOK_COUNT')).toBe(true);
  });

  it('detects multiple webhooks', () => {
    const wf: WorkflowDefinition = {
      nodes: [
        { id: 'w1', type: 'webhook', config: {} },
        { id: 'w2', type: 'webhook', config: {} },
      ],
      edges: [],
    };
    const errs = validateGraph(wf);
    expect(errs.some((e: ValidationError) => e.type === 'WEBHOOK_COUNT')).toBe(true);
  });
});
