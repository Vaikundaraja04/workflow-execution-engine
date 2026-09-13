import type { WorkflowDefinition, ValidationError, ValidationErrorType } from '../types/workflow.js';

export function validateGraph(workflow: WorkflowDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIds = new Set<string>();

  // Check for duplicate node IDs
  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push({ type: 'DUPLICATE_NODE' as ValidationErrorType, message: `Duplicate node ID: ${node.id}`, nodeId: node.id });
    } else {
      nodeIds.add(node.id);
    }
  }

  // Check edges for missing nodes and self-connections
  const edgeSet = new Set<string>();
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push({ type: 'MISSING_SOURCE' as ValidationErrorType, message: `Missing source node: ${edge.source}`, edge: { source: edge.source, target: edge.target } });
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({ type: 'MISSING_TARGET' as ValidationErrorType, message: `Missing target node: ${edge.target}`, edge: { source: edge.source, target: edge.target } });
    }
    if (edge.source === edge.target) {
      errors.push({ type: 'SELF_CONNECTION' as ValidationErrorType, message: `Self-connection on node: ${edge.source}`, edge: { source: edge.source, target: edge.target } });
    }
    const key = JSON.stringify([edge.source, edge.target, edge.condition ?? null]);
    if (edgeSet.has(key)) {
      errors.push({ type: 'DUPLICATE_EDGE' as ValidationErrorType, message: `Duplicate edge: ${edge.source} -> ${edge.target}${edge.condition ? ' ' + edge.condition : ''}` });
    } else {
      edgeSet.add(key);
    }
    if (edge.condition && !workflow.nodes.find(n => n.id === edge.source && n.type === 'condition')) {
      errors.push({ type: 'INVALID_EDGE_CONDITION' as ValidationErrorType, message: `Conditional edge from non-condition node: ${edge.source}`, edge: { source: edge.source, target: edge.target } });
    }
  }

  // Detect cycles using DFS
  const visited = new Set<string>();
  const recStack = new Set<string>();
  function hasCycle(nodeId: string): boolean {
    visited.add(nodeId);
    recStack.add(nodeId);
    const outgoing = workflow.edges.filter(e => e.source === nodeId);
    for (const edge of outgoing) {
      if (!visited.has(edge.target)) {
        if (hasCycle(edge.target)) return true;
      } else if (recStack.has(edge.target)) {
        errors.push({ type: 'CYCLE' as ValidationErrorType, message: `Cycle detected involving node: ${edge.target}`, nodeId: edge.target });
        return true;
      }
    }
    recStack.delete(nodeId);
    return false;
  }
  for (const node of workflow.nodes) {
    if (!visited.has(node.id)) {
      hasCycle(node.id);
    }
  }

  // Check for exactly one webhook
  const webhooks = workflow.nodes.filter(n => n.type === 'webhook');
  if (webhooks.length !== 1) {
    errors.push({ type: 'WEBHOOK_COUNT' as ValidationErrorType, message: `Expected exactly one webhook trigger, found ${webhooks.length}` });
  }

  // Detect unreachable nodes (simple reachability from webhook)
  if (webhooks.length === 1) {
    const start = webhooks[0]!.id;
    const reachable = new Set<string>();
    function dfs(id: string) {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const edge of workflow.edges) {
        if (edge.source === id) dfs(edge.target);
      }
    }
    dfs(start);
    for (const node of workflow.nodes) {
      if (!reachable.has(node.id)) {
        errors.push({ type: 'UNREACHABLE' as ValidationErrorType, message: `Unreachable node: ${node.id}`, nodeId: node.id });
      }
    }
  }

  return errors;
}
