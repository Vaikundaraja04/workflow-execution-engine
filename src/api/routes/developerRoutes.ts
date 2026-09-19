import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { getWorkspaceContext, requireMembership } from '../middleware/requirePermission.js';
import { WEBHOOK_EVENTS } from '../../models/WebhookModel.js';
import { PERMISSIONS } from '../../auth/permissions.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { createAuditLog } from '../../services/auditService.js';
import { developerPortalService } from '../../services/developerPortalService.js';

const API_VERSION = '1.0.0';

const INTEGRATION_EXAMPLES = [
  {
    id: 'node-trigger-workflow',
    title: 'Trigger Workflow (Node.js)',
    language: 'javascript',
    description: 'Trigger a workflow execution using the JavaScript SDK',
    code: `import { WorkflowClient } from '@workflow-engine/sdk';

const client = new WorkflowClient({
  apiKey: process.env.WORKFLOW_API_KEY,
  baseURL: 'https://api.example.com'
});

async function triggerWorkflow() {
  const execution = await client.workflows.trigger('workflow-id', {
    input: { orderId: '12345', amount: 150.00 },
    idempotencyKey: 'order-12345-approval'
  });

  console.log('Execution started:', execution.executionId);
  console.log('Status:', execution.status);
}

triggerWorkflow().catch(console.error);`,
  },
  {
    id: 'python-trigger-workflow',
    title: 'Trigger Workflow (Python)',
    language: 'python',
    description: 'Trigger a workflow execution using the Python SDK',
    code: `from workflow_engine import WorkflowClient
import os

client = WorkflowClient(
    api_key=os.environ['WORKFLOW_API_KEY'],
    base_url='https://api.example.com'
)

def trigger_workflow():
    execution = client.workflows.trigger(
        workflow_id='workflow-id',
        input={'orderId': '12345', 'amount': 150.00},
        idempotency_key='order-12345-approval'
    )

    print(f"Execution started: {execution['executionId']}")
    print(f"Status: {execution['status']}")

if __name__ == '__main__':
    trigger_workflow()`,
  },
  {
    id: 'webhook-verify-signature',
    title: 'Verify Webhook Signature (Node.js)',
    language: 'javascript',
    description: 'Verify HMAC signature for incoming webhooks',
    code: `import { verifyWebhookSignature } from '@workflow-engine/sdk';
import express from 'express';

const app = express();
app.use(express.json());

app.post('/webhooks/workflow', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const webhookSecret = process.env.WEBHOOK_SECRET;

  const isValid = verifyWebhookSignature(
    JSON.stringify(req.body),
    signature,
    webhookSecret
  );

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { event, data } = req.body;
  console.log(\`Received event: \${event}\`, data);

  res.status(200).json({ received: true });
});

app.listen(3000);`,
  },
  {
    id: 'webhook-verify-python',
    title: 'Verify Webhook Signature (Python)',
    language: 'python',
    description: 'Verify HMAC signature for incoming webhooks',
    code: `from workflow_engine import verify_webhook_signature
from flask import Flask, request, jsonify
import os

app = Flask(__name__)

@app.route('/webhooks/workflow', methods=['POST'])
def handle_webhook():
    signature = request.headers.get('X-Webhook-Signature')
    webhook_secret = os.environ['WEBHOOK_SECRET']

    is_valid = verify_webhook_signature(
        request.get_data(as_text=True),
        signature,
        webhook_secret
    )

    if not is_valid:
        return jsonify({'error': 'Invalid signature'}), 401

    data = request.json
    event = data.get('event')
    payload = data.get('data')

    print(f"Received event: {event}", payload)

    return jsonify({'received': True}), 200

if __name__ == '__main__':
    app.run(port=3000)`,
  },
  {
    id: 'curl-trigger-workflow',
    title: 'Trigger Workflow (cURL)',
    language: 'bash',
    description: 'Trigger a workflow using direct API call',
    code: `curl -X POST https://api.example.com/api/v1/workflows/{workflowId}/trigger \\
  -H "Authorization: Bearer wke_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "input": {
      "orderId": "12345",
      "amount": 150.00
    },
    "idempotencyKey": "order-12345-approval"
  }'`,
  },
  {
    id: 'error-handling-node',
    title: 'Error Handling (Node.js)',
    language: 'javascript',
    description: 'Handle API errors properly',
    code: `import { WorkflowClient, WorkflowError } from '@workflow-engine/sdk';

const client = new WorkflowClient({
  apiKey: process.env.WORKFLOW_API_KEY
});

async function triggerWithErrorHandling() {
  try {
    const execution = await client.workflows.trigger('workflow-id', {
      input: { data: 'example' }
    });
    console.log('Success:', execution.executionId);
  } catch (error) {
    if (error instanceof WorkflowError) {
      console.error('API Error:', error.code, error.message);
      console.error('Status:', error.statusCode);
      console.error('Request ID:', error.requestId);
    } else {
      console.error('Unexpected error:', error);
    }
  }
}`,
  },
  {
    id: 'error-handling-python',
    title: 'Error Handling (Python)',
    language: 'python',
    description: 'Handle API errors properly',
    code: `from workflow_engine import WorkflowClient, WorkflowError

client = WorkflowClient(api_key=os.environ['WORKFLOW_API_KEY'])

def trigger_with_error_handling():
    try:
        execution = client.workflows.trigger(
            workflow_id='workflow-id',
            input={'data': 'example'}
        )
        print(f"Success: {execution['executionId']}")
    except WorkflowError as e:
        print(f"API Error: {e.code} - {e.message}")
        print(f"Status: {e.status_code}")
        print(f"Request ID: {e.request_id}")
    except Exception as e:
        print(f"Unexpected error: {e}")

if __name__ == '__main__':
    trigger_with_error_handling()`,
  },
];

