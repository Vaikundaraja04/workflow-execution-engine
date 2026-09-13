import type { WorkflowDefinition, WorkflowNode, StepStatus } from '../types/workflow.js';

export function getReadyNodes(
  workflow: WorkflowDefinition,
  stepStatuses: Record<string, StepStatus>,
  completedNodes: Set<string>
): WorkflowNode[] {
  const ready: WorkflowNode[] = [];
  const nodeMap = new Map(workflow.nodes.map(n => [n.id, n]));

  for (const node of workflow.nodes) {
    const status = stepStatuses[node.id] || 'PENDING';
    if (status !== 'PENDING' && status !== 'READY') continue;
    if (completedNodes.has(node.id)) continue;

    const incoming = workflow.edges.filter(e => e.target === node.id);
    if (incoming.length === 0) {
      // root node
      ready.push(node);
      continue;
    }

    // Check if all parents succeeded, considering conditions
    let allParentsDone = true;
    for (const edge of incoming) {
      const parentStatus = stepStatuses[edge.source];
      if (parentStatus !== 'SUCCEEDED') {
        allParentsDone = false;
        break;
      }
      // For condition edges, only consider if matching
      if (edge.condition) {
        // assume outputs handled in execute, here simplified
      }
    }
    if (allParentsDone) {
      ready.push(node);
    }
  }
  return ready;
}
