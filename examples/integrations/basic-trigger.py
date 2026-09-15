"""
Basic Workflow Trigger Example (Python)
Demonstrates how to trigger a workflow execution using the Python SDK
"""

import os
from workflow_engine import WorkflowClient, WorkflowError

# Initialize client with API key
client = WorkflowClient(
    api_key=os.getenv("WORKFLOW_API_KEY", "wke_your_api_key_here"),
    base_url=os.getenv("WORKFLOW_API_URL", "https://api.example.com")
)


def trigger_workflow():
    try:
        # Trigger workflow execution
        execution = client.trigger_workflow(
            workflow_id="workflow-id-here",
            input={
                "orderId": "ORD-12345",
                "amount": 150.00,
                "customer": {
                    "id": "CUST-67890",
                    "email": "customer@example.com"
                }
            },
            idempotency_key="order-ORD-12345-approval"  # Prevents duplicate executions
        )

        print("✅ Workflow triggered successfully!")
        print(f"Execution ID: {execution.get('executionId')}")
        print(f"Workflow ID: {execution.get('workflowId')}")
        print(f"Status: {execution.get('status')}")
        print(f"Queued at: {execution.get('queuedAt')}")

        return execution

    except WorkflowError as e:
        print("❌ Failed to trigger workflow:")
        print(f"Code: {e.code}")
        print(f"Message: {e.message}")
        print(f"Status Code: {e.status_code}")
        print(f"Request ID: {e.request_id}")
        raise


if __name__ == "__main__":
    trigger_workflow()
