/**
 * Workflow Trigger with Retry Policy Example (JavaScript/Node.js)
 * Demonstrates how to configure retry policies for workflow executions
 */

import { WorkflowClient } from '@workflow-engine/sdk';

// Initialize the client
const client = new WorkflowClient({
  apiKey: process.env.WORKFLOW_API_KEY || 'wke_your_api_key_here',
  baseURL: process.env.WORKFLOW_API_URL || 'https://api.example.com'
});

async function triggerWorkflowWithRetry() {
  try {
    // Trigger a workflow with exponential backoff retry policy
    const execution = await client.workflows.trigger('workflow-id-here', {
      input: {
        fileId: 'FILE-98765',
        operation: 'process-pdf',
        pages: 42
      },
      timeoutMs: 300000, // 5 minute timeout
      retryPolicy: {
        type: 'EXPONENTIAL',
        delayMs: 1000, // Start with 1 second delay
        backoffFactor: 2, // Double the delay each attempt
        maxRetries: 3 // Maximum 3 retry attempts
      }
    });

    console.log('✅ Workflow triggered with retry policy!');
    console.log('Execution ID:', execution.executionId);
    console.log('Status:', execution.status);
    console.log('Max retries allowed:', execution.maxRetries);

    return execution;
  } catch (error) {
    console.error('❌ Failed to trigger workflow:');
    if (error.name === 'WorkflowError') {
      console.error('Code:', error.code);
      console.error('Message:', error.message);
      console.error('Status:', error.statusCode);
    } else {
      console.error(error);
    }
    throw error;
  }
}

// Execute the function
triggerWorkflowWithRetry().catch(console.error);