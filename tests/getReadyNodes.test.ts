import { describe, it, expect } from 'vitest';
import { getReadyNodes } from '../src/engine/getReadyNodes.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';

describe('getReadyNodes', () => {
  it('returns root nodes at start', () => {
    const wf: WorkflowDefinition = {
      nodes: [{ id: 'w', type: 'webhook', config: {} }],
      edges: [],
    };
    const statuses = { w: 'PENDING' as const };
    const ready = getReadyNodes(wf, statuses, new Set());
    expect(ready).toHaveLength(1);
    expect(ready[0]!.id).toBe('w');
  });
});
