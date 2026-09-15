/**
 * Webhook Handler Example (JavaScript/Node.js with Express)
 * Demonstrates how to securely verify and handle incoming workflow webhooks
 */

import express from 'express';
import { verifyWebhookSignature } from '@workflow-engine/sdk';

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'your_webhook_secret_here';

// IMPORTANT: Webhook signature verification requires the raw request body
// Use express.raw or verify with text body
app.use(express.json({
  verify: (req, res, buf) => {
    // Store raw body for signature verification
    req.rawBody = buf.toString();
  }
}));

// Webhook endpoint
app.post('/webhooks/workflow-events', (req, res) => {
  const signature = req.headers['x-webhook-signature'];

  // Verify HMAC signature
  const isValid = verifyWebhookSignature(
    req.rawBody || JSON.stringify(req.body),
    signature,
    WEBHOOK_SECRET
  );

  if (!isValid) {
    console.error('❌ Invalid webhook signature!');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Signature is valid, process the event
  const { event, deliveryId, timestamp, data } = req.body;

  console.log(`✅ Received verified webhook event: ${event}`);
  console.log('Delivery ID:', deliveryId);
  console.log('Timestamp:', timestamp);
  console.log('Execution ID:', data.executionId);
  console.log('Workflow ID:', data.workflowId);
  console.log('Status:', data.status);

  // Handle specific event types
  switch (event) {
    case 'WORKFLOW_EXECUTION_STARTED':
      console.log(`Execution ${data.executionId} has started`);
      break;

    case 'WORKFLOW_EXECUTION_COMPLETED':
      console.log(`Execution ${data.executionId} succeeded!`);
      console.log('Results:', data.result);
      // Perform post-execution actions (e.g., notify user, update database)
      break;

    case 'WORKFLOW_EXECUTION_FAILED':
      console.error(`Execution ${data.executionId} failed!`);
      console.error('Error:', data.error);
      // Perform error recovery actions (e.g., alert team)
      break;

    case 'WORKFLOW_EXECUTION_REPLAYED':
      console.log(`Execution ${data.executionId} is being replayed`);
      break;

    default:
      console.log(`Unhandled event type: ${event}`);
  }

  // Always return 200 OK quickly to acknowledge receipt
  return res.status(200).json({ received: true });
});

app.listen(PORT, () => {
  console.log(`🚀 Webhook server listening on port ${PORT}`);
  console.log(`Endpoint: http://localhost:${PORT}/webhooks/workflow-events`);
});
