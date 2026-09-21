/**
 * NodeCapabilityRegistry
 *
 * Single source of truth for everything AI needs to know about workflow node
 * capabilities: supported node types, AI-safe descriptions, input/output
 * schemas, permission requirements, and risk classification. Replaces the
 * node knowledge previously hardcoded in AIWorkflowService and the AI
 * providers.
 */
import type {
  ConditionConfig,
  NodeType,
  ValidationError,
} from '../../types/workflow.js';

export type NodeRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type NodePermissionRequirement =
  | 'WORKFLOW_CREATE'
  | 'WORKFLOW_UPDATE'
  | 'WORKFLOW_EXECUTE'
  | 'SECRETS_MANAGE'
  | 'AI_GOVERNANCE_MANAGE';

export interface NodeCapabilityField {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'unknown';
  required: boolean;
}

export interface NodeCapability {
  type: NodeType;
  displayName: string;
  description: string;
  aiDescription: string;
  riskLevel: NodeRiskLevel;
  requiredPermissions: NodePermissionRequirement[];
  inputSchema: NodeCapabilityField[];
  outputSchema: NodeCapabilityField[];
  allowedOperators?: ConditionConfig['operator'][];
  maxInstancesPerWorkflow?: number;
  graphHints: string[];
}

export interface NodeRegistryEntry extends NodeCapability {
  configSchema: unknown;
}

const NODE_CAPABILITIES: NodeCapability[] = [
  {
    type: 'webhook',
    displayName: 'Webhook Trigger',
    description: 'Starts the workflow when the engine receives an inbound HTTP webhook event.',
    aiDescription:
      'Entry trigger node. Every workflow must contain exactly one webhook node; it accepts no configuration and produces the inbound event payload.',
    riskLevel: 'LOW',
    requiredPermissions: ['WORKFLOW_CREATE', 'WORKFLOW_EXECUTE'],
    inputSchema: [],
    outputSchema: [
      { name: 'payload', description: 'Raw inbound webhook event body', type: 'unknown', required: true },
    ],
    maxInstancesPerWorkflow: 1,
    graphHints: [
      'Exactly one webhook node is required per workflow',
      'The webhook node must be the graph entry point with no incoming edges',
    ],
  },
  {
    type: 'condition',
    displayName: 'Condition',
    description: 'Branches the graph by evaluating a field against a value with a comparison operator.',
    aiDescription:
      'Branch node. Emits exactly two outgoing edges tagged condition "true" and condition "false" so every branch is handled.',
    riskLevel: 'MEDIUM',
    requiredPermissions: ['WORKFLOW_CREATE', 'WORKFLOW_UPDATE'],
    inputSchema: [
      { name: 'field', description: 'Payload field to evaluate', type: 'string', required: true },
      { name: 'operator', description: 'Comparison operator', type: 'string', required: true },
      { name: 'value', description: 'Reference value the field is compared against', type: 'unknown', required: true },
    ],
    outputSchema: [
      { name: 'true', description: 'Branch taken when the condition matches', type: 'boolean', required: false },
      { name: 'false', description: 'Branch taken when the condition does not match', type: 'boolean', required: false },
    ],
    allowedOperators: ['equals', 'notEquals', 'greaterThan', 'lessThan'],
    graphHints: [
      'Always wire both the true and false branches to reachable nodes',
      'Operators are limited to equals, notEquals, greaterThan, lessThan',
    ],
  },
  {
    type: 'log',
    displayName: 'Log / Action Step',
    description: 'Terminal action step that records a message for the execution audit trail.',
    aiDescription:
      'Safe action step. Use it as the workflow outcome (notification, approval, escalation). Needs a non-empty message.',
    riskLevel: 'LOW',
    requiredPermissions: ['WORKFLOW_CREATE', 'WORKFLOW_UPDATE'],
    inputSchema: [
      { name: 'message', description: 'Message written to the execution log', type: 'string', required: true },
    ],
    outputSchema: [
      { name: 'message', description: 'The message that was logged', type: 'string', required: true },
    ],
    graphHints: ['Provide a non-empty message so the audit trail stays useful'],
  },
  {
    type: 'agent',
    displayName: 'AI Agent',
    description: 'Runs an AI agent turn with tools, memory, and orchestration modes inside the graph.',
    aiDescription:
      'Autonomous node. Requires systemPrompt; model, toolsAllowed, maxTurns, temperature, memoryEnabled, delegationAllowed and orchestrationMode are optional.',
    riskLevel: 'HIGH',
    requiredPermissions: ['WORKFLOW_CREATE', 'WORKFLOW_UPDATE', 'AI_GOVERNANCE_MANAGE'],
    inputSchema: [
      { name: 'systemPrompt', description: 'Instruction the agent follows', type: 'string', required: true },
      { name: 'model', description: 'AI model override', type: 'string', required: false },
      { name: 'toolsAllowed', description: 'Tool names the agent may call', type: 'unknown', required: false },
      { name: 'maxTurns', description: 'Maximum reasoning turns', type: 'number', required: false },
      { name: 'temperature', description: 'Sampling temperature between 0 and 2', type: 'number', required: false },
      { name: 'memoryEnabled', description: 'Maintain conversation memory across turns', type: 'boolean', required: false },
      { name: 'delegationAllowed', description: 'Allow delegating to other agents', type: 'boolean', required: false },
      { name: 'orchestrationMode', description: 'Agent orchestration mode (autonomous, sequential, parallel, consensus, supervisor_worker)', type: 'string', required: false },
    ],
    outputSchema: [
      { name: 'output', description: 'Final agent output text', type: 'string', required: true },
      { name: 'trace', description: 'Reasoning and tool-call trace', type: 'unknown', required: false },
    ],
    graphHints: [
      'systemPrompt is mandatory for agent nodes',
      'Prefer an explicit maxTurns to bound agent execution',
    ],
  },
];

