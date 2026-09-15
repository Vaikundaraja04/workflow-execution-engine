"""
Webhook Handler Example (Python with Flask)
Demonstrates how to securely verify and handle incoming workflow webhooks
"""

import os
from flask import Flask, request, jsonify
from workflow_engine import verify_webhook_signature

app = Flask(__name__)
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "your_webhook_secret_here")


@app.route("/webhooks/workflow-events", methods=["POST"])
def handle_webhook():
    # Get the raw request body as string for signature verification
    payload = request.get_data(as_text=True)
    signature = request.headers.get("X-Webhook-Signature")

    # Verify HMAC signature
    is_valid = verify_webhook_signature(payload, signature, WEBHOOK_SECRET)

    if not is_valid:
        print("❌ Invalid webhook signature!")
        return jsonify({"error": "Invalid signature"}), 401

    # Signature is valid, process the event
    data = request.json
    event = data.get("event")
    delivery_id = data.get("deliveryId")
    timestamp = data.get("timestamp")
    payload_data = data.get("data", {})

    print(f"✅ Received verified webhook event: {event}")
    print(f"Delivery ID: {delivery_id}")
    print(f"Timestamp: {timestamp}")
    print(f"Execution ID: {payload_data.get('executionId')}")
    print(f"Workflow ID: {payload_data.get('workflowId')}")
    print(f"Status: {payload_data.get('status')}")

    # Handle specific event types
    if event == "WORKFLOW_EXECUTION_STARTED":
        print(f"Execution {payload_data.get('executionId')} has started")

    elif event == "WORKFLOW_EXECUTION_COMPLETED":
        print(f"Execution {payload_data.get('executionId')} succeeded!")
        print(f"Results: {payload_data.get('result')}")

    elif event == "WORKFLOW_EXECUTION_FAILED":
        print(f"Execution {payload_data.get('executionId')} failed!")
        print(f"Error: {payload_data.get('error')}")

    elif event == "WORKFLOW_EXECUTION_REPLAYED":
        print(f"Execution {payload_data.get('executionId')} is being replayed")

    # Always return 200 OK quickly
    return jsonify({"received": True}), 200


if __name__ == "__main__":
    port = int(os.getenv("PORT", 3000))
    print(f"🚀 Webhook server listening on port {port}")
    app.run(port=port)