export function createDeveloperRouter(): Router {
  const router = Router();

  // GET /api/v1/developer/info - Developer API information
  router.get('/info', requireMembership(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getWorkspaceContext(req);
      const user = getAuthUser(req);

      // Log developer docs view
      await createAuditLog({
        action: 'DEVELOPER_DOCS_VIEWED',
        userId: user.userId,
        workspaceId: ctx.workspaceId,
        resource: 'developer_docs',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        apiVersion: API_VERSION,
        supportedEvents: WEBHOOK_EVENTS,
        permissions: PERMISSIONS,
        rateLimits: {
          default: {
            requestsPerMinute: 1000,
            executionsPerHour: 5000,
          },
          configurable: true,
          description: 'Rate limits can be customized per API key',
        },
        webhookEvents: WEBHOOK_EVENTS.map(event => ({
          event,
          description: getEventDescription(event),
        })),
        authentication: {
          type: 'API Key',
          header: 'Authorization',
          format: 'Bearer {apiKey}',
          keyPrefix: 'wke_',
        },
        sdks: [
          {
            name: 'JavaScript/TypeScript SDK',
            package: '@workflow-engine/sdk',
            repository: 'https://github.com/workflow-engine/sdk-js',
            documentation: '/docs/sdks/javascript',
          },
          {
            name: 'Python SDK',
            package: 'workflow-engine',
            repository: 'https://github.com/workflow-engine/sdk-python',
            documentation: '/docs/sdks/python',
          },
        ],
        endpoints: {
          trigger: 'POST /api/v1/workflows/{workflowId}/trigger',
          apiKeys: 'GET /api/v1/keys',
          webhooks: 'GET /api/v1/webhooks',
          documentation: 'GET /api/docs',
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/developer/examples - Integration examples
  router.get('/examples', requireMembership(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getWorkspaceContext(req);
      const user = getAuthUser(req);

      await createAuditLog({
        action: 'DEVELOPER_DOCS_VIEWED',
        userId: user.userId,
        workspaceId: ctx.workspaceId,
        resource: 'developer_examples',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      const language = req.query.language as string | undefined;
      const filtered = language
        ? INTEGRATION_EXAMPLES.filter(ex => ex.language === language)
        : INTEGRATION_EXAMPLES;

      res.json({
        examples: filtered,
        languages: ['javascript', 'python', 'bash'],
        categories: ['trigger', 'webhook', 'error-handling'],
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/developer - Developer portal landing / overview
  router.get('/', requireMembership(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getWorkspaceContext(req);
      const analytics = await developerPortalService.getApiKeyAnalytics(ctx.workspaceId);
      const docs = developerPortalService.getApiDocumentation();
      const sdks = developerPortalService.getSdkDownloads();

      res.json({
        portal: {
          title: 'Workflow Engine Developer Portal',
          version: '1.0.0',
          workspaceId: ctx.workspaceId,
        },
        analytics,
        sdks,
        docs,
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/developer/analytics - API key analytics & latency metrics
  router.get('/analytics', requireMembership(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getWorkspaceContext(req);
      const analytics = await developerPortalService.getApiKeyAnalytics(ctx.workspaceId);
      res.json(analytics);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/developer/usage - Developer usage & telemetry dashboard
  router.get('/usage', requireMembership(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getWorkspaceContext(req);
      const usage = await developerPortalService.getUsageDashboard(ctx.workspaceId);
      res.json(usage);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/developer/history - Recent SDK & API request history
  router.get('/history', requireMembership(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getWorkspaceContext(req);
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const history = await developerPortalService.getRequestHistory(ctx.workspaceId, limit);
      res.json({ history });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/developer/sdks - Official SDK downloads and quickstart snippets
  router.get('/sdks', requireMembership(), async (_req: Request, res: Response) => {
    const sdks = developerPortalService.getSdkDownloads();
    res.json({ sdks });
  });

  // GET /api/v1/developer/docs - Developer API documentation overview
  router.get('/docs', requireMembership(), async (_req: Request, res: Response) => {
    const docs = developerPortalService.getApiDocumentation();
    res.json(docs);
  });

  return router;
}

function getEventDescription(event: string): string {
  const descriptions: Record<string, string> = {
    WORKFLOW_EXECUTION_STARTED: 'Fired when a workflow execution begins processing',
    WORKFLOW_EXECUTION_COMPLETED: 'Fired when a workflow execution completes successfully',
    WORKFLOW_EXECUTION_FAILED: 'Fired when a workflow execution fails after all retries',
    WORKFLOW_EXECUTION_REPLAYED: 'Fired when a finished execution is replayed',
  };
  return descriptions[event] || 'Workflow event';
}
