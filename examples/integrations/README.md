# Workflow Engine Integration Examples

This directory contains practical integration examples for the Workflow Execution Engine.

## Examples

### JavaScript/TypeScript
- **basic-trigger.js** - Trigger a workflow with minimal configuration
- **with-retry.js** - Configure retry policies for failed executions
- **webhook-handler.js** - Handle incoming webhook notifications
- **error-handling.js** - Comprehensive error handling patterns

### Python
- **basic-trigger.py** - Trigger a workflow with minimal configuration
- **with-retry.py** - Configure retry policies for failed executions
- **webhook-handler.py** - Handle incoming webhook notifications
- **error-handling.py** - Comprehensive error handling patterns

## Getting Started

### JavaScript/Node.js

```bash
npm install @workflow-engine/sdk
```

```javascript
import { WorkflowClient } from '@workflow-engine/sdk';

const client = new WorkflowClient({
  apiKey: process.env.WORKFLOW_API_KEY,
  baseURL: 'https://api.example.com'
});

const execution = await client.workflows.trigger('workflow-id', {
  input: { orderId: '12345' }
});

console.log('Execution started:', execution.executionId);
```

### Python

```bash
pip install workflow-engine
```

```python
from workflow_engine import WorkflowClient

client = WorkflowClient(
    api_key=os.environ['WORKFLOW_API_KEY'],
    base_url='https://api.example.com'
)

execution = client.trigger_workflow(
    workflow_id='workflow-id',
    input={'orderId': '12345'}
)

print(f"Execution started: {execution['executionId']}")
```

## Webhook Verification

### JavaScript
```javascript
import { verifyWebhookSignature } from '@workflow-engine/sdk';

const signature = req.headers['x-webhook-signature'];
const isValid = verifyWebhookSignature(
  JSON.stringify(req.body),
  signature,
  process.env.WEBHOOK_SECRET
);
```

### Python
```python
from workflow_engine import verify_webhook_signature

signature = request.headers.get('X-Webhook-Signature')
is_valid = verify_webhook_signature(
    request.get_data(as_text=True),
    signature,
    os.environ['WEBHOOK_SECRET']
)
```

## Authentication

All API requests require an API key with the `wke_` prefix. Include it in the `Authorization` header:

```
Authorization: Bearer wke_your_api_key_here
```

## Rate Limits

Default rate limits:
- 1000 requests per minute
- 5000 executions per hour

Rate limits are configurable per API key.

## Support

- Documentation: https://docs.workflow-engine.example.com
- API Reference: https://api.workflow-engine.example.com/api/docs
- GitHub: https://github.com/workflow-engine
