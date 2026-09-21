import type {
  AIProvider,
  AIGenerationOptions,
  GeneratedWorkflow,
  ExecutionAnalysisInput,
  ExecutionAnalysisResult,
  WorkflowOptimizationInput,
  OptimizationResult,
} from './AIProvider.js';

export class OpenAIProvider implements AIProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model: string = 'gpt-4o-mini', baseUrl: string = 'https://api.openai.com/v1') {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async generateText(prompt: string, options: AIGenerationOptions = {}): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY_MISSING: OpenAI API key is required');
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model || this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 2000,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? '';
    } catch (error) {
      throw new Error(`OpenAI text generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async generateWorkflow(prompt: string, options: AIGenerationOptions = {}): Promise<GeneratedWorkflow> {
    // Node capability knowledge comes from the NodeCapabilityRegistry (injected via
    // options.systemContext); the provider no longer hardcodes node types.
    const nodeCatalog = options.systemContext ?? '';
    const systemPrompt = `You are a workflow engine architect. Generate a workflow definition in JSON format based on the user prompt.
${nodeCatalog}
Edges must connect existing node IDs.
Response format strictly JSON:
{
  "workflowName": "string",
  "description": "string",
  "nodes": [{ "id": "string", "type": string, "config": {} }],
  "connections": [{ "source": "string", "target": "string", "condition": "true" | "false" (optional) }],
  "variables": {}
}`;

    const text = await this.generateText(`${systemPrompt}\n\nUser Request: ${prompt}`, options);
    try {
      // Strip any markdown fences if present
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned) as GeneratedWorkflow;
      return {
        ...parsed,
        definition: {
          nodes: parsed.nodes,
          edges: parsed.connections.map((c) => ({
            source: c.source || c.from || '',
            target: c.target || c.to || '',
            ...(c.condition ? { condition: c.condition as 'true' | 'false' } : {}),
          })),
        },
      };
    } catch (parseError) {
      throw new Error(`Failed to parse AI-generated workflow response: ${String(parseError)}`);
    }
  }

  async analyzeExecution(executionData: ExecutionAnalysisInput): Promise<ExecutionAnalysisResult> {
    const prompt = `Analyze this workflow execution failure and provide root cause analysis:
Execution ID: ${executionData.executionId}
Status: ${executionData.status}
Error: ${executionData.error || JSON.stringify(executionData.errors)}
Step Statuses: ${JSON.stringify(executionData.stepStatuses)}
Retry Attempts: ${executionData.retryAttempts}
Execution History: ${JSON.stringify(executionData.executionHistory)}

Return JSON:
{
  "summary": "Short summary",
  "rootCause": "Detailed root cause",
  "affectedNode": "nodeId or null",
  "suggestedFix": "Suggested fix",
  "confidence": 0.95
}`;

    const text = await this.generateText(prompt);
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned) as ExecutionAnalysisResult;
    } catch {
      return {
        summary: `Execution ${executionData.executionId} failed`,
        rootCause: executionData.error || 'Execution step error',
        affectedNode: executionData.errors?.[0]?.nodeId || null,
        suggestedFix: 'Review failed step configurations and retry policy.',
        confidence: 0.85,
      };
    }
  }

  async suggestOptimization(workflowData: WorkflowOptimizationInput): Promise<OptimizationResult> {
    const prompt = `Analyze this workflow and suggest optimizations:
Workflow: ${workflowData.workflowName}
Nodes: ${JSON.stringify(workflowData.definition.nodes)}
Edges: ${JSON.stringify(workflowData.definition.edges)}
Metrics: ${JSON.stringify(workflowData.metrics)}

Return JSON:
{
  "issues": [{ "type": "string", "description": "string", "severity": "low"|"medium"|"high", "affectedNodeId": "optional" }],
  "recommendations": [{ "title": "string", "description": "string", "impact": "string", "action": "optional" }],
  "estimatedImprovement": "percentage or description"
}`;

    const text = await this.generateText(prompt);
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned) as OptimizationResult;
    } catch {
      return {
        issues: [],
        recommendations: [{ title: 'Workflow optimization', description: 'Optimize step routing and consolidate logs', impact: '10%' }],
        estimatedImprovement: '10%',
      };
    }
  }
}
