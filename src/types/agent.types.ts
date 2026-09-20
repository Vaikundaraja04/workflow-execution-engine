export type AgentOrchestrationMode =
  | 'autonomous'
  | 'sequential'
  | 'parallel'
  | 'consensus'
  | 'supervisor_worker';

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema for tool parameters
  required?: string[];
}

export interface AgentNodeConfig {
  systemPrompt: string;
  model?: string;
  toolsAllowed?: string[]; // List of tool names the agent can use
  maxTurns?: number; // Maximum reasoning turns
  temperature?: number; // Sampling temperature
  memoryEnabled?: boolean; // Whether to maintain conversation memory
  delegationAllowed?: boolean; // Whether agent can delegate to other agents
  orchestrationMode?: AgentOrchestrationMode;
  customTools?: AgentToolDefinition[]; // Custom workspace-defined tools
}

export interface AgentExecutionTrace {
  turn: number;
  timestamp: Date;
  action: 'thought' | 'tool_call' | 'tool_result' | 'delegation' | 'final_output';
  content: string;
  toolName?: string;
  toolResult?: any;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AgentNodeResult {
  output: string;
  trace: AgentExecutionTrace[];
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  delegatedTo?: string[]; // Agent IDs that were delegated to
  consensusVote?: {
    votes: Record<string, number>; // agentId -> vote weight
    winningOption: string;
    confidence: number;
  };
}