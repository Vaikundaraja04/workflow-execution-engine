import { describe, it, expect } from 'vitest';
import { executeWorkflow, validateGraph, getReadyNodes } from '../src/index.js';
import type { WorkflowDefinition } from '../src/index.js';

describe('public exports from src/index.js', () => {
  it('exports runtime functions', () => {
    expect(typeof executeWorkflow).toBe('function');
    expect(typeof validateGraph).toBe('function');
    expect(typeof getReadyNodes).toBe('function');
  });

  it('allows WorkflowDefinition type import', () => {
    const wf: WorkflowDefinition = { nodes: [], edges: [] };
    expect(wf).toBeDefined();
  });
});
