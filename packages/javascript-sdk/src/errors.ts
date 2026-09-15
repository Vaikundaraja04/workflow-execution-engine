export class WorkflowError extends Error {
  public readonly code: string;
  public readonly statusCode?: number | undefined;
  public readonly requestId?: string | undefined;
  public readonly details?: unknown;

  constructor(message: string, code: string, statusCode?: number | undefined, requestId?: string | undefined, details?: unknown) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.statusCode = statusCode;
    this.requestId = requestId;
    this.details = details;
    Object.setPrototypeOf(this, WorkflowError.prototype);
  }
}

export class AuthenticationError extends WorkflowError {
  constructor(message = 'Invalid API key or unauthenticated', requestId?: string | undefined) {
    super(message, 'UNAUTHENTICATED', 401, requestId);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

export class RateLimitError extends WorkflowError {
  public readonly retryAfter?: number | undefined;

  constructor(message = 'Rate limit exceeded', retryAfter?: number | undefined, requestId?: string | undefined) {
    super(message, 'RATE_LIMITED', 429, requestId);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class NotFoundError extends WorkflowError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND', requestId?: string | undefined) {
    super(message, code, 404, requestId);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ValidationError extends WorkflowError {
  constructor(message = 'Validation failed', details?: unknown, requestId?: string | undefined) {
    super(message, 'INVALID_REQUEST', 400, requestId, details);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
