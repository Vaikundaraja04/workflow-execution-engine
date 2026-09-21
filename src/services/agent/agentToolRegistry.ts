import { z } from 'zod';
import { AIProviderFactory } from '../ai/AIProviderFactory.js';
import { AIGovernanceGate } from '../aiGovernanceGate.js';
import { AnthropicProvider } from '../ai/AnthropicProvider.js';
import { OpenAIProvider } from '../ai/OpenAIProvider.js';
import { MockAIProvider } from '../ai/MockAIProvider.js';

// Define the tool result type
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, unknown>;
}

// Define the tool execution context
export interface ToolExecutionContext {
  workspaceId: string;
  userId: string;
  executionId?: string;
  variables?: Record<string, unknown>;
}

// Built-in tool schemas
export const HttpRequestToolSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const DatabaseQueryToolSchema = z.object({
  connectionId: z.string(),
  query: z.string(),
  parameters: z.array(z.unknown()).optional(),
});

export const WorkflowTriggerToolSchema = z.object({
  workflowId: z.string(),
  input: z.record(z.string(), z.unknown()).optional(),
  waitForCompletion: z.boolean().default(false),
  timeoutMs: z.number().int().positive().optional(),
});

export const CalculateToolSchema = z.object({
  expression: z.string(),
  variables: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
});

export const SummarizeToolSchema = z.object({
  text: z.string(),
  maxLength: z.number().int().positive().optional(),
  format: z.enum(['bullet_points', 'paragraph', 'key_points']).optional(),
});

export const JsonTransformToolSchema = z.object({
  input: z.unknown(),
  transformation: z.string(), // JSONPath or Jolt-like transformation specification
});

// Union of all tool input schemas
export type ToolInputSchema =
  | z.infer<typeof HttpRequestToolSchema>
  | z.infer<typeof DatabaseQueryToolSchema>
  | z.infer<typeof WorkflowTriggerToolSchema>
  | z.infer<typeof CalculateToolSchema>
  | z.infer<typeof SummarizeToolSchema>
  | z.infer<typeof JsonTransformToolSchema>;

// Tool definition interface
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny; // Zod schema for input validation
  execute: (input: any, context: ToolExecutionContext) => Promise<ToolResult>;
}

// Built-in tool implementations
class HttpRequestTool implements ToolDefinition {
  name = 'http_request';
  description = 'Make HTTP requests to external APIs';
  inputSchema = HttpRequestToolSchema;

  async execute(input: any, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const validatedInput = HttpRequestToolSchema.parse(input);

      // In a real implementation, this would use a HTTP client like axios or node-fetch
      // For now, we'll simulate the response
      return {
        success: true,
        data: {
          status: 200,
          headers: {},
          body: { message: `Simulated response from ${validatedInput.url}` },
        },
        metadata: {
          url: validatedInput.url,
          method: validatedInput.method,
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to execute HTTP request',
      };
    }
  }
}

class DatabaseQueryTool implements ToolDefinition {
  name = 'database_query';
  description = 'Execute SQL queries against connected databases';
  inputSchema = DatabaseQueryToolSchema;

  async execute(input: any, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const validatedInput = DatabaseQueryToolSchema.parse(input);

      // Simulate database query execution
      return {
        success: true,
        data: [
          { id: 1, name: 'Sample Record 1', value: 'test' },
          { id: 2, name: 'Sample Record 2', value: 'example' }
        ],
        metadata: {
          query: validatedInput.query,
          connectionId: validatedInput.connectionId,
          rowCount: 2
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to execute database query',
      };
    }
  }
}

class WorkflowTriggerTool implements ToolDefinition {
  name = 'workflow_trigger';
  description = 'Trigger execution of another workflow';
  inputSchema = WorkflowTriggerToolSchema;