export function getNodeCapabilityRegistry(): NodeCapabilityRegistry {
  return NodeCapabilityRegistry.getInstance();
}

export class NodeCapabilityRegistry {
  private static instance: NodeCapabilityRegistry;
  private readonly capabilities: ReadonlyMap<NodeType, NodeRegistryEntry>;

  private constructor() {
    const entries = new Map<NodeType, NodeRegistryEntry>();
    for (const capability of NODE_CAPABILITIES) {
      entries.set(capability.type, {
        ...capability,
        configSchema: this.buildConfigSchema(capability),
      });
    }
    this.capabilities = entries;
  }

  public static getInstance(): NodeCapabilityRegistry {
    if (!NodeCapabilityRegistry.instance) {
      NodeCapabilityRegistry.instance = new NodeCapabilityRegistry();
    }
    return NodeCapabilityRegistry.instance;
  }

  /** All registered node types. */
  listTypes(): NodeType[] {
    return Array.from(this.capabilities.keys());
  }

  /** All capability records including AI-safe descriptions and schemas. */
  listCapabilities(): NodeRegistryEntry[] {
    return Array.from(this.capabilities.values());
  }

  /** Capability record for a single node type. */
  getCapability(type: string): NodeRegistryEntry | null {
    return this.capabilities.get(type as NodeType) ?? null;
  }

  /** Whether a node type is registered (i.e. supported by the engine). */
  isSupported(type: string): type is NodeType {
    return this.capabilities.has(type as NodeType);
  }

  /** Highest risk classification across a set of node types. */
  maxRiskLevel(types: Array<string>): NodeRiskLevel {
    const order: NodeRiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
    let highest: NodeRiskLevel = 'LOW';
    for (const type of types) {
      const capability = this.capabilities.get(type as NodeType);
      if (capability && order.indexOf(capability.riskLevel) > order.indexOf(highest)) {
        highest = capability.riskLevel;
      }
    }
    return highest;
  }

  /** Union of permissions required to build workflows containing the given node types. */
  requiredPermissions(types: Array<string>): NodePermissionRequirement[] {
    const unique = new Set<NodePermissionRequirement>();
    for (const type of types) {
      for (const permission of this.capabilities.get(type as NodeType)?.requiredPermissions ?? []) {
        unique.add(permission);
      }
    }
    return Array.from(unique);
  }

  /** JSON-schema-like representation of a node config, derived from the capability record. */
  getJsonSchema(type: string): Record<string, unknown> | null {
    const schema = this.capabilities.get(type as NodeType)?.configSchema;
    return schema ? (schema as Record<string, unknown>) : null;
  }

  /**
   * Compact catalog string injected into AI generation prompts so providers no
   * longer need hardcoded node knowledge.
   */
  buildGenerationContext(): string {
    const lines: string[] = ['Node capability registry (authoritative engine catalog):'];
    for (const capability of this.capabilities.values()) {
      lines.push(
        `- ${capability.type} (${capability.displayName}, risk: ${capability.riskLevel}) - ${capability.aiDescription}`,
      );
      for (const hint of capability.graphHints) {
        lines.push(`  * ${hint}`);
      }
      if (capability.allowedOperators) {
        lines.push(`  * Operators: ${capability.allowedOperators.join(', ')}`);
      }
    }
    return lines.join('\n');
  }

  /** Structured catalog payload for API consumers such as the copilot. */
  buildCatalogPayload(): {
    nodes: NodeRegistryEntry[];
    riskLevels: NodeRiskLevel[];
    permissions: NodePermissionRequirement[];
  } {
    const entries = this.listCapabilities();
    return {
      nodes: entries,
      riskLevels: Array.from(new Set(entries.map((entry) => entry.riskLevel))),
      permissions: this.requiredPermissions(entries.map((entry) => entry.type)),
    };
  }

  /**
   * Registry view tailored for AI repair prompts: node catalog plus the
   * validation errors from the previous generation attempt.
   */
  buildRepairContext(errors: ValidationError[]): string {
    const errorLines = errors.map((error, index) =>
      `${index + 1}. [${error.type}] ${error.message}${error.nodeId ? ` (node: ${error.nodeId})` : ''}`,
    );
    return [
      'Validation failed for the generated workflow draft.',
      'Validation errors:',
      ...(errorLines.length > 0 ? errorLines : ['(no structured errors reported)']),
      '',
      this.buildGenerationContext(),
    ].join('\n');
  }

  private buildConfigSchema(capability: NodeCapability): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const field of capability.inputSchema) {
      properties[field.name] = {
        type: field.type === 'unknown' ? 'any' : field.type,
        description: field.description,
      };
      if (field.required) required.push(field.name);
    }
    if (capability.allowedOperators) {
      properties.operator = { type: 'string', enum: [...capability.allowedOperators] };
    }
    return { type: 'object', properties, required };
  }
}
