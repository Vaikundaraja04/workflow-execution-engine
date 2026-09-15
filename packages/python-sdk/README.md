# Workflow Engine Python SDK

Official Python client for the Workflow Execution Engine API.

## Installation

```bash
pip install workflow-engine
```

## Quick Start

```python
import os
from workflow_engine import WorkflowClient

client = WorkflowClient(
    api_key=os.environ['WORKFLOW_API_KEY'],
    base_url='https://api.example.com'
)

# Trigger a workflow
execution = client.trigger_workflow(
    workflow_id='workflow-id',
    input={'orderId': '12345'},
    idempotency_key='order-12345-approval'
)

print(f"Execution started: {execution['executionId']}")
```

## Features

- ✅ **Simple API client** - Clean, Pythonic interface
- ✅ **Automatic error handling** - Typed exception classes
- ✅ **Webhook signature verification** - Secure HMAC-SHA256 verification
- ✅ **Context manager support** - Automatic session cleanup
- ✅ **Type hints** - Full typing support for modern Python
- ✅ **Retry policies** - Configurable exponential backoff

## API Reference

### WorkflowClient

#### Constructor

```python
WorkflowClient(
    api_key: str,
    base_url: str = "https://api.workflow-engine.example.com",
    timeout: int = 30,
    headers: Optional[Dict[str, str]] = None
)
```

**Parameters:**
- `api_key` (required): Your API key with `wke_` prefix
- `base_url` (optional): API base URL
- `timeout` (optional): Request timeout in seconds, defaults to 30
- `headers` (optional): Additional headers to include

#### Methods

##### `trigger_workflow(workflow_id, **kwargs)`

Trigger a workflow execution.

```python
execution = client.trigger_workflow(
    workflow_id='workflow-id',
    input={'data': 'example'},
    idempotency_key='unique-key',
    timeout_ms=60000,
    retry_policy={
        'type': 'EXPONENTIAL',
        'delayMs': 1000,
        'backoffFactor': 2,
        'maxRetries': 3
    }
)
```

**Parameters:**
- `workflow_id` (str): The workflow ID to trigger
- `input` (dict): Input data for the workflow
- `idempotency_key` (str): Optional key for deduplication
- `timeout_ms` (int): Execution timeout in milliseconds
- `retry_policy` (dict): Retry configuration

**Returns:** `dict` - Execution response

### Webhook Verification

```python
from workflow_engine import verify_webhook_signature
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/webhooks', methods=['POST'])
def handle_webhook():
    signature = request.headers.get('X-Webhook-Signature')
    payload = request.get_data(as_text=True)
    
    is_valid = verify_webhook_signature(
        payload,
        signature,
        os.environ['WEBHOOK_SECRET']
    )
    
    if not is_valid:
        return jsonify({'error': 'Invalid signature'}), 401
    
    # Process webhook event
    event = request.json
    print(f"Received event: {event['event']}")
    
    return jsonify({'received': True})
```

### Error Handling

```python
from workflow_engine import (
    WorkflowError,
    AuthenticationError,
    RateLimitError,
    NotFoundError,
    ValidationError
)

try:
    execution = client.trigger_workflow(
        workflow_id='workflow-id',
        input={'data': 'example'}
    )
except AuthenticationError as e:
    print(f"Invalid API key: {e.message}")
except RateLimitError as e:
    print(f"Rate limited, retry after: {e.retry_after}")
except NotFoundError as e:
    print(f"Workflow not found: {e.message}")
except ValidationError as e:
    print(f"Validation error: {e.message}")
    print(f"Details: {e.details}")
except WorkflowError as e:
    print(f"API error [{e.code}]: {e.message}")
```

### Context Manager

Use the client as a context manager for automatic cleanup:

```python
with WorkflowClient(api_key=api_key) as client:
    execution = client.trigger_workflow(
        workflow_id='workflow-id',
        input={'data': 'example'}
    )
    print(f"Execution: {execution['executionId']}")
# Session automatically closed
```

## Requirements

- Python 3.8+
- requests >= 2.28.0
- pydantic >= 2.0.0

## License

MIT
