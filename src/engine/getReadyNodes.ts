import type { WorkflowDefinition, WorkflowNode, StepStatus } from '../types/workflow.js';

export interface ReadyContext {
  conditionResults?: Record<string, boolean>;
}

export function getReadyNodes(
  workflow: WorkflowDefinition,
  stepStatuses: Record<string, StepStatus>,
  completedNodes: Set<string>,
  readyContext: ReadyContext = {}
): WorkflowNode[] {
  const ready: WorkflowNode[] = [];
  const conditionResults = readyContext.conditionResults || {};

  for (const node of workflow.nodes) {
    const status = stepStatuses[node.id] || 'PENDING';
    if (status !== 'PENDING' && status !== 'READY') continue;
    if (completedNodes.has(node.id)) continue;

    const incoming = workflow.edges.filter(e => e.target === node.id);
    if (incoming.length === 0) {
      ready.push(node);
      continue;
    }

    let canActivate = true;
    for (const edge of incoming) {
      const parentStatus = stepStatuses[edge.source];
      if (parentStatus !== 'SUCCEEDED') {
        canActivate = false;
        break;
      }
      if (edge.condition) {
        const condResult = conditionResults[edge.source];
        if (edge.condition === 'true' && condResult !== true) {
          canActivate = false;
          break;
        }
        if (edge.condition === 'false' && condResult !== false) {
          canActivate = false;
          break;
        }
      }
    }
    if (canActivate) {
      ready.push(node);
    }
  }
  return ready;
}
