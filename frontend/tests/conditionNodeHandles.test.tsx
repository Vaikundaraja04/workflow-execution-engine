import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { nodeTypes } from '@/features/workflow-builder/nodes/nodeTypes';

// React Flow measures its container; JSDOM has no ResizeObserver.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function renderNode(type: string, nodeType: string) {
  return render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow
          nodeTypes={nodeTypes}
          nodes={[{
            id: 'n1',
            type,
            position: { x: 0, y: 0 },
            data: {
              label: 'Box',
              nodeType,
              category: 'logic',
              config: { field: 'status', operator: 'equals', value: 'paid' },
            },
          }]}
          edges={[]}
        />
      </div>
    </ReactFlowProvider>,
  );
}

describe('builder connection points', () => {
  it('gives the Condition box an input dot as well as its True and False dots', () => {
    const { container } = renderNode('conditionNode', 'condition');
    expect(container.querySelectorAll('.react-flow__handle.target')).toHaveLength(1);
    expect(container.querySelector('.react-flow__handle.source[data-handleid="true"]')).not.toBeNull();
    expect(container.querySelector('.react-flow__handle.source[data-handleid="false"]')).not.toBeNull();
  });

  it('keeps one input and one output dot on an ordinary action box', () => {
    const { container } = renderNode('actionNode', 'log');
    expect(container.querySelectorAll('.react-flow__handle.target')).toHaveLength(1);
    expect(container.querySelectorAll('.react-flow__handle.source')).toHaveLength(1);
  });
});
