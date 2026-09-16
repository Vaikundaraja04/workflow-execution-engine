import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflowBuilderStore } from '@/features/workflow-builder/stores/workflowBuilderStore';
import {
  httpRequestConfigSchema,
  emailConfigSchema,
  conditionConfigSchema,
  delayConfigSchema,
  notificationConfigSchema,
  webhookTriggerSchema,
} from '@/features/workflow-builder/schemas/nodeConfigSchemas';

describe('Workflow Builder State & Logic', () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().reset();
  });

  describe('Workflow Builder Store - Node & Edge Operations', () => {
    it('should initialize with empty graph', () => {
      const state = useWorkflowBuilderStore.getState();
      expect(state.nodes).toHaveLength(0);
      expect(state.edges).toHaveLength(0);
      expect(state.workflowName).toBe('Untitled Workflow');
      expect(state.isDirty).toBe(false);
    });

    it('should add nodes of various types correctly', () => {
      const store = useWorkflowBuilderStore.getState();

      const triggerNode = store.addNode('webhook_trigger', { x: 100, y: 100 }, {
        path: '/api/v1/webhook',
        method: 'POST',
      });

      const actionNode = store.addNode('http_request', { x: 300, y: 100 }, {
        url: 'https://api.example.com/data',
        method: 'GET',
      });

      const conditionNode = store.addNode('condition', { x: 500, y: 100 }, {
        field: 'status',
        operator: 'equals',
        value: 'success',
      });

      const currentState = useWorkflowBuilderStore.getState();
      expect(currentState.nodes).toHaveLength(3);
      expect(triggerNode.data.category).toBe('trigger');
      expect(actionNode.data.category).toBe('action');
      expect(conditionNode.data.category).toBe('logic');
      expect(currentState.isDirty).toBe(true);
    });

    it('should update node configuration and label', () => {
      const store = useWorkflowBuilderStore.getState();
      const node = store.addNode('http_request', { x: 100, y: 100 });

      store.updateNodeConfig(node.id, { url: 'https://updated.example.com', timeoutMs: 3000 });
      store.updateNodeLabel(node.id, 'Fetch User Profile');

      const updated = useWorkflowBuilderStore.getState().nodes.find((n) => n.id === node.id);
      expect(updated?.data.label).toBe('Fetch User Profile');
      expect((updated?.data.config as any).url).toBe('https://updated.example.com');
      expect((updated?.data.config as any).timeoutMs).toBe(3000);
    });

    it('should duplicate a node with offset position and new ID', () => {
      const store = useWorkflowBuilderStore.getState();
      const node = store.addNode('email', { x: 100, y: 100 }, {
        recipient: 'test@example.com',
        subject: 'Welcome',
      });

      store.duplicateNode(node.id);

      const state = useWorkflowBuilderStore.getState();
      expect(state.nodes).toHaveLength(2);
      const duplicate = state.nodes.find((n) => n.id !== node.id);
      expect(duplicate).toBeDefined();
      expect(duplicate?.position.x).toBe(140);
      expect(duplicate?.position.y).toBe(140);
      expect(duplicate?.data.label).toContain('(Copy)');
    });

    it('should delete a node and remove attached edges', () => {
      const store = useWorkflowBuilderStore.getState();
      const n1 = store.addNode('manual_trigger', { x: 100, y: 100 });
      const n2 = store.addNode('http_request', { x: 300, y: 100 });

      store.onConnect({
        source: n1.id,
        target: n2.id,
        sourceHandle: null,
        targetHandle: null,
      });

      expect(useWorkflowBuilderStore.getState().edges).toHaveLength(1);

      store.deleteNode(n1.id);

      const state = useWorkflowBuilderStore.getState();
      expect(state.nodes).toHaveLength(1);
      expect(state.edges).toHaveLength(0);
    });

    it('should handle undo and redo operations', () => {
      const store = useWorkflowBuilderStore.getState();

      const n1 = store.addNode('manual_trigger', { x: 100, y: 100 });
      expect(useWorkflowBuilderStore.getState().nodes).toHaveLength(1);

      store.addNode('http_request', { x: 300, y: 100 });
      expect(useWorkflowBuilderStore.getState().nodes).toHaveLength(2);

      useWorkflowBuilderStore.getState().undo();
      expect(useWorkflowBuilderStore.getState().nodes).toHaveLength(1);

      useWorkflowBuilderStore.getState().redo();
      expect(useWorkflowBuilderStore.getState().nodes).toHaveLength(2);
    });
  });

  describe('Workflow Builder Store - Graph Validation', () => {
    it('should flag empty graph as error', () => {
      const store = useWorkflowBuilderStore.getState();
      const errors = store.validateGraphLocally();
      expect(errors).toHaveLength(1);
      expect(errors[0].type).toBe('EMPTY_GRAPH');
    });

    it('should flag graph without trigger node', () => {
      const store = useWorkflowBuilderStore.getState();
      store.addNode('http_request', { x: 100, y: 100 });

      const errors = store.validateGraphLocally();
      expect(errors.some((e) => e.type === 'MISSING_TRIGGER')).toBe(true);
    });

    it('should detect cycles in the workflow graph', () => {
      const store = useWorkflowBuilderStore.getState();
      const t = store.addNode('manual_trigger', { x: 100, y: 100 });
      const a = store.addNode('http_request', { x: 300, y: 100 });
      const b = store.addNode('email', { x: 500, y: 100 });

      // Connect trigger -> a -> b -> a (cycle!)
      store.onConnect({ source: t.id, target: a.id, sourceHandle: null, targetHandle: null });
      store.onConnect({ source: a.id, target: b.id, sourceHandle: null, targetHandle: null });
      store.onConnect({ source: b.id, target: a.id, sourceHandle: null, targetHandle: null });

      const errors = store.validateGraphLocally();
      expect(errors.some((e) => e.type === 'CYCLE_DETECTED')).toBe(true);
    });

    it('should pass validation for a valid linear graph', () => {
      const store = useWorkflowBuilderStore.getState();
      const t = store.addNode('webhook_trigger', { x: 100, y: 100 });
      const a = store.addNode('http_request', { x: 300, y: 100 });
      const b = store.addNode('log', { x: 500, y: 100 });

      store.onConnect({ source: t.id, target: a.id, sourceHandle: null, targetHandle: null });
      store.onConnect({ source: a.id, target: b.id, sourceHandle: null, targetHandle: null });

      const errors = store.validateGraphLocally();
      expect(errors).toHaveLength(0);
    });
  });

  describe('Workflow Builder Store - Serialization & Deserialization', () => {
    it('should convert graph to backend-compatible definition', () => {
      const store = useWorkflowBuilderStore.getState();
      const t = store.addNode('webhook_trigger', { x: 100, y: 100 }, { path: '/hook' });
      const a = store.addNode('http_request', { x: 300, y: 100 }, { url: 'https://api.test' });

      store.onConnect({ source: t.id, target: a.id, sourceHandle: null, targetHandle: null });

      const def = store.toBackendDefinition();
      expect(def.nodes).toHaveLength(2);
      expect(def.edges).toHaveLength(1);
      expect(def.nodes[0].id).toBe(t.id);
      expect(def.nodes[1].id).toBe(a.id);
      expect(def.edges?.[0].source).toBe(t.id);
      expect(def.edges?.[0].target).toBe(a.id);
    });

    it('should load graph from backend definition and construct valid visual layout', () => {
      const store = useWorkflowBuilderStore.getState();

      const backendDef = {
        nodes: [
          { id: 'step_1', type: 'webhook', config: { path: '/incoming' } },
          { id: 'step_2', type: 'http_request', config: { url: 'https://example.com' } },
          { id: 'step_3', type: 'log', config: { message: 'Finished' } },
        ],
        edges: [
          { source: 'step_1', target: 'step_2' },
          { source: 'step_2', target: 'step_3' },
        ],
      };

      store.loadFromBackendDefinition(
        'Imported Pipeline',
        backendDef,
        'wf-12345',
        2,
        1,
        false
      );

      const state = useWorkflowBuilderStore.getState();
      expect(state.workflowName).toBe('Imported Pipeline');
      expect(state.workflowId).toBe('wf-12345');
      expect(state.currentVersion).toBe(2);
      expect(state.publishedVersion).toBe(1);
      expect(state.nodes).toHaveLength(3);
      expect(state.edges).toHaveLength(2);
      expect(state.nodes[0].data.nodeType).toBe('webhook_trigger');
      expect(state.nodes[1].data.nodeType).toBe('http_request');
      expect(state.nodes[2].data.nodeType).toBe('log');
    });
  });

  describe('Node Configuration Zod Schemas', () => {
    it('should validate HTTP request configuration', () => {
      const valid = httpRequestConfigSchema.safeParse({
        url: 'https://api.github.com/users',
        method: 'POST',
        timeoutMs: 5000,
        retryCount: 2,
      });
      expect(valid.success).toBe(true);

      const invalid = httpRequestConfigSchema.safeParse({
        url: 'invalid-url',
        method: 'POST',
        timeoutMs: 50,
        retryCount: 10,
      });
      expect(invalid.success).toBe(false);
    });

    it('should validate Email configuration', () => {
      const valid = emailConfigSchema.safeParse({
        recipient: 'admin@company.com',
        subject: 'Critical Alert',
        message: 'High CPU usage detected',
      });
      expect(valid.success).toBe(true);

      const invalidEmail = emailConfigSchema.safeParse({
        recipient: 'not-an-email',
        subject: '',
        message: '',
      });
      expect(invalidEmail.success).toBe(false);
    });

    it('should validate Condition configuration', () => {
      const valid = conditionConfigSchema.safeParse({
        field: 'response.status',
        operator: 'equals',
        value: 200,
      });
      expect(valid.success).toBe(true);

      const invalid = conditionConfigSchema.safeParse({
        field: '',
        operator: 'invalidOperator' as any,
        value: undefined,
      });
      expect(invalid.success).toBe(false);
    });

    it('should validate Delay configuration', () => {
      const valid = delayConfigSchema.safeParse({
        durationSeconds: 60,
        mode: 'fixed',
      });
      expect(valid.success).toBe(true);

      const invalid = delayConfigSchema.safeParse({
        durationSeconds: -5,
        mode: 'fixed',
      });
      expect(invalid.success).toBe(false);
    });

    it('should validate Notification configuration', () => {
      const valid = notificationConfigSchema.safeParse({
        channel: 'slack',
        message: 'Deployment complete',
        level: 'info',
      });
      expect(valid.success).toBe(true);
    });

    it('should validate Webhook Trigger configuration', () => {
      const valid = webhookTriggerSchema.safeParse({
        method: 'POST',
        path: '/events/stripe',
        authRequired: true,
      });
      expect(valid.success).toBe(true);
    });
  });
});
