# Workflow Engine JavaScript/TypeScript SDK

Official JavaScript/TypeScript client for the Workflow Execution Engine API.

## Installation

```bash
npm install @workflow-engine/sdk
```

## Quick Start

```typescript
import { WorkflowClient } from '@workflow-engine/sdk';

const client = new WorkflowClient({
  apiKey: process.env.WORKFLOW_API_KEY,
  baseURL: 'https://api.example.com'
});

// Trigger a workflow
const execution = await client.workflows.trigger('workflow-id', {
  input: { orderId: '12345' },
  idempotencyKey: 'order-12345-approval'
});

console.log('Execution started:', execution.executionId);
```

## Features

- ✅ **Type-safe API client** - Full TypeScript support
- ✅ **Automatic error handling** - Typed error classes for all API errors
- ✅ **Webhook signature verification** - Secure HMAC-SHA256 verification
- ✅ **Idempotency support** - Prevent duplicate workflow executions
- ✅ **Retry policies** - Configurable exponential backoff
- ✅ **Rate limit handling** - Automatic retry-after headers

## API Reference

### WorkflowClient

#### Constructor

```typescript
new WorkflowClient(config: ClientConfig)
```

**Options:**
- `apiKey` (required): Your API key with `wke_` prefix
- `baseURL` (optional): API base URL, defaults to production endpoint
- `timeout` (optional): Request timeout in milliseconds, defaults to 30000
- `headers` (optional): Additional headers to include in requests

#### Methods

##### `workflows.trigger(workflowId, options)`

Trigger a workflow execution.

```typescript
const execution = await client.workflows.trigger('workflow-id', {
  input: { data: 'example' },
  idempotencyKey: 'unique-key',
  timeoutMs: 60000,
  retryPolicy: {
    type: 'EXPONENTIAL',
    delayMs: 1000,
    backoffFactor: 2,
    maxRetries: 3
  }
});
```

**Parameters:**
- `workflowId` (string): The workflow ID to trigger
- `options.input` (object): Input data for the workflow
- `options.idempotencyKey` (string): Optional key for deduplication
- `options.timeoutMs` (number): Execution timeout in milliseconds
- `options.retryPolicy` (object): Retry configuration

**Returns:** `Promise<WorkflowExecutionResponse>`

### Webhook Verification

```typescript
import { verifyWebhookSignature } from '@workflow-engine/sdk';
import express from 'express';

app.post('/webhooks', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = req.body.toString();
  
  const isValid = verifyWebhookSignature(
    payload,
    signature,
    process.env.WEBHOOK_SECRET
  );
  
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Process webhook event
  const event = JSON.parse(payload);
  console.log('Received event:', event.event);
  
  res.json({ received: true });
});
```

### Error Handling

```typescript
import { 
  WorkflowError,
  AuthenticationError,
  RateLimitError,
  NotFoundError,
  ValidationError
} from '@workflow-engine/sdk';

try {
  const execution = await client.workflows.trigger('workflow-id', {
    input: { data: 'example' }
  });
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error('Invalid API key');
  } else if (error instanceof RateLimitError) {
    console.error('Rate limit exceeded, retry after:', error.retryAfter);
  } else if (error instanceof NotFoundError) {
    console.error('Workflow not found');
  } else if (error instanceof ValidationError) {
    console.error('Invalid input:', error.details);
  } else if (error instanceof WorkflowError) {
    console.error('API error:', error.code, error.message);
  }
}
```

## TypeScript Support

The SDK is written in TypeScript and provides full type definitions:

```typescript
import type {
  ClientConfig,
  TriggerOptions,
  WorkflowExecutionResponse,
  WebhookEventPayload
} from '@workflow-engine/sdk';
```

## License

MIT
