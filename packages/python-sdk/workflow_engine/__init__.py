"""
Workflow Engine Python SDK
Official Python client for the Workflow Execution Engine API
"""

from .client import WorkflowClient
from .webhooks import verify_webhook_signature, generate_webhook_signature
from .errors import (
    WorkflowError,
    AuthenticationError,
    RateLimitError,
    NotFoundError,
    ValidationError,
)

__version__ = "1.0.0"
__all__ = [
    "WorkflowClient",
    "verify_webhook_signature",
    "generate_webhook_signature",
    "WorkflowError",
    "AuthenticationError",
    "RateLimitError",
    "NotFoundError",
    "ValidationError",
]
