class WorkflowError(Exception):
    """Base exception for all workflow engine errors"""
    def __init__(self, message: str, code: str = "UNKNOWN_ERROR", status_code: int = None, request_id: str = None, details: dict = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.request_id = request_id
        self.details = details or {}

    def __str__(self):
        return f"[{self.code}] {self.message}"


class AuthenticationError(WorkflowError):
    """Raised when API key is invalid or missing"""
    def __init__(self, message: str = "Authentication failed", request_id: str = None):
        super().__init__(message, code="UNAUTHENTICATED", status_code=401, request_id=request_id)


class RateLimitError(WorkflowError):
    """Raised when request rate limit is exceeded"""
    def __init__(self, message: str = "Rate limit exceeded", retry_after: int = None, request_id: str = None):
        super().__init__(message, code="RATE_LIMITED", status_code=429, request_id=request_id)
        self.retry_after = retry_after


class NotFoundError(WorkflowError):
    """Raised when a resource is not found"""
    def __init__(self, message: str = "Resource not found", code: str = "NOT_FOUND", request_id: str = None):
        super().__init__(message, code=code, status_code=404, request_id=request_id)


class ValidationError(WorkflowError):
    """Raised when request payload fails validation"""
    def __init__(self, message: str = "Validation failed", details: dict = None, request_id: str = None):
        super().__init__(message, code="INVALID_REQUEST", status_code=400, request_id=request_id, details=details)
