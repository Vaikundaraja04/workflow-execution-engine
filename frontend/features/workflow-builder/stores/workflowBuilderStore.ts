import { create } from 'zustand';
import {
  type NodeChange,
  type EdgeChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '@/types/workflow';
import type {
  BuilderNode,
  BuilderEdge,
  BuilderNodeType,
  BuilderNodeData,
  GraphValidationError,
  NodeCategory,
} from '../types/workflowBuilder';

interface GraphSnapshot {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
}

interface WorkflowBuilderState {
  // Workflow Metadata
  workflowId: string | null;
  workflowName: string;
  workflowDescription: string;
  currentVersion: number;
  publishedVersion: number | null;
  setPublishedVersion: (version: number) => void;
  isReadOnly: boolean;

  // React Flow Graph
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  selectedNodeId: string | null;

  // Status & Validation
  isDirty: boolean;
  isSaving: boolean;
  isValidating: boolean;
  isPublishing: boolean;
  validationErrors: GraphValidationError[];
  validationWarnings: GraphValidationError[];

  // Undo / Redo
  past: GraphSnapshot[];
  future: GraphSnapshot[];

  // Actions
  setWorkflowId: (id: string | null) => void;
  setWorkflowName: (name: string) => void;
  setWorkflowDescription: (desc: string) => void;
  setIsReadOnly: (readOnly: boolean) => void;
  setSelectedNodeId: (id: string | null) => void;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  addNode: (nodeType: BuilderNodeType, position: { x: number; y: number }, initialConfig?: Record<string, unknown>) => BuilderNode;
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  updateNodeLabel: (nodeId: string, label: string) => void;
  deleteNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;

  validateGraphLocally: () => GraphValidationError[];
  setBackendValidationErrors: (errors: Array<{ type: string; message: string; nodeId?: string; edge?: { source: string; target: string } }>) => void;

  toBackendDefinition: () => WorkflowDefinition;
  loadFromBackendDefinition: (
    name: string,
    definition: WorkflowDefinition | null | undefined,
    workflowId?: string | null,
    currentVersion?: number,
    publishedVersion?: number | null,
    isReadOnly?: boolean
  ) => void;

  undo: () => void;
  redo: () => void;
  saveSnapshot: () => void;
  reset: () => void;
}

function getNodeCategory(type: BuilderNodeType): NodeCategory {
  if (type === 'webhook_trigger' || type === 'manual_trigger' || type === 'schedule_trigger' || type === 'webhook') {
    return 'trigger';
  }
  if (type === 'condition' || type === 'delay' || type === 'branch') {
    return 'logic';
  }
  if (type === 'installed_template') {
    return 'marketplace';
  }
  return 'action';
}

function getReactFlowNodeType(type: BuilderNodeType): string {
  if (type === 'webhook' || type === 'webhook_trigger') return 'webhookNode';
  if (type === 'manual_trigger' || type === 'schedule_trigger') return 'triggerNode';
  if (type === 'condition') return 'conditionNode';
  if (type === 'delay') return 'delayNode';
  return 'actionNode';
}

function getDefaultLabel(type: BuilderNodeType): string {
  switch (type) {
    case 'webhook_trigger':
    case 'webhook':
      return 'Webhook Trigger';
    case 'manual_trigger':
      return 'Manual Trigger';
    case 'schedule_trigger':
      return 'Schedule Trigger';
    case 'http_request':
      return 'HTTP Request';
    case 'email':
      return 'Send Email';
    case 'database_query':
      return 'Database Query';
    case 'notification':
      return 'Send Notification';
    case 'log':
      return 'Log Output';
    case 'condition':
      return 'Condition Check';
    case 'delay':
      return 'Delay Timer';
    case 'branch':
      return 'Branch';
    default:
      return 'Action Step';
  }
}

function getDefaultConfig(type: BuilderNodeType): Record<string, unknown> {
  switch (type) {
    case 'webhook_trigger':
    case 'webhook':
      return { path: '/webhook', method: 'POST', authRequired: false };
    case 'manual_trigger':
      return { description: 'Manual invocation' };
    case 'schedule_trigger':
      return { cronExpression: '0 * * * *', timezone: 'UTC' };
    case 'http_request':
      return { url: 'https://api.example.com/data', method: 'GET', timeoutMs: 5000, retryCount: 0 };
    case 'email':
      return { recipient: 'user@example.com', subject: 'Notification', message: 'Hello from Workflow Engine' };
    case 'database_query':
      return { query: 'SELECT * FROM users LIMIT 10;', database: 'default' };
    case 'notification':
      return { channel: 'in_app', message: 'Workflow notification', level: 'info' };
    case 'log':
      return { message: 'Workflow step execution completed' };
    case 'condition':
      return { field: 'status', operator: 'equals', value: 'success' };
    case 'delay':
      return { durationSeconds: 5, mode: 'fixed' };
    default:
      return {};
  }
}

export const useWorkflowBuilderStore = create<WorkflowBuilderState>((set, get) => ({
  workflowId: null,
  workflowName: 'Untitled Workflow',
  workflowDescription: '',
  currentVersion: 1,
  publishedVersion: null,
  isReadOnly: false,

  nodes: [],
  edges: [],
  selectedNodeId: null,

  isDirty: false,
  isSaving: false,
  isValidating: false,
  isPublishing: false,
  validationErrors: [],
  validationWarnings: [],

  past: [],
  future: [],

  setWorkflowId: (id) => set({ workflowId: id }),
  setWorkflowName: (name) => set({ workflowName: name, isDirty: true }),
  setWorkflowDescription: (desc) => set({ workflowDescription: desc, isDirty: true }),
  setIsReadOnly: (readOnly) => set({ isReadOnly: readOnly }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  saveSnapshot: () => {
    const { nodes, edges, past } = get();
    set({
      past: [...past.slice(-20), { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) }],
      future: [],
    });
  },

  onNodesChange: (changes) => {
    const { nodes, isReadOnly } = get();
    if (isReadOnly) return;
    const nextNodes = applyNodeChanges(changes, nodes) as BuilderNode[];
    set({ nodes: nextNodes, isDirty: true });
  },

  onEdgesChange: (changes) => {
    const { edges, isReadOnly } = get();
    if (isReadOnly) return;
    const nextEdges = applyEdgeChanges(changes, edges) as BuilderEdge[];
    set({ edges: nextEdges, isDirty: true });
  },

  onConnect: (connection) => {
    const { edges, nodes, isReadOnly, saveSnapshot } = get();
    if (isReadOnly || !connection.source || !connection.target) return;

    // Prevent self-connections
    if (connection.source === connection.target) return;

    saveSnapshot();

    const isConditionSource = connection.sourceHandle === 'true' || connection.sourceHandle === 'false';
    const conditionLabel = isConditionSource ? (connection.sourceHandle as 'true' | 'false') : undefined;

    const newEdge: BuilderEdge = {
      id: `edge_${connection.source}_${connection.target}_${connection.sourceHandle || 'default'}_${Date.now()}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      type: isConditionSource ? 'conditionEdge' : 'default',
      label: conditionLabel,
      data: {
        condition: conditionLabel,
      },
    };

    set({
      edges: [...edges, newEdge],
      isDirty: true,
    });

    get().validateGraphLocally();
  },

  addNode: (nodeType, position, initialConfig) => {
    const { nodes, isReadOnly, saveSnapshot } = get();
    if (isReadOnly) {
      throw new Error('Workflow is read-only');
    }

    saveSnapshot();

    const category = getNodeCategory(nodeType);
    const rfType = getReactFlowNodeType(nodeType);
    const label = getDefaultLabel(nodeType);
    const config = initialConfig || getDefaultConfig(nodeType);

    const prefix = nodeType.replace(/_trigger$/, '').toLowerCase();
    const count = nodes.filter((n) => n.data.nodeType === nodeType).length + 1;
    const nodeId = `${prefix}_${Date.now().toString(36).slice(-4)}_${count}`;

    const newNode: BuilderNode = {
      id: nodeId,
      type: rfType,
      position,
      data: {
        label,
        nodeType,
        category,
        config,
        isConfigured: true,
      },
    };

    set({
      nodes: [...nodes, newNode],
      selectedNodeId: nodeId,
      isDirty: true,
    });

    get().validateGraphLocally();
    return newNode;
  },

  updateNodeConfig: (nodeId, config) => {
    const { nodes, isReadOnly, saveSnapshot } = get();
    if (isReadOnly) return;

    saveSnapshot();

    const nextNodes = nodes.map((node) => {
      if (node.id === nodeId) {
        return {
          ...node,
          data: {
            ...node.data,
            config: { ...node.data.config, ...config },
            isConfigured: true,
            validationError: undefined,
          },
        };
      }
      return node;
    });

    set({ nodes: nextNodes, isDirty: true });
    get().validateGraphLocally();
  },

  updateNodeLabel: (nodeId, label) => {
    const { nodes, isReadOnly } = get();
    if (isReadOnly) return;

    const nextNodes = nodes.map((node) => {
      if (node.id === nodeId) {
        return {
          ...node,
          data: {
            ...node.data,
            label,
          },
        };
      }
      return node;
    });

    set({ nodes: nextNodes, isDirty: true });
  },

  deleteNode: (nodeId) => {
    const { nodes, edges, selectedNodeId, isReadOnly, saveSnapshot } = get();
    if (isReadOnly) return;

    saveSnapshot();

    const nextNodes = nodes.filter((node) => node.id !== nodeId);
    const nextEdges = edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);

    set({
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeId: selectedNodeId === nodeId ? null : selectedNodeId,
      isDirty: true,
    });

    get().validateGraphLocally();
  },

  duplicateNode: (nodeId) => {
    const { nodes, isReadOnly, saveSnapshot } = get();
    if (isReadOnly) return;

    const targetNode = nodes.find((n) => n.id === nodeId);
    if (!targetNode) return;

    saveSnapshot();

    const newId = `${targetNode.id}_copy_${Date.now().toString(36).slice(-3)}`;
    const newNode: BuilderNode = {
      ...targetNode,
      id: newId,
      position: {
        x: targetNode.position.x + 40,
        y: targetNode.position.y + 40,
      },
      data: {
        ...targetNode.data,
        label: `${targetNode.data.label} (Copy)`,
      },
      selected: true,
    };

    const deselectNodes = nodes.map((n) => ({ ...n, selected: false }));

    set({
      nodes: [...deselectNodes, newNode],
      selectedNodeId: newId,
      isDirty: true,
    });

    get().validateGraphLocally();
  },

  deleteEdge: (edgeId) => {
    const { edges, isReadOnly, saveSnapshot } = get();
    if (isReadOnly) return;

    saveSnapshot();

    set({
      edges: edges.filter((e) => e.id !== edgeId),
      isDirty: true,
    });

    get().validateGraphLocally();
  },

  validateGraphLocally: () => {
    const { nodes, edges } = get();
    const errors: GraphValidationError[] = [];
    const warnings: GraphValidationError[] = [];
    const nodeIds = new Set<string>();

    if (nodes.length === 0) {
      errors.push({
        type: 'EMPTY_GRAPH',
        message: 'Workflow has no nodes',
        severity: 'error',
      });
      set({ validationErrors: errors, validationWarnings: warnings });
      return errors;
    }

    // Check duplicate node IDs
    for (const node of nodes) {
      if (nodeIds.has(node.id)) {
        errors.push({
          type: 'DUPLICATE_NODE',
          message: `Duplicate node ID: ${node.id}`,
          nodeId: node.id,
          severity: 'error',
        });
      } else {
        nodeIds.add(node.id);
      }
    }

    // Check edges
    const edgeSet = new Set<string>();
    for (const edge of edges) {
      if (!nodeIds.has(edge.source)) {
        errors.push({
          type: 'MISSING_SOURCE',
          message: `Edge source not found: ${edge.source}`,
          edge: { source: edge.source, target: edge.target },
          severity: 'error',
        });
      }
      if (!nodeIds.has(edge.target)) {
        errors.push({
          type: 'MISSING_TARGET',
          message: `Edge target not found: ${edge.target}`,
          edge: { source: edge.source, target: edge.target },
          severity: 'error',
        });
      }
      if (edge.source === edge.target) {
        errors.push({
          type: 'SELF_CONNECTION',
          message: `Self connection detected on node: ${edge.source}`,
          edge: { source: edge.source, target: edge.target },
          severity: 'error',
        });
      }
      const key = `${edge.source}->${edge.target}`;
      if (edgeSet.has(key)) {
        errors.push({
          type: 'DUPLICATE_EDGE',
          message: `Duplicate connection: ${edge.source} -> ${edge.target}`,
          edge: { source: edge.source, target: edge.target },
          severity: 'error',
        });
      } else {
        edgeSet.add(key);
      }
    }

    // Check triggers (webhook count)
    const triggerNodes = nodes.filter(
      (n) => n.data.category === 'trigger' || n.data.nodeType === 'webhook' || n.data.nodeType === 'webhook_trigger' || n.data.nodeType === 'manual_trigger' || n.data.nodeType === 'schedule_trigger'
    );
    if (triggerNodes.length === 0) {
      errors.push({
        type: 'MISSING_TRIGGER',
        message: 'Workflow requires at least one trigger node (e.g. Webhook Trigger)',
        severity: 'error',
      });
    }

    // Detect cycles using DFS
    const visited = new Set<string>();
    const recStack = new Set<string>();
    function hasCycle(nodeId: string): boolean {
      visited.add(nodeId);
      recStack.add(nodeId);
      const outgoing = edges.filter((e) => e.source === nodeId);
      for (const edge of outgoing) {
        if (!visited.has(edge.target)) {
          if (hasCycle(edge.target)) return true;
        } else if (recStack.has(edge.target)) {
          errors.push({
            type: 'CYCLE_DETECTED',
            message: `Cycle detected involving node: ${edge.target}`,
            nodeId: edge.target,
            severity: 'error',
          });
          return true;
        }
      }
      recStack.delete(nodeId);
      return false;
    }

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        hasCycle(node.id);
      }
    }

    // Detect unreachable nodes (if 1 trigger)
    if (triggerNodes.length === 1 && triggerNodes[0]) {
      const rootId = triggerNodes[0].id;
      const reachable = new Set<string>();
      function dfs(id: string) {
        if (reachable.has(id)) return;
        reachable.add(id);
        for (const edge of edges) {
          if (edge.source === id) dfs(edge.target);
        }
      }
      dfs(rootId);
      for (const node of nodes) {
        if (!reachable.has(node.id)) {
          warnings.push({
            type: 'UNREACHABLE',
            message: `Unreachable node from trigger: ${node.data.label || node.id}`,
            nodeId: node.id,
            severity: 'warning',
          });
        }
      }
    }

    // Update node error markers
    const updatedNodes = nodes.map((n) => {
      const nodeErr = errors.find((e) => e.nodeId === n.id);
      return {
        ...n,
        data: {
          ...n.data,
          validationError: nodeErr ? nodeErr.message : undefined,
        },
      };
    });

    set({
      nodes: updatedNodes,
      validationErrors: errors,
      validationWarnings: warnings,
    });

    return errors;
  },

  setBackendValidationErrors: (backendErrors) => {
    const mapped: GraphValidationError[] = backendErrors.map((err) => ({
      type: err.type,
      message: err.message,
      nodeId: err.nodeId,
      edge: err.edge,
      severity: 'error',
    }));

    const { nodes } = get();
    const updatedNodes = nodes.map((n) => {
      const nodeErr = mapped.find((e) => e.nodeId === n.id);
      return {
        ...n,
        data: {
          ...n.data,
          validationError: nodeErr ? nodeErr.message : undefined,
        },
      };
    });

    set({
      nodes: updatedNodes,
      validationErrors: mapped,
    });
  },

  toBackendDefinition: (): WorkflowDefinition => {
    const { nodes, edges } = get();

    // Map UI nodes to backend WorkflowNode schema (type: 'webhook' | 'condition' | 'log')
    const backendNodes: WorkflowNode[] = nodes.map((node) => {
      const nodeType = node.data.nodeType;
      const config = node.data.config || {};

      if (nodeType === 'webhook' || nodeType === 'webhook_trigger' || nodeType === 'manual_trigger' || nodeType === 'schedule_trigger') {
        return {
          id: node.id,
          type: 'webhook',
          config: {},
        };
      }

      if (nodeType === 'condition') {
        const condConfig = config as { field?: string; operator?: string; value?: unknown };
        return {
          id: node.id,
          type: 'condition',
          config: {
            field: condConfig.field || 'input.status',
            operator: condConfig.operator || 'equals',
            value: condConfig.value !== undefined ? condConfig.value : 'success',
          },
        };
      }

      // Default actions and logs map to backend 'log' node with serialized action summary or message
      let message = 'Action step executed';
      if (nodeType === 'http_request') {
        const http = config as { method?: string; url?: string };
        message = `HTTP ${http.method || 'GET'} ${http.url || ''}`;
      } else if (nodeType === 'email') {
        const em = config as { recipient?: string; subject?: string };
        message = `Send Email to ${em.recipient || ''}: ${em.subject || ''}`;
      } else if (nodeType === 'database_query') {
        const db = config as { query?: string };
        message = `DB Query: ${db.query || ''}`;
      } else if (nodeType === 'notification') {
        const notif = config as { channel?: string; message?: string };
        message = `Notification [${notif.channel || 'in_app'}]: ${notif.message || ''}`;
      } else if (nodeType === 'delay') {
        const d = config as { durationSeconds?: number };
        message = `Delay ${d.durationSeconds || 5}s`;
      } else if (nodeType === 'log') {
        const l = config as { message?: string };
        message = l.message || 'Log message';
      }

      return {
        id: node.id,
        type: 'log',
        config: {
          message,
        },
      };
    });

    const backendEdges: WorkflowEdge[] = edges.map((edge) => {
      const cond = edge.label === 'true' || edge.label === 'false' ? (edge.label as 'true' | 'false') : undefined;
      return {
        source: edge.source,
        target: edge.target,
        condition: cond,
      };
    });

    return {
      nodes: backendNodes,
      edges: backendEdges,
    };
  },

  setPublishedVersion: (version: number) => set({ publishedVersion: version, currentVersion: version }),

  loadFromBackendDefinition: (name, definition, workflowId = null, currentVersion = 1, publishedVersion = null, isReadOnly = false) => {
    if (!definition || !definition.nodes || definition.nodes.length === 0) {
      // Initialize with default trigger node
      const defaultTrigger: BuilderNode = {
        id: 'webhook_1',
        type: 'webhookNode',
        position: { x: 250, y: 50 },
        data: {
          label: 'Webhook Trigger',
          nodeType: 'webhook_trigger',
          category: 'trigger',
          config: { path: '/webhook', method: 'POST', authRequired: false },
          isConfigured: true,
        },
      };

      set({
        workflowId,
        workflowName: name || 'New Workflow',
        currentVersion,
        publishedVersion,
        isReadOnly,
        nodes: [defaultTrigger],
        edges: [],
        selectedNodeId: defaultTrigger.id,
        isDirty: false,
        past: [],
        future: [],
        validationErrors: [],
        validationWarnings: [],
      });
      return;
    }

    // Reconstruct React Flow nodes from backend definition with sensible layout positioning
    const nodes: BuilderNode[] = definition.nodes.map((n, index) => {
      let nodeType: BuilderNodeType = 'log';
      if (n.type === 'webhook') nodeType = 'webhook_trigger';
      else if (n.type === 'webhook_trigger') nodeType = 'webhook_trigger';
      else if (n.type === 'manual_trigger') nodeType = 'manual_trigger';
      else if (n.type === 'schedule_trigger') nodeType = 'schedule_trigger';
      else if (n.type === 'condition') nodeType = 'condition';
      else if (n.type === 'http_request') nodeType = 'http_request';
      else if (n.type === 'email') nodeType = 'email';
      else if (n.type === 'database_query') nodeType = 'database_query';
      else if (n.type === 'notification') nodeType = 'notification';
      else if (n.type === 'delay') nodeType = 'delay';
      else if (n.type === 'log') nodeType = 'log';
      else if (n.type === 'installed_template') nodeType = 'installed_template';

      const category = getNodeCategory(nodeType);
      const rfType = getReactFlowNodeType(nodeType);
      const label = n.name || getDefaultLabel(nodeType);

      // Simple grid positioning
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = 100 + col * 280;
      const y = 50 + row * 160;

      return {
        id: n.id,
        type: rfType,
        position: { x, y },
        data: {
          label,
          nodeType,
          category,
          config: n.config || getDefaultConfig(nodeType),
          isConfigured: true,
        },
      };
    });

    const edges: BuilderEdge[] = (definition.edges || []).map((e, index) => {
      const isCond = e.condition === 'true' || e.condition === 'false';
      return {
        id: `edge_${e.source}_${e.target}_${index}`,
        source: e.source,
        target: e.target,
        sourceHandle: isCond ? e.condition : undefined,
        type: isCond ? 'conditionEdge' : 'default',
        label: e.condition,
        data: { condition: e.condition },
      };
    });

    set({
      workflowId,
      workflowName: name,
      currentVersion,
      publishedVersion,
      isReadOnly,
      nodes,
      edges,
      selectedNodeId: nodes[0]?.id || null,
      isDirty: false,
      past: [],
      future: [],
      validationErrors: [],
      validationWarnings: [],
    });

    get().validateGraphLocally();
  },

  undo: () => {
    const { past, future, nodes, edges, isReadOnly } = get();
    if (isReadOnly || past.length === 0) return;

    const previous = past[past.length - 1];
    if (!previous) return;
    const newPast = past.slice(0, past.length - 1);

    set({
      past: newPast,
      future: [{ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) }, ...future],
      nodes: previous.nodes,
      edges: previous.edges,
      isDirty: true,
    });
  },

  redo: () => {
    const { past, future, nodes, edges, isReadOnly } = get();
    if (isReadOnly || future.length === 0) return;

    const next = future[0];
    if (!next) return;
    const newFuture = future.slice(1);

    set({
      past: [...past, { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) }],
      future: newFuture,
      nodes: next.nodes,
      edges: next.edges,
      isDirty: true,
    });
  },

  reset: () =>
    set({
      workflowId: null,
      workflowName: 'Untitled Workflow',
      workflowDescription: '',
      currentVersion: 1,
      publishedVersion: null,
      isReadOnly: false,
      nodes: [],
      edges: [],
      selectedNodeId: null,
      isDirty: false,
      isSaving: false,
      isValidating: false,
      isPublishing: false,
      validationErrors: [],
      validationWarnings: [],
      past: [],
      future: [],
    }),
}));
