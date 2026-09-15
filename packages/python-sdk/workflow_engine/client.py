import requests
from typing import Optional, Dict, Any
from .errors import (
    WorkflowError,
    AuthenticationError,
    RateLimitError,
    NotFoundError,
    ValidationError,
)


class WorkflowClient:
    """Official Python client for the Workflow Execution Engine API"""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.workflow-engine.example.com",
        timeout: int = 30,
        headers: Optional[Dict[str, str]] = None
    ):
        if not api_key:
            raise ValueError("API key is required")
        if not api_key.startswith("wke_"):
            raise ValueError('Invalid API key format. API keys must start with "wke_"')

        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "workflow-engine-python/1.0.0",
            **(headers or {}),
        })

    def _request(self, method: str, path: str, **kwargs) -> Any:
        """Make HTTP request and handle errors"""
        url = f"{self.base_url}{path}"

        try:
            response = self.session.request(
                method,
                url,
                timeout=self.timeout,
                **kwargs
            )

            # Parse response
            try:
                data = response.json() if response.content else None
            except ValueError:
                data = response.text

            # Handle errors
            if not response.ok:
                self._handle_error(response.status_code, data, response.headers)

            return data

        except requests.exceptions.Timeout:
            raise WorkflowError("Request timeout", code="TIMEOUT", status_code=408)
        except requests.exceptions.RequestException as e:
            raise WorkflowError(f"Request failed: {str(e)}", code="REQUEST_FAILED")

    def _handle_error(self, status_code: int, data: Any, headers: Dict) -> None:
        """Handle HTTP error responses"""
        error_data = data if isinstance(data, dict) else {}
        error_info = error_data.get("error", {})
        message = error_info.get("message", "Unknown error")
        code = error_info.get("code", "UNKNOWN_ERROR")
        request_id = error_info.get("requestId")

        if status_code == 401:
            raise AuthenticationError(message, request_id=request_id)
        elif status_code == 429:
            retry_after = headers.get("Retry-After")
            raise RateLimitError(
                message,
                retry_after=int(retry_after) if retry_after else None,
                request_id=request_id
            )
        elif status_code == 404:
            raise NotFoundError(message, code=code, request_id=request_id)
        elif status_code in (400, 422):
            raise ValidationError(message, details=error_data, request_id=request_id)
        else:
            raise WorkflowError(message, code=code, status_code=status_code, request_id=request_id)

    def trigger_workflow(
        self,
        workflow_id: str,
        input: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
        timeout_ms: Optional[int] = None,
        retry_policy: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Trigger a workflow execution.

        :param workflow_id: The workflow ID to trigger
        :param input: Input data for the workflow
        :param idempotency_key: Optional idempotency key for deduplication
        :param timeout_ms: Execution timeout in milliseconds
        :param retry_policy: Retry policy configuration
        :return: Execution response
        """
        body = {}
        if input is not None:
            body["input"] = input
        if idempotency_key:
            body["idempotencyKey"] = idempotency_key
        if timeout_ms:
            body["timeoutMs"] = timeout_ms
        if retry_policy:
            body["retryPolicy"] = retry_policy

        return self._request(
            "POST",
            f"/api/v1/workflows/{workflow_id}/trigger",
            json=body
        )

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.session.close()