  async execute(input: any, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const validatedInput = WorkflowTriggerToolSchema.parse(input);

      // Simulate workflow triggering
      return {
        success: true,
        data: {
          triggeredWorkflowId: validatedInput.workflowId,
          executionId: `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          status: validatedInput.waitForCompletion ? 'SUCCEEDED' : 'TRIGGERED',
        },
        metadata: {
          workflowId: validatedInput.workflowId,
          waitForCompletion: validatedInput.waitForCompletion,
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to trigger workflow',
      };
    }
  }
}

class CalculateTool implements ToolDefinition {
  name = 'calculate';
  description = 'Perform mathematical calculations';
  inputSchema = CalculateToolSchema;

  async execute(input: any, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const validatedInput = CalculateToolSchema.parse(input);

      // Simple expression evaluation (in production, use a safe math expression parser)
      // WARNING: This is a simplified implementation for demonstration
      let result: number | string | boolean;

      try {
        // Replace variables in expression
        let expression = validatedInput.expression;
        if (validatedInput.variables) {
          Object.entries(validatedInput.variables).forEach(([key, value]) => {
            expression = expression.replace(new RegExp(`\\b${key}\\b`, 'g'),
              typeof value === 'string' ? `"${value}"` : JSON.stringify(value));
          });
        }

        // Evaluate expression (NOTE: In production, use a proper math expression evaluator)
        // This is just for demonstration - NEVER use eval() in production with untrusted input
        result = eval(expression);
      } catch (evalError) {
        // Fallback to treating as string if evaluation fails
        result = validatedInput.expression;
      }

      return {
        success: true,
        data: result,
        metadata: {
          expression: validatedInput.expression,
          variables: validatedInput.variables,
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to perform calculation',
      };
    }
  }
}

class SummarizeTool implements ToolDefinition {
  name = 'summarize';
  description = 'Summarize text content using AI';
  inputSchema = SummarizeToolSchema;

  async execute(input: any, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const validatedInput = SummarizeToolSchema.parse(input);

      // Use AI provider to generate summary
      const { provider } = await AIProviderFactory.getProviderForWorkspace(
        context.workspaceId
      );

      const governance = await AIGovernanceGate.getInstance().authorize({
        workspaceId: context.workspaceId,
        feature: 'AI_AGENT',
        prompt: validatedInput.text.slice(0, 1000),
        ...(context.userId ? { userId: context.userId } : {}),
      });
      if (governance.decision === 'DENY' || governance.decision === 'REQUIRE_APPROVAL') {
        throw new Error('AI_GOVERNANCE_RESTRICTED');
      }

      const prompt = validatedInput.maxLength
        ? `Summarize the following text in ${validatedInput.format || 'paragraph'} format within ${validatedInput.maxLength} characters:\n\n${validatedInput.text}`
        : `Summarize the following text in ${validatedInput.format || 'paragraph'} format:\n\n${validatedInput.text}`;

      const summary = await provider.generateText(prompt, {
        temperature: 0.3,
        maxTokens: validatedInput.maxLength ? Math.min(validatedInput.maxLength / 4, 500) : 500,
      });

      return {
        success: true,
        data: summary,
        metadata: {
          originalLength: validatedInput.text.length,
          summaryLength: summary.length,
          format: validatedInput.format,
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to summarize text',
      };
    }
  }
}

class JsonTransformTool implements ToolDefinition {
  name = 'json_transform';
  description = 'Transform JSON data using specified transformation rules';
  inputSchema = JsonTransformToolSchema;

  async execute(input: any, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const validatedInput = JsonTransformToolSchema.parse(input);

      // Simple JSON transformation simulation
      // In production, this would use a proper JSON transformation library like JSONPath or Jolt
      let transformedData: any;

      try {
        // For demonstration, we'll just return the input if transformation is "identity"
        // or wrap it in an array if transformation is "toArray"
        if (validatedInput.transformation === 'identity') {
          transformedData = validatedInput.input;
        } else if (validatedInput.transformation === 'toArray' && !Array.isArray(validatedInput.input)) {
          transformedData = [validatedInput.input];
        } else if (validatedInput.transformation === 'first' && Array.isArray(validatedInput.input)) {
          transformedData = validatedInput.input[0];
        } else {
          // Default: return input as-is
          transformedData = validatedInput.input;
        }

        return {
          success: true,
          data: transformedData,
          metadata: {
            transformation: validatedInput.transformation,
            inputType: Array.isArray(validatedInput.input) ? 'array' : typeof validatedInput.input,
          }
        };
      } catch (transformError: unknown) {
        return {
          success: false,
          error: `Transformation failed: ${transformError instanceof Error ? transformError.message : String(transformError)}`,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to transform JSON',
      };
    }
  }
}

// Agent Tool Registry Service
export class AgentToolRegistry {
  private static instance: AgentToolRegistry;
  private tools: Map<string, ToolDefinition>;

  private constructor() {
    this.tools = new Map();
    // Register built-in tools
    this.registerTool(new HttpRequestTool());
    this.registerTool(new DatabaseQueryTool());
    this.registerTool(new WorkflowTriggerTool());
    this.registerTool(new CalculateTool());
    this.registerTool(new SummarizeTool());
    this.registerTool(new JsonTransformTool());
  }

  public static getInstance(): AgentToolRegistry {
    if (!AgentToolRegistry.instance) {
      AgentToolRegistry.instance = new AgentToolRegistry();
    }
    return AgentToolRegistry.instance;
  }

  public registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  public unregisterTool(toolName: string): boolean {
    return this.tools.delete(toolName);
  }

  public getTool(toolName: string): ToolDefinition | undefined {
    return this.tools.get(toolName);
  }

  public listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  public async executeTool(
    toolName: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const tool = this.getTool(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${toolName}`,
      };
    }

    try {
      // Validate input against tool schema
      tool.inputSchema.parse(input);

      // Execute the tool
      return await tool.execute(input, context);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return {
          success: false,
          error: `Invalid input: ${error.issues.map((e: z.ZodIssue) => e.message).join(', ')}`,
        };
      }
      return {
        success: false,
        error: error.message || 'Tool execution failed',
      };
    }
  }
}