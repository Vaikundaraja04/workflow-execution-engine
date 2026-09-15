/**
 * Basic Workflow Trigger Example (JavaScript/Node.js)
 * Demonstrates how to trigger a workflow execution using the JavaScript SDK
 */

import { WorkflowClient } from '@workflow-engine/sdk';

// Initialize the client with your API key
const client = new WorkflowClient({
  apiKey: process.env.WORKFLOW_API_KEY || 'wke_your_api_key_here',
  baseURL: process.env.WORKFLOW_API_URL || 'https://api.example.com'
});

async function triggerWorkflow() {
  try {
    // Trigger a workflow execution
    const execution = await client.workflows.trigger('workflow-id-here', {
      input: {
        orderId: 'ORD-12345',
        amount: 150.00,
        customer: {
          id: 'CUST-67890',
          email: 'customer@example.com'
        }
      },
      idempotencyKey: 'order-ORD-12345-approval' // Prevents duplicate executions
    });

    console.log('✅ Workflow triggered successfully!');
    console.log('Execution ID:', execution.executionId);
    console.log('Workflow ID:', execution.workflowId);
    console.log('Status:', execution.status);
    console.log('Created at('Queued at:', execution.queuedAt);

    return execution;
  } catch (error) {
    console.error('❌ Failed to trigger workflow:');
    if (error.name === 'WorkflowError') {
      console.error('Code:', error.code);
      console.error('Message:', error.message);
      console.error('Status:', error.statusCode);
      console.error('Request ID:', error.requestId);
    } else {
      console.error(error);
    }
    throw error;
  }
}

// Execute the function
triggerWorkflow().catch(console.error);