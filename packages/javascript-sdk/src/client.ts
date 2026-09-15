import type { ClientConfig, TriggerOptions, WorkflowExecutionResponse } from './types.js';
import {
  WorkflowError,
  AuthenticationError,
  RateLimitError,
  NotFoundError,
  ValidationError,
} from './errors.js';

export class WorkflowClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly timeout: number;
  private readonly headers: Record<string, string>;

  constructor(config: ClientConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    if (!config.apiKey.startsWith('wke_')) {
      throw new Error('Invalid API key format. API keys must start with "wke_"');
    }

    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://api.workflow-engine.example.com';
    this.timeout = config.timeout || 30000;
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': '@workflow-engine/sdk/1.0.0',
      ...config.headers,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseURL}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...this.headers,
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: body !== null && body !== undefined ? JSON.stringify(body) : null,
        signal: controller.signal,
      } as RequestInit);

      clearTimeout(timeoutId);

      const responseText = await response.text();
      let data: unknown;
      try {
        data = responseText ? JSON.parse(responseText) : undefined;
      } catch {
        data = responseText;
      }

      if (!response.ok) {
        this.handleErrorResponse(response.status, data, response.headers);
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        throw new WorkflowError('Request timeout', 'TIMEOUT', 408);
      }
      throw error;
    }
  }

  private handleErrorResponse(
    status: number,
    data: unknown,
    headers: Headers,
  ): never {
    const errorData = data as { error?: { code?: string; message?: string; requestId?: string } };
    const message = errorData?.error?.message || 'Unknown error';
    const code = errorData?.error?.code || 'UNKNOWN_ERROR';
    const requestId = errorData?.error?.requestId;

    if (status === 401) {
      throw new AuthenticationError(message, requestId);
    }
    if (status === 429) {
      const retryAfter = headers.get('Retry-After');
      throw new RateLimitError(message, retryAfter ? parseInt(retryAfter, 10) : undefined, requestId);
    }
    if (status === 404) {
      throw new NotFoundError(message, code, requestId);
    }
    if (status === 400 || status === 422) {
      throw new ValidationError(message, errorData, requestId);
    }

    throw new WorkflowError(message, code, status, requestId);
  }

  /**
   * Workflow operations
   */
  public readonly workflows = {
    /**
     * Trigger a workflow execution
     */
    trigger: async (
      workflowId: string,
      options: TriggerOptions = {},
    ): Promise<WorkflowExecutionResponse> => {
      const body: Record<string, unknown> = {};
      if (options.input) body.input = options.input;
      if (options.idempotencyKey) body.idempotencyKey = options.idempotencyKey;
      if (options.timeoutMs) body.timeoutMs = options.timeoutMs;
      if (options.retryPolicy) body.retryPolicy = options.retryPolicy;

      return this.request<WorkflowExecutionResponse>(
        'POST',
        `/api/v1/workflows/${workflowId}/trigger`,
        body,
      );
    },
  };
}
