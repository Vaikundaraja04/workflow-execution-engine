import type {
  AIDraftWorkflow,
  AIWorkflowNode,
  GeneratedNodeCategory,
  GeneratedPreviewEdge,
  GeneratedPreviewNode,
} from '../types/types';

const TRIGGER_TYPES = ['webhook', 'webhook_trigger', 'manual_trigger', 'schedule_trigger', 'trigger'];
const LOGIC_TYPES = ['condition', 'delay', 'branch', 'switch'];
const INTEGRATION_TYPES = ['http_request', 'email', 'notification', 'database_query'];

export function getNodeCategory(type: string): GeneratedNodeCategory {
  const normalized = (type || '').toLowerCase();
  if (TRIGGER_TYPES.includes(normalized)) return 'trigger';
  if (LOGIC_TYPES.includes(normalized)) return 'logic';
  if (INTEGRATION_TYPES.includes(normalized) || normalized === 'log' || normalized === 'action') {
    return 'action';
  }
  return 'unknown';
}

export function getNodeLabel(node: AIWorkflowNode): string {
  const category = getNodeCategory(node.type);
  if (category === 'trigger') return 'Trigger';
  if (node.type === 'condition') return 'Condition';
  if (node.type === 'delay') return 'Delay';
  if (node.type === 'log') {
    const message = (node.config?.message as string) || '';
    return message ? `Log: ${message.slice(0, 32)}` : 'Log Step';
  }
  return node.type.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function deriveWorkflowCategory(nodes: AIWorkflowNode[]): string {
  const categories = nodes.map((node) => getNodeCategory(node.type));
  const hasCondition = nodes.some((node) => node.type === 'condition');
  const hasIntegration = nodes.some((node) => INTEGRATION_TYPES.includes(node.type));
  const triggerCount = categories.filter((category) => category === 'trigger').length;

  if (hasCondition) return 'Conditional Automation';
  if (triggerCount > 1) return 'Multi-Trigger Automation';
  if (hasIntegration) return 'Integration Automation';
  return 'Event Automation';
}

export function toPreviewNodes(workflow: AIDraftWorkflow | null | undefined): GeneratedPreviewNode[] {
  if (!workflow?.nodes) return [];

  return workflow.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    label: getNodeLabel(node),
    category: getNodeCategory(node.type),
    config: node.config || {},
  }));
}

export function toPreviewEdges(workflow: AIDraftWorkflow | null | undefined): GeneratedPreviewEdge[] {
  const connections = workflow?.definition?.edges || workflow?.connections || [];

  return connections.map((connection, index) => ({
    id: `edge_${connection.source}_${connection.target}_${index}`,
    source: connection.source,
    target: connection.target,
    ...(connection.condition ? { condition: connection.condition } : {}),
  }));
}

export interface NodePosition {
  x: number;
  y: number;
}

/**
 * Assigns deterministic layer positions (BFS depth from triggers) so the preview
 * renders as a readable left-to-right pipeline.
 */
export function layoutPreviewNodes(
  nodes: GeneratedPreviewNode[],
  edges: GeneratedPreviewEdge[]
): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  const depth = new Map<string, number>();
  const incoming = new Map<string, number>();

  for (const node of nodes) incoming.set(node.id, 0);
  for (const edge of edges) {
    if (incoming.has(edge.target)) incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
  }

  const roots = nodes.filter((node) => (incoming.get(node.id) || 0) === 0);
  const queue: Array<{ id: string; level: number }> = (roots.length > 0 ? roots : nodes.slice(0, 1)).map((node) => ({
    id: node.id,
    level: 0,
  }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (depth.has(current.id) && (depth.get(current.id) || 0) >= current.level) continue;
    depth.set(current.id, current.level);

    for (const edge of edges.filter((candidate) => candidate.source === current.id)) {
      queue.push({ id: edge.target, level: current.level + 1 });
    }
  }

  const columns = new Map<number, number>();
  for (const node of nodes) {
    const level = depth.get(node.id) ?? 0;
    const row = columns.get(level) ?? 0;
    columns.set(level, row + 1);
    positions[node.id] = { x: 80 + level * 260, y: 60 + row * 150 };
  }

  return positions;
}
