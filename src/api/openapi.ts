type JsonObject = Record<string, unknown>;

const BEARER_SECURITY: JsonObject[] = [{ bearerAuth: [] }];

interface OperationInput {
  tag: string;
  summary: string;
  permission?: string;
  membership?: boolean;
  publicAccess?: boolean;
  parameters?: JsonObject[];
  requestBody?: JsonObject;
  responses: Record<string, JsonObject>;
}

function operation(input: OperationInput): JsonObject {
  const description = input.publicAccess
    ? 'Public endpoint. No authentication required.'
    : input.membership
      ? 'Requires an authenticated workspace member.'
      : 'Requires the ' + (input.permission ?? 'authenticated') + ' permission in the target workspace.';
  const op: JsonObject = {
    tags: [input.tag],
    summary: input.summary,
    description,
    security: input.publicAccess ? [] : BEARER_SECURITY,
    responses: input.responses,
  };
  if (input.permission) op['x-permission'] = input.permission;
  if (input.parameters) op.parameters = input.parameters;
  if (input.requestBody) op.requestBody = input.requestBody;
  return op;
}

function idParameter(name: string, description: string): JsonObject {
  return {
    name,
    in: 'path',
    required: true,
    description,
    schema: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
  };
}

function jsonBody(example: JsonObject, required = true): JsonObject {
  return {
    required,
    content: { 'application/json': { schema: { type: 'object' }, example } },
  };
}

function jsonResponse(description: string, example?: unknown): JsonObject {
  return example
    ? { description, content: { 'application/json': { example } } }
    : { description };
}

function errorResponse(description: string, example?: JsonObject): JsonObject {
  const body = example ?? {
    error: {
      code: 'ERROR_CODE',
      message: description,
      requestId: '6ac1f7f4-9d1f-4f4f-9c1b-2f7a2b6f4a11',
    },
  };
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
        example: body,
      },
    },
  };
}

const unauthorized = {
  '401': errorResponse('Missing, expired, or invalid access token', {
    error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: '6ac1f7f4-9d1f-4f4f-9c1b-2f7a2b6f4a11' },
  }),
};

const forbidden = {
  '403': errorResponse('The caller lacks the required workspace permission', {
    error: { code: 'FORBIDDEN', message: 'Insufficient permission for this action', requestId: '6ac1f7f4-9d1f-4f4f-9c1b-2f7a2b6f4a11' },
  }),
};

const invalidRequest = {
  '400': errorResponse('Request body or parameters failed validation', {
    error: { code: 'INVALID_REQUEST', message: 'Invalid request body', requestId: '6ac1f7f4-9d1f-4f4f-9c1b-2f7a2b6f4a11' },
  }),
};

const rateLimited = {
  '429': errorResponse('Rate limit exceeded', {
    error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: '6ac1f7f4-9d1f-4f4f-9c1b-2f7a2b6f4a11' },
  }),
};

function notFound(code: string, message: string) {
  return {
    '404': errorResponse('Resource not found in the caller scope', {
      error: { code, message, requestId: '6ac1f7f4-9d1f-4f4f-9c1b-2f7a2b6f4a11' },
    }),
  };
}

export function buildOpenApiDocument(): JsonObject {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Workflow Execution Engine API',
      version: '1.0.0',
      description: [
        'Multi-tenant workflow automation API.',
        'All tenant routes resolve the caller workspace, enforce JWT access tokens, and apply role-based permissions.',
        'Error responses share one shape and include the correlation id returned in the x-request-id response header.',
      ].join(' '),
    },
    servers: [{ url: '/', description: 'Current host' }],
    tags: [
      { name: 'Health', description: 'Liveness and readiness probes' },
      { name: 'Documentation', description: 'OpenAPI document and Swagger UI' },
      { name: 'Authentication', description: 'Registration, login, refresh, and session management' },
      { name: 'Workspaces', description: 'Workspace and membership management' },
      { name: 'Workflows', description: 'Draft, validate, publish, and version workflows' },
      { name: 'Executions', description: 'Queue, inspect, replay, and dead-letter executions' },
      { name: 'Analytics', description: 'Workflow, execution, and workspace metrics' },
      { name: 'API Keys', description: 'Enterprise API key generation, revocation, rotation, and rate limits' },
      { name: 'External Triggers', description: 'Execute published workflows via API key authentication' },
      { name: 'Webhooks', description: 'Enterprise webhook subscriptions, signature verification, and delivery logs' },
      { name: 'Developer', description: 'Developer platform, API documentation, and SDKs' },
    ],
    security: BEARER_SECURITY,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Send Authorization: Bearer <accessToken>. Obtain tokens from /api/auth/login or /api/auth/register.',
        },
        apiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Send Authorization: Bearer <apiKey> where apiKey starts with wke_. Create API keys via /api/v1/keys.',
        },
      },
      schemas: SCHEMAS,
    },
    paths: PATHS,
  };
}

