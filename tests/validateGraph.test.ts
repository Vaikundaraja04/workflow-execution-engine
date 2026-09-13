import { describe, it, expect } from 'vitest';
import { validateGraph } from '../src/engine/validateGraph.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';

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
    expect(errs.some((e: any) => e.type === 'DUPLICATE_NODE')).toBe(true);
  });

  it('detects missing edge target', () => {
    const wf: WorkflowDefinition = {
      nodes: [{ id: 'w', type: 'webhook', config: {} }],
      edges: [{ source: 'w', target: 'missing' }],
    };
    const errs = validateGraph(wf);
    expect(errs.some((e: any) => e.type === 'MISSING_TARGET')).toBe(true);
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
    expect(errs.some((e: any) => e.type === 'CYCLE')).toBe(true);
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
    expect(errs.some((e: any) => e.type === 'UNREACHABLE')).toBe(true);
  });
});