const SCHEMAS: JsonObject = {
  Error: {
    type: 'object',
    description: 'Shared error envelope. requestId matches the x-request-id response header.',
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', example: 'EXECUTION_NOT_FOUND' },
          message: { type: 'string', example: 'Execution was not found' },
          requestId: { type: 'string', example: '6ac1f7f4-9d1f-4f4f-9c1b-2f7a2b6f4a11' },
        },
      },
    },
  },
  APIKey: {
    type: 'object',
    description: 'API key details (without the raw key, which is only shown on creation)',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      keyPrefix: { type: 'string' },
      status: { type: 'string', enum: ['ACTIVE', 'REVOKED'] },
      permissions: { type: 'array', items: { type: 'string' } },
      lastUsedAt: { type: 'string', format: 'date-time' },
      expiresAt: { type: 'string', format: 'date-time' },
      createdBy: { type: 'string' },
      revokedAt: { type: 'string', format: 'date-time' },
      rateLimit: {
        type: 'object',
        properties: {
          requestsPerMinute: { type: 'integer' },
          executionsPerHour: { type: 'integer' },
        },
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  APIKeyCreated: {
    type: 'object',
    description: 'API key creation response, includes the raw key only once',
    allOf: [
      { $ref: '#/components/schemas/APIKey' },
      {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The raw API key (shown only once)' },
        },
      },
    ],
  },
  UpdateRateLimitInput: {
    type: 'object',
    description: 'Fields to update rate limit configuration',
    properties: {
      requestsPerMinute: { type: 'integer', minimum: 1, maximum: 10000 },
      executionsPerHour: { type: 'integer', minimum: 1, maximum: 100000 },
    },
  },
  Webhook: {
    type: 'object',
    description: 'Webhook configuration details',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      url: { type: 'string', format: 'uri' },
      events: { type: 'array', items: { type: 'string', enum: ['WORKFLOW_EXECUTION_STARTED', 'WORKFLOW_EXECUTION_COMPLETED', 'WORKFLOW_EXECUTION_FAILED', 'WORKFLOW_EXECUTION_REPLAYED'] } },
      status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'DISABLED'] },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  WebhookCreated: {
    type: 'object',
    description: 'Webhook creation response, includes the signing secret only once',
    allOf: [
      { $ref: '#/components/schemas/Webhook' },
      {
        type: 'object',
        properties: {
          secret: { type: 'string', description: 'The webhook signing secret (shown only once)' },
        },
      },
    ],
  },
  WebhookDelivery: {
    type: 'object',
    description: 'Webhook delivery attempt log',
    properties: {
      id: { type: 'string' },
      webhookId: { type: 'string' },
      event: { type: 'string', enum: ['WORKFLOW_EXECUTION_STARTED', 'WORKFLOW_EXECUTION_COMPLETED', 'WORKFLOW_EXECUTION_FAILED', 'WORKFLOW_EXECUTION_REPLAYED'] },
      status: { type: 'string', enum: ['PENDING', 'DELIVERED', 'FAILED'] },
      attempts: { type: 'integer' },
      maxAttempts: { type: 'integer' },
      responseCode: { type: 'integer' },
      durationMs: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      deliveredAt: { type: 'string', format: 'date-time' },
      nextRetryAt: { type: 'string', format: 'date-time' },
    },
  },
  ExternalTriggerInput: {
    type: 'object',
    description: 'Input for triggering a workflow via API key',
    properties: {
      input: { type: 'object' },
      idempotencyKey: { type: 'string' },
    },
  },
  ExternalTriggerResponse: {
    type: 'object',
    description: 'Response from triggering a workflow via API key',
    properties: {
      executionId: { type: 'string' },
      workflowId: { type: 'string' },
      status: { type: 'string', enum: ['QUEUING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] },
      versionNumber: { type: 'integer' },
      attemptsMade: { type: 'integer' },
      maxRetries: { type: 'integer' },
      retryCount: { type: 'integer' },
      replayed: { type: 'boolean' },
      queuedAt: { type: 'string', format: 'date-time' },
      startedAt: { type: 'string', format: 'date-time' },
      finishedAt: { type: 'string', format: 'date-time' },
    },
  },
  DeveloperInfo: {
    type: 'object',
    description: 'Developer platform information endpoint response',
    properties: {
      apiVersion: { type: 'string' },
      supportedEvents: { type: 'array', items: { type: 'string' } },
      permissions: { type: 'array', items: { type: 'string' } },
      rateLimits: {
        type: 'object',
        properties: {
          default: {
            type: 'object',
            properties: {
              requestsPerMinute: { type: 'integer' },
              executionsPerHour: { type: 'integer' },
            },
          },
          configurable: { type: 'boolean' },
          description: { type: 'string' },
        },
      },
      webhookEvents: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            event: { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
      authentication: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          header: { type: 'string' },
          format: { type: 'string' },
          keyPrefix: { type: 'string' },
        },
      },
      sdks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            package: { type: 'string' },
            repository: { type: 'string', format: 'uri' },
            documentation: { type: 'string', format: 'uri' },
          },
        },
      },
      endpoints: {
        type: 'object',
        properties: {
          trigger: { type: 'string' },
          apiKeys: { type: 'string' },
          webhooks: { type: 'string' },
          documentation: { type: 'string' },
        },
      },
    },
  },
  IntegrationExample: {
    type: 'object',
    description: 'A code integration example in a specific language',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      language: { type: 'string', enum: ['javascript', 'python', 'bash'] },
      description: { type: 'string' },
      code: { type: 'string' },
    },
  },
  DeveloperExamples: {
    type: 'object',
    description: 'Developer examples endpoint response',
    properties: {
      examples: { type: 'array', items: { $ref: '#/components/schemas/IntegrationExample' } },
      languages: { type: 'array', items: { type: 'string' } },
      categories: { type: 'array', items: { type: 'string' } },
    },
  },
  AuthResponse: {
    type: 'object',
    properties: {
      accessToken: { type: 'string' },
      refreshToken: { type: 'string' },
      user: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string', format: 'email' } } },
      defaultWorkspaceId: { type: 'string' },
    },
  },
  Workspace: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      slug: { type: 'string' },
      description: { type: 'string' },
      status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] },
      role: { type: 'string', enum: ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'] },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  Workflow: {
    type: 'object',
    properties: {
      _id: { type: 'string' },
      name: { type: 'string' },
      ownerId: { type: 'string' },
      workspaceId: { type: 'string' },
      status: { type: 'string', enum: ['DRAFT', 'PUBLISHED'] },
      latestVersionNumber: { type: 'integer' },
      publishedVersionId: { type: 'string' },
      draftDefinition: { type: 'object' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  WorkflowVersion: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      workflowId: { type: 'string' },
      workspaceId: { type: 'string' },
      versionNumber: { type: 'integer' },
      status: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] },
      definition: { type: 'object' },
      definitionHash: { type: 'string' },
      createdBy: { type: 'string' },
      sourceVersionId: { type: 'string', description: 'Set when the version was produced by a restore' },
      changeSummary: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  WorkflowExecution: {
    type: 'object',
    properties: {
      executionId: { type: 'string' },
      workflowId: { type: 'string' },
      workflowVersionId: { type: 'string' },
      versionNumber: { type: 'integer' },
      jobId: { type: 'string' },
      idempotencyKey: { type: 'string' },
      status: { type: 'string', enum: ['QUEUING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] },
      input: { type: 'object' },
      result: { type: 'object' },
      error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } },
      attemptsMade: { type: 'integer' },
      retryPolicy: { type: 'object', properties: { type: { type: 'string', enum: ['FIXED', 'EXPONENTIAL'] }, delayMs: { type: 'integer' }, backoffFactor: { type: 'number' } } },
      maxRetries: { type: 'integer' },
      retryCount: { type: 'integer' },
      nextRetryAt: { type: 'string', format: 'date-time' },
      timeoutMs: { type: 'integer' },
      parentExecutionId: { type: 'string', description: 'Set when this execution was produced by a replay' },
      statusHistory: { type: 'array', items: { type: 'object', properties: { status: { type: 'string' }, timestamp: { type: 'string', format: 'date-time' }, attempt: { type: 'integer' } } } },
      queuedAt: { type: 'string', format: 'date-time' },
      startedAt: { type: 'string', format: 'date-time' },
      finishedAt: { type: 'string', format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  HealthReport: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['ok', 'degraded', 'unavailable', 'ready'] },
      checks: {
        type: 'object',
        properties: {
          mongo: { $ref: '#/components/schemas/HealthCheck' },
          redis: { $ref: '#/components/schemas/HealthCheck' },
          worker: { $ref: '#/components/schemas/HealthCheck' },
        },
      },
      timestamp: { type: 'string', format: 'date-time' },
    },
  },
  HealthCheck: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['up', 'down', 'skipped'] },
      latencyMs: { type: 'number' },
      detail: { type: 'string' },
    },
  },
  WorkflowAnalytics: {
    type: 'object',
    properties: {
      workflowId: { type: 'string' },
      workspaceId: { type: 'string' },
      totalExecutions: { type: 'integer' },
      successfulExecutions: { type: 'integer' },
      failedExecutions: { type: 'integer' },
      successRate: { type: 'number', description: 'Ratio between 0 and 1' },
      failureRate: { type: 'number', description: 'Ratio between 0 and 1' },
      replayCount: { type: 'integer' },
      averageDurationMs: { type: 'integer' },
      lastExecutedAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  ExecutionMetrics: {
    type: 'object',
    properties: {
      executionId: { type: 'string' },
      workflowId: { type: 'string' },
      status: { type: 'string' },
      durationMs: { type: 'integer' },
      retryCount: { type: 'integer' },
      attemptsMade: { type: 'integer' },
      nodeCount: { type: 'integer' },
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nodeId: { type: 'string' },
            status: { type: 'string' },
            durationMs: { type: 'integer' },
          },
        },
      },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  WorkspaceAnalytics: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string' },
      totalWorkflows: { type: 'integer' },
      totalExecutions: { type: 'integer' },
      monthlyExecutions: { type: 'integer' },
      successRate: { type: 'number' },
      averageExecutionTime: { type: 'integer' },
      storageUsed: { type: 'integer', description: 'Approximate stored bytes for the workspace' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
};

const PATHS: JsonObject = {
  '/health': {
    get: operation({
      tag: 'Health',
      summary: 'Aggregated health report for MongoDB, Redis, and the execution worker',
      publicAccess: true,
      responses: {
        '200': jsonResponse('Critical dependencies are reachable', {
          status: 'ok',
          checks: { mongo: { status: 'up', latencyMs: 3 }, redis: { status: 'up', latencyMs: 1 }, worker: { status: 'up', latencyMs: 1 } },
          timestamp: '2026-09-15T08:00:00.000Z',
        }),
        '503': errorResponse('A critical dependency is unavailable'),
      },
    }),
  },
  '/health/ready': {
    get: operation({
      tag: 'Health',
      summary: 'Readiness probe: MongoDB and Redis must be reachable',
      publicAccess: true,
      responses: {
        '200': jsonResponse('The instance can serve traffic', {
          status: 'ready',
          checks: { mongo: { status: 'up', latencyMs: 2 }, redis: { status: 'up', latencyMs: 1 }, worker: { status: 'skipped', latencyMs: 0 } },
          timestamp: '2026-09-15T08:00:00.000Z',
        }),
        '503': errorResponse('The instance is not ready'),
      },
    }),
  },
  '/health/live': {
    get: operation({
      tag: 'Health',
      summary: 'Liveness probe: the process is running',
      publicAccess: true,
      responses: {
        '200': jsonResponse('Process is alive', { status: 'ok', timestamp: '2026-09-15T08:00:00.000Z' }),
      },
    }),
  },
  '/api/openapi.json': {
    get: operation({
      tag: 'Documentation',
      summary: 'OpenAPI 3.0 document for this API',
      publicAccess: true,
      responses: { '200': jsonResponse('The OpenAPI document') },
    }),
  },
  '/api/docs': {
    get: operation({
      tag: 'Documentation',
      summary: 'Swagger UI for exploring this API',
      publicAccess: true,
      responses: { '200': jsonResponse('Swagger UI HTML page') },
    }),
  },
  '/api/v1/developer/info': {
    get: operation({
      tag: 'Developer',
      summary: 'Get developer platform information including API version, supported events, permissions, and rate limits',
      membership: true,
      responses: {
        '200': jsonResponse('Developer information retrieved', {
          apiVersion: '1.0.0',
          supportedEvents: ['WORKFLOW_EXECUTION_STARTED', 'WORKFLOW_EXECUTION_COMPLETED', 'WORKFLOW_EXECUTION_FAILED', 'WORKFLOW_EXECUTION_REPLAYED'],
          permissions: ['WORKFLOW_CREATE', 'WORKFLOW_READ', 'WORKFLOW_UPDATE', 'WORKFLOW_DELETE', 'WORKFLOW_EXECUTE', 'MEMBER_MANAGE', 'AUDIT_READ'],
          rateLimits: {
            default: {
              requestsPerMinute: 1000,
              executionsPerHour: 5000,
            },
            configurable: true,
          },
          webhookEvents: [
            { event: 'WORKFLOW_EXECUTION_STARTED', description: 'Fired when a workflow execution begins processing' },
            { event: 'WORKFLOW_EXECUTION_COMPLETED', description: 'Fired when a workflow execution completes successfully' },
            { event: 'WORKFLOW_EXECUTION_FAILED', description: 'Fired when a workflow execution fails after all retries' },
            { event: 'WORKFLOW_EXECUTION_REPLAYED', description: 'Fired when a finished execution is replayed' },
          ],
          authentication: {
            type: 'API Key',
            header: 'Authorization',
            format: 'Bearer {apiKey}',
            keyPrefix: 'wke_',
          },
        }),
        '401': unauthorized['401'],
      },
    }),
  },
  '/api/v1/developer/examples': {
    get: operation({
      tag: 'Developer',
      summary: 'Get integration examples for various programming languages',
      membership: true,
      responses: {
        '200': jsonResponse('Integration examples retrieved', {
          examples: [
            {
              id: 'node-trigger-workflow',
              title: 'Trigger Workflow (Node.js)',
              language: 'javascript',
              description: 'Trigger a workflow execution using the JavaScript SDK',
            },
            {
              id: 'python-trigger-workflow',
              title: 'Trigger Workflow (Python)',
              language: 'python',
              description: 'Trigger a workflow execution using the Python SDK',
            },
          ],
          languages: ['javascript', 'python', 'bash'],
          categories: ['trigger', 'webhook', 'error-handling'],
        }),
        '401': unauthorized['401'],
      },
    }),
  },
  '/api/v1/keys': {
    get: operation({
      tag: 'API Keys',
      summary: 'List active API keys in workspace',
      permission: 'MEMBER_MANAGE',
      responses: {
        '200': jsonResponse('List of API keys', [
          {
            id: '652f1f77bcf86cd799439020',
            name: 'Production Worker Key',
            keyPrefix: 'wke_a1b2',
            status: 'ACTIVE',
            permissions: ['WORKFLOW_EXECUTE'],
            rateLimit: { requestsPerMinute: 1000, executionsPerHour: 5000 },
            createdAt: '2026-09-15T08:00:00.000Z',
          },
        ]),
        '401': unauthorized['401'],
        '403': forbidden['403'],
      },
    }),
    post: operation({
      tag: 'API Keys',
      summary: 'Create a new API key for external integrations',
      permission: 'MEMBER_MANAGE',
      requestBody: jsonBody({
        name: 'Production Worker Key',
        permissions: ['WORKFLOW_EXECUTE'],
        expiresAt: '2027-01-01T00:00:00.000Z',
      }),
      responses: {
        '201': jsonResponse('API key created. The raw key is returned only once.', {
          key: {
            id: '652f1f77bcf86cd799439020',
            name: 'Production Worker Key',
            keyPrefix: 'wke_a1b2',
            status: 'ACTIVE',
            permissions: ['WORKFLOW_EXECUTE'],
            rateLimit: { requestsPerMinute: 1000, executionsPerHour: 5000 },
            createdAt: '2026-09-15T08:00:00.000Z',
          },
          rawKey: 'wke_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
        }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
      },
    }),
  },
  '/api/v1/keys/{id}': {
    parameters: [idParameter('id', 'API Key identifier')],
    get: operation({
      tag: 'API Keys',
      summary: 'Get API key metadata',
      permission: 'MEMBER_MANAGE',
      responses: {
        '200': jsonResponse('API key details', {
          id: '652f1f77bcf86cd799439020',
          name: 'Production Worker Key',
          keyPrefix: 'wke_a1b2',
          status: 'ACTIVE',
          permissions: ['WORKFLOW_EXECUTE'],
          rateLimit: { requestsPerMinute: 1000, executionsPerHour: 5000 },
          createdAt: '2026-09-15T08:00:00.000Z',
        }),
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('API_KEY_NOT_FOUND', 'API key was not found')['404'],
      },
    }),
    patch: operation({
      tag: 'API Keys',
      summary: 'Update API key name, permissions, or expiration',
      permission: 'MEMBER_MANAGE',
      requestBody: jsonBody({ name: 'Updated Key Name', permissions: ['WORKFLOW_READ', 'WORKFLOW_EXECUTE'] }),
      responses: {
        '200': jsonResponse('API key updated'),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('API_KEY_NOT_FOUND', 'API key was not found')['404'],
      },
    }),
    delete: operation({
      tag: 'API Keys',
      summary: 'Revoke an API key immediately',
      permission: 'MEMBER_MANAGE',
      responses: {
        '204': { description: 'API key revoked' },
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('API_KEY_NOT_FOUND', 'API key was not found')['404'],
      },
    }),
  },
  '/api/v1/keys/{id}/rotate': {
    parameters: [idParameter('id', 'API Key identifier')],
    post: operation({
      tag: 'API Keys',
      summary: 'Rotate an API key (generates new raw key, preserves metadata)',
      permission: 'MEMBER_MANAGE',
      responses: {
        '201': jsonResponse('Rotated API key pair', {
          key: { id: '652f1f77bcf86cd799439020', name: 'Production Key', keyPrefix: 'wke_x9y8' },
          rawKey: 'wke_x9y8z7a6b5c4d3e2f1g0h9i8j7k6l5m4',
        }),
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('API_KEY_NOT_FOUND', 'API key was not found')['404'],
      },
    }),
  },
  '/api/v1/keys/{id}/limits': {
    parameters: [idParameter('id', 'API Key identifier')],
    patch: operation({
      tag: 'API Keys',
      summary: 'Configure rate limits for an API key',
      permission: 'MEMBER_MANAGE',
      requestBody: jsonBody({ requestsPerMinute: 2000, executionsPerHour: 10000 }),
      responses: {
        '200': jsonResponse('API key rate limits updated'),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('API_KEY_NOT_FOUND', 'API key was not found')['404'],
      },
    }),
  },
  '/api/v1/workflows/{id}/trigger': {
    parameters: [idParameter('id', 'Workflow identifier')],
    post: {
      tags: ['External Triggers'],
      summary: 'Trigger published workflow execution using API key authentication',
      description: 'Authenticate with Bearer wke_... API key. Rate limited per key.',
      security: [{ apiKeyAuth: [] }],
      requestBody: jsonBody({
        input: { orderId: 'ORD-12345', amount: 150.0 },
        idempotencyKey: 'order-ORD-12345-approval',
      }),
      responses: {
        '202': jsonResponse('Execution queued successfully', {
          executionId: '652f1f77bcf86cd799439021',
          workflowId: '652f1f77bcf86cd799439013',
          status: 'QUEUED',
          versionNumber: 2,
          attemptsMade: 0,
          maxRetries: 2,
          retryCount: 0,
          replayed: false,
        }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('WORKFLOW_NOT_FOUND', 'Workflow was not found')['404'],
        '429': rateLimited['429'],
      },
    },
  },
  '/api/v1/webhooks': {
    get: operation({
      tag: 'Webhooks',
      summary: 'List webhooks in workspace',
      permission: 'MEMBER_MANAGE',
      responses: {
        '200': jsonResponse('List of webhooks', [
          {
            id: '652f1f77bcf86cd799439022',
            name: 'Slack Notification Webhook',
            url: 'https://hooks.slack.com/services/...',
            events: ['WORKFLOW_EXECUTION_COMPLETED', 'WORKFLOW_EXECUTION_FAILED'],
            status: 'ACTIVE',
            createdAt: '2026-09-15T08:00:00.000Z',
          },
        ]),
        '401': unauthorized['401'],
        '403': forbidden['403'],
      },
    }),
    post: operation({
      tag: 'Webhooks',
      summary: 'Create a webhook subscription with HMAC signing secret',
      permission: 'MEMBER_MANAGE',
      requestBody: jsonBody({
        name: 'Slack Notification Webhook',
        url: 'https://hooks.slack.com/services/...',
        events: ['WORKFLOW_EXECUTION_COMPLETED', 'WORKFLOW_EXECUTION_FAILED'],
      }),
      responses: {
        '201': jsonResponse('Webhook created with signing secret (secret returned only once)', {
          id: '652f1f77bcf86cd799439022',
          name: 'Slack Notification Webhook',
          url: 'https://hooks.slack.com/services/...',
          events: ['WORKFLOW_EXECUTION_COMPLETED', 'WORKFLOW_EXECUTION_FAILED'],
          status: 'ACTIVE',
          secret: 'whsec_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
          createdAt: '2026-09-15T08:00:00.000Z',
        }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
      },
    }),
  },
  '/api/v1/webhooks/{id}': {
    parameters: [idParameter('id', 'Webhook identifier')],
    get: operation({
      tag: 'Webhooks',
      summary: 'Get webhook configuration',
      permission: 'MEMBER_MANAGE',
      responses: {
        '200': jsonResponse('Webhook details', {
          id: '652f1f77bcf86cd799439022',
          name: 'Slack Notification Webhook',
          url: 'https://hooks.slack.com/services/...',
          events: ['WORKFLOW_EXECUTION_COMPLETED', 'WORKFLOW_EXECUTION_FAILED'],
          status: 'ACTIVE',
        }),
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('WEBHOOK_NOT_FOUND', 'Webhook was not found')['404'],
      },
    }),
    patch: operation({
      tag: 'Webhooks',
      summary: 'Update webhook URL, events, or status',
      permission: 'MEMBER_MANAGE',
      requestBody: jsonBody({ status: 'PAUSED' }),
      responses: {
        '200': jsonResponse('Webhook updated'),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('WEBHOOK_NOT_FOUND', 'Webhook was not found')['404'],
      },
    }),
    delete: operation({
      tag: 'Webhooks',
      summary: 'Delete webhook subscription',
      permission: 'MEMBER_MANAGE',
      responses: {
        '204': { description: 'Webhook deleted' },
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('WEBHOOK_NOT_FOUND', 'Webhook was not found')['404'],
      },
    }),
  },
  '/api/v1/webhooks/{id}/deliveries': {
    parameters: [idParameter('id', 'Webhook identifier')],
    get: operation({
      tag: 'Webhooks',
      summary: 'List delivery attempts and status for a webhook',
      permission: 'MEMBER_MANAGE',
      responses: {
        '200': jsonResponse('Delivery history', [
          {
            id: '652f1f77bcf86cd799439023',
            webhookId: '652f1f77bcf86cd799439022',
            event: 'WORKFLOW_EXECUTION_COMPLETED',
            status: 'DELIVERED',
            attempts: 1,
            maxAttempts: 3,
            responseCode: 200,
            durationMs: 45,
            deliveredAt: '2026-09-15T08:00:01.000Z',
          },
        ]),
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('WEBHOOK_NOT_FOUND', 'Webhook was not found')['404'],
      },
    }),
  },
  '/api/v1/webhooks/{id}/deliveries/{deliveryId}/retry': {
    parameters: [
      idParameter('id', 'Webhook identifier'),
      idParameter('deliveryId', 'Delivery identifier'),
    ],
    post: operation({
      tag: 'Webhooks',
      summary: 'Retry a failed webhook delivery attempt',
      permission: 'MEMBER_MANAGE',
      responses: {
        '202': jsonResponse('Delivery retry scheduled'),
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('WEBHOOK_DELIVERY_NOT_FOUND', 'Webhook delivery was not found')['404'],
        '409': errorResponse('Only failed deliveries can be retried'),
      },
    }),
  },
  '/api/auth/register': {
    post: operation({
      tag: 'Authentication',
      summary: 'Register an account with a personal workspace',
      publicAccess: true,
      requestBody: jsonBody({ email: 'owner@example.com', password: 'correct-horse-battery-staple' }),
      responses: {
        '201': jsonResponse('Account and personal workspace created', {
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          refreshToken: 'Yk9kZ0hYQ2Z...',
          user: { id: '652f1f77bcf86cd799439011', email: 'owner@example.com' },
          defaultWorkspaceId: '652f1f77bcf86cd799439012',
        }),
        '400': invalidRequest['400'],
        '409': errorResponse('Email is already registered'),
        '429': rateLimited['429'],
      },
    }),
  },
  '/api/auth/login': {
    post: operation({
      tag: 'Authentication',
      summary: 'Exchange credentials for access and refresh tokens',
      publicAccess: true,
      requestBody: jsonBody({ email: 'owner@example.com', password: 'correct-horse-battery-staple' }),
      responses: {
        '200': jsonResponse('Authenticated', {
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          refreshToken: 'Yk9kZ0hYQ2Z...',
          user: { id: '652f1f77bcf86cd799439011', email: 'owner@example.com' },
          defaultWorkspaceId: '652f1f77bcf86cd799439012',
        }),
        '401': errorResponse('Email or password is incorrect'),
        '429': rateLimited['429'],
      },
    }),
  },
  '/api/auth/refresh': {
    post: operation({
      tag: 'Authentication',
      summary: 'Rotate a refresh token',
      publicAccess: true,
      requestBody: jsonBody({ refreshToken: 'Yk9kZ0hYQ2Z...' }),
      responses: {
        '200': jsonResponse('Rotated token pair'),
        '401': errorResponse('Refresh token is invalid, expired, or replayed'),
        '429': rateLimited['429'],
      },
    }),
  },
  '/api/auth/logout': {
    post: operation({
      tag: 'Authentication',
      summary: 'Revoke the refresh token family for the current session',
      publicAccess: true,
      responses: { '204': { description: 'Session family revoked' } },
    }),
  },  '/api/auth/sessions': {
    get: operation({
      tag: 'Authentication',
      summary: 'List active sessions for the caller',
      responses: { '200': jsonResponse('Active sessions'), '401': unauthorized['401'] },
    }),
    delete: operation({
      tag: 'Authentication',
      summary: 'Revoke every session family for the caller',
      responses: { '204': { description: 'All sessions revoked' }, '401': unauthorized['401'] },
    }),
  },
  '/api/auth/sessions/{id}': {
    delete: operation({
      tag: 'Authentication',
      summary: 'Revoke one session family',
      parameters: [idParameter('id', 'Session family identifier')],
      responses: {
        '204': { description: 'Session revoked' },
        '401': unauthorized['401'],
        '404': notFound('SESSION_NOT_FOUND', 'Session was not found')['404'],
      },
    }),
  },
  '/api/workspaces': {
    get: operation({
      tag: 'Workspaces',
      summary: 'List workspaces the caller belongs to',
      membership: true,
      responses: { '200': jsonResponse('Workspaces with the caller role'), '401': unauthorized['401'] },
    }),
    post: operation({
      tag: 'Workspaces',
      summary: 'Create a workspace; the caller becomes OWNER',
      requestBody: jsonBody({ name: 'Operations', slug: 'operations', description: 'Ops automations' }),
      responses: {
        '201': jsonResponse('Workspace created'),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
      },
    }),
  },
  '/api/workspaces/{id}': {
    parameters: [idParameter('id', 'Workspace identifier')],
    get: operation({
      tag: 'Workspaces',
      summary: 'Get a workspace the caller belongs to',
      membership: true,
      responses: { '200': jsonResponse('Workspace'), '401': unauthorized['401'], '404': notFound('WORKSPACE_NOT_FOUND', 'Workspace was not found')['404'] },
    }),
    patch: operation({
      tag: 'Workspaces',
      summary: 'Update workspace name or description (OWNER only)',
      membership: true,
      requestBody: jsonBody({ name: 'Renamed workspace' }, false),
      responses: {
        '200': jsonResponse('Workspace updated'),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('WORKSPACE_NOT_FOUND', 'Workspace was not found')['404'],
      },
    }),
  },  '/api/workspaces/{id}/members': {
    parameters: [idParameter('id', 'Workspace identifier')],
    get: operation({
      tag: 'Workspaces',
      summary: 'List workspace members',
      permission: 'MEMBER_MANAGE',
      responses: { '200': jsonResponse('Memberships with roles and status'), '401': unauthorized['401'], '403': forbidden['403'] },
    }),
  },
  '/api/workspaces/{id}/members/invite': {
    parameters: [idParameter('id', 'Workspace identifier')],
    post: operation({
      tag: 'Workspaces',
      summary: 'Invite a user to the workspace',
      permission: 'MEMBER_MANAGE',
      requestBody: jsonBody({ email: 'editor@example.com', role: 'EDITOR' }),
      responses: {
        '201': jsonResponse('Invitation created'),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '409': errorResponse('The user is already a member'),
      },
    }),
  },
  '/api/workspaces/{id}/members/accept': {
    parameters: [idParameter('id', 'Workspace identifier')],
    post: operation({
      tag: 'Workspaces',
      summary: 'Accept a pending invitation for the caller',
      membership: true,
      responses: { '200': jsonResponse('Membership activated'), '401': unauthorized['401'], '404': notFound('INVITATION_NOT_FOUND', 'No pending invitation was found')['404'] },
    }),
  },
  '/api/workspaces/{id}/members/{memberId}': {
    parameters: [idParameter('id', 'Workspace identifier'), idParameter('memberId', 'Membership identifier')],
    patch: operation({
      tag: 'Workspaces',
      summary: 'Change a member role',
      permission: 'MEMBER_MANAGE',
      requestBody: jsonBody({ role: 'ADMIN' }),
      responses: {
        '200': jsonResponse('Membership updated'),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '409': errorResponse('The workspace owner role cannot be reassigned'),
      },
    }),
    delete: operation({
      tag: 'Workspaces',
      summary: 'Remove a member from the workspace',
      permission: 'MEMBER_MANAGE',
      responses: {
        '200': jsonResponse('Membership removed'),
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('MEMBER_NOT_FOUND', 'Workspace member was not found')['404'],
      },
    }),
  },  '/api/workflows': {
    post: operation({
      tag: 'Workflows',
      summary: 'Create a workflow draft',
      permission: 'WORKFLOW_CREATE',
      requestBody: jsonBody({
        name: 'Booking approval',
        workspaceId: '652f1f77bcf86cd799439012',
        definition: {
          nodes: [
            { id: 'trigger', type: 'webhook', config: {} },
            { id: 'log', type: 'log', config: { message: 'approved' } },
          ],
          edges: [{ source: 'trigger', target: 'log' }],
        },
      }),
      responses: {
        '201': jsonResponse('Workflow draft created', {
          _id: '652f1f77bcf86cd799439013',
          name: 'Booking approval',
          status: 'DRAFT',
          latestVersionNumber: 0,
          workspaceId: '652f1f77bcf86cd799439012',
        }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
      },
    }),
  },
  '/api/workflows/{id}': {
    parameters: [idParameter('id', 'Workflow identifier')],
    get: operation({
      tag: 'Workflows',
      summary: 'Get a workflow and its current draft',
      permission: 'WORKFLOW_READ',
      responses: {
        '200': jsonResponse('Workflow document', { _id: '652f1f77bcf86cd799439013', name: 'Booking approval', status: 'PUBLISHED', latestVersionNumber: 2 }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '404': notFound('WORKFLOW_NOT_FOUND', 'Workflow was not found')['404'],
      },
    }),
  },  '/api/workflows/{id}/draft': {
    parameters: [idParameter('id', 'Workflow identifier')],
    put: operation({
      tag: 'Workflows',
      summary: 'Update the workflow draft',
      permission: 'WORKFLOW_UPDATE',
      requestBody: jsonBody({ name: 'Renamed workflow' }, false),
      responses: {
        '200': jsonResponse('Updated workflow'),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('WORKFLOW_NOT_FOUND', 'Workflow was not found')['404'],
      },
    }),
  },
  '/api/workflows/{id}/validate': {
    parameters: [idParameter('id', 'Workflow identifier')],
    post: operation({
      tag: 'Workflows',
      summary: 'Validate the draft schema and graph',
      permission: 'WORKFLOW_UPDATE',
      responses: {
        '200': jsonResponse('Validation report', { valid: true, schemaErrors: [], graphErrors: [] }),
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('WORKFLOW_NOT_FOUND', 'Workflow was not found')['404'],
      },
    }),
  },
  '/api/workflows/{id}/publish': {
    parameters: [idParameter('id', 'Workflow identifier')],
    post: operation({
      tag: 'Workflows',
      summary: 'Publish an immutable workflow version',
      permission: 'WORKFLOW_UPDATE',
      requestBody: jsonBody({ changeSummary: 'Adds approval logging' }, false),
      responses: {
        '201': jsonResponse('Published version', { versionNumber: 2, definition: { nodes: [], edges: [] } }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '409': errorResponse('Workflow has no valid draft to publish'),
        '422': errorResponse('Draft schema or graph is invalid'),
      },
    }),
  },
  '/api/workflows/{id}/transfer': {
    parameters: [idParameter('id', 'Workflow identifier')],
    post: operation({
      tag: 'Workflows',
      summary: 'Transfer workflow ownership to another member',
      membership: true,
      requestBody: jsonBody({ memberId: '652f1f77bcf86cd799439014' }),
      responses: {
        '200': jsonResponse('Ownership transferred'),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
      },
    }),
  },  '/api/workflows/{id}/versions': {
    parameters: [idParameter('id', 'Workflow identifier')],
    get: operation({
      tag: 'Workflows',
      summary: 'List immutable versions oldest first',
      permission: 'WORKFLOW_READ',
      responses: {
        '200': jsonResponse('Version history', [
          { id: '652f1f77bcf86cd799439015', versionNumber: 1, status: 'PUBLISHED', definitionHash: '9f2c...', changeSummary: 'initial version' },
        ]),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '404': notFound('WORKFLOW_NOT_FOUND', 'Workflow was not found')['404'],
      },
    }),
  },
  '/api/workflows/{id}/versions/{versionId}': {
    parameters: [idParameter('id', 'Workflow identifier'), idParameter('versionId', 'Version identifier or version number')],
    get: operation({
      tag: 'Workflows',
      summary: 'Fetch one immutable version snapshot',
      permission: 'WORKFLOW_READ',
      responses: {
        '200': jsonResponse('Version snapshot', { id: '652f1f77bcf86cd799439015', versionNumber: 1, definition: { nodes: [], edges: [] } }),
        '401': unauthorized['401'],
        '404': notFound('VERSION_NOT_FOUND', 'Workflow version was not found')['404'],
      },
    }),
  },
  '/api/workflows/{id}/versions/{versionId}/restore': {
    parameters: [idParameter('id', 'Workflow identifier'), idParameter('versionId', 'Version identifier or version number')],
    post: operation({
      tag: 'Workflows',
      summary: 'Restore an old version as a new published version',
      permission: 'WORKFLOW_UPDATE',
      requestBody: jsonBody({ changeSummary: 'Roll back to version 1' }, false),
      responses: {
        '201': jsonResponse('Restored version', { id: '652f1f77bcf86cd799439016', versionNumber: 3, sourceVersionId: '652f1f77bcf86cd799439015' }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('VERSION_NOT_FOUND', 'Workflow version was not found')['404'],
      },
    }),
  },  '/api/workflows/{id}/compare': {
    parameters: [idParameter('id', 'Workflow identifier')],
    post: operation({
      tag: 'Workflows',
      summary: 'Compare two versions structurally',
      permission: 'WORKFLOW_READ',
      requestBody: jsonBody({ from: 1, to: 2 }),
      responses: {
        '200': jsonResponse('Structural diff', {
          from: { versionId: '652f1f77bcf86cd799439015', versionNumber: 1 },
          to: { versionId: '652f1f77bcf86cd799439016', versionNumber: 2 },
          identical: false,
          nodes: { added: ['extra'], removed: [], changed: [{ id: 'log', fields: [{ field: 'config.message', from: 'v1', to: 'v2' }] }] },
          edges: { added: ['log->extra'], removed: [] },
        }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '404': notFound('VERSION_NOT_FOUND', 'Workflow version was not found')['404'],
      },
    }),
  },  '/api/workflows/{workflowId}/executions': {
    parameters: [idParameter('workflowId', 'Workflow identifier')],
    post: operation({
      tag: 'Executions',
      summary: 'Queue the latest published workflow version',
      permission: 'WORKFLOW_EXECUTE',
      requestBody: jsonBody({
        input: { estimatedCost: 15000 },
        idempotencyKey: 'booking-123',
        retryPolicy: { type: 'EXPONENTIAL', delayMs: 1000, backoffFactor: 2, maxRetries: 2 },
        timeoutMs: 30000,
      }),
      responses: {
        '202': jsonResponse('Execution queued; repeated idempotent requests return the same execution with replayed: true', {
          executionId: '652f1f77bcf86cd799439017',
          workflowId: '652f1f77bcf86cd799439013',
          status: 'QUEUED',
          versionNumber: 2,
          attemptsMade: 0,
          maxRetries: 2,
          retryCount: 0,
          replayed: false,
        }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('WORKFLOW_NOT_FOUND', 'Workflow was not found')['404'],
        '409': errorResponse('Workflow has no published version or the idempotency key conflicts'),
        '503': errorResponse('Execution queue is unavailable'),
      },
    }),
    get: operation({
      tag: 'Executions',
      summary: 'List workflow executions newest first',
      permission: 'WORKFLOW_READ',
      responses: {
        '200': jsonResponse('Executions for the workflow'),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '404': notFound('WORKFLOW_NOT_FOUND', 'Workflow was not found')['404'],
      },
    }),
  },  '/api/executions/{executionId}': {
    parameters: [idParameter('executionId', 'Execution identifier')],
    get: operation({
      tag: 'Executions',
      summary: 'Get execution status, result, error, and history',
      permission: 'WORKFLOW_READ',
      responses: {
        '200': jsonResponse('Execution document', {
          executionId: '652f1f77bcf86cd799439017',
          status: 'SUCCEEDED',
          attemptsMade: 1,
          result: { status: 'SUCCEEDED', outputs: { log: { message: 'approved' } } },
        }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '404': notFound('EXECUTION_NOT_FOUND', 'Execution was not found')['404'],
      },
    }),
  },
  '/api/executions/{executionId}/replay': {
    parameters: [idParameter('executionId', 'Execution identifier')],
    post: operation({
      tag: 'Executions',
      summary: 'Replay a finished execution as a new linked execution',
      permission: 'WORKFLOW_EXECUTE',
      responses: {
        '202': jsonResponse('New execution created from the original snapshot', {
          executionId: '652f1f77bcf86cd799439018',
          parentExecutionId: '652f1f77bcf86cd799439017',
          status: 'QUEUED',
        }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('EXECUTION_NOT_FOUND', 'Execution was not found')['404'],
        '409': errorResponse('Execution has not reached a terminal status'),
      },
    }),
  },
  '/api/workflows/{workflowId}/dead-letters': {
    parameters: [idParameter('workflowId', 'Workflow identifier')],
    get: operation({
      tag: 'Executions',
      summary: 'List dead-lettered executions for a workflow',
      permission: 'WORKFLOW_READ',
      responses: {
        '200': jsonResponse('Dead-letter entries newest first', [
          { executionId: '652f1f77bcf86cd799439019', failureReason: 'EXECUTION_TIMEOUT', attempts: 3, failedAt: '2026-09-15T08:00:00.000Z' },
        ]),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '404': notFound('WORKFLOW_NOT_FOUND', 'Workflow was not found')['404'],
      },
    }),
  },  '/api/analytics/workflows/{id}': {
    parameters: [idParameter('id', 'Workflow identifier')],
    get: operation({
      tag: 'Analytics',
      summary: 'Per-workflow execution metrics',
      permission: 'WORKFLOW_READ',
      responses: {
        '200': jsonResponse('Workflow analytics rollup', {
          workflowId: '652f1f77bcf86cd799439013',
          totalExecutions: 12,
          successfulExecutions: 10,
          failedExecutions: 2,
          successRate: 0.8333,
          failureRate: 0.1667,
          replayCount: 1,
          averageDurationMs: 842,
          lastExecutedAt: '2026-09-15T08:00:00.000Z',
        }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '404': notFound('WORKFLOW_NOT_FOUND', 'Workflow was not found')['404'],
      },
    }),
  },  '/api/analytics/executions/{executionId}': {
    parameters: [idParameter('executionId', 'Execution identifier')],
    get: operation({
      tag: 'Analytics',
      summary: 'Single-execution duration, retries, and per-node timings',
      permission: 'WORKFLOW_READ',
      responses: {
        '200': jsonResponse('Execution metrics', {
          executionId: '652f1f77bcf86cd799439017',
          workflowId: '652f1f77bcf86cd799439013',
          status: 'SUCCEEDED',
          durationMs: 812,
          retryCount: 1,
          attemptsMade: 2,
          nodeCount: 2,
          nodes: [{ nodeId: 'log', status: 'SUCCEEDED', durationMs: 400 }, { nodeId: 'trigger', status: 'SUCCEEDED', durationMs: 412 }],
        }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '404': notFound('EXECUTION_NOT_FOUND', 'Execution was not found')['404'],
      },
    }),
  },
  '/api/analytics/workspaces/{id}': {
    parameters: [idParameter('id', 'Workspace identifier')],
    get: operation({
      tag: 'Analytics',
      summary: 'Workspace usage: workflows, executions, monthly totals, and storage',
      permission: 'AUDIT_READ',
      responses: {
        '200': jsonResponse('Workspace usage rollup', {
          workspaceId: '652f1f77bcf86cd799439012',
          totalWorkflows: 4,
          totalExecutions: 128,
          monthlyExecutions: 32,
          successRate: 0.9609,
          averageExecutionTime: 903,
          storageUsed: 482304,
          updatedAt: '2026-09-15T08:00:00.000Z',
        }),
        '400': invalidRequest['400'],
        '401': unauthorized['401'],
        '403': forbidden['403'],
        '404': notFound('WORKSPACE_NOT_FOUND', 'Workspace was not found')['404'],
      },
    }),
  },};
