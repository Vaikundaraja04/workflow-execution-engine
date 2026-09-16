export class TemplateNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'TEMPLATE_NOT_FOUND';
  constructor(message = 'Template not found') {
    super(message);
    this.name = 'TemplateNotFoundError';
  }
}

export class TemplateAccessDeniedError extends Error {
  readonly statusCode = 403;
  readonly code = 'TEMPLATE_ACCESS_DENIED';
  constructor(message = 'Access denied to template') {
    super(message);
    this.name = 'TemplateAccessDeniedError';
  }
}

export class TemplatePublishError extends Error {
  readonly statusCode = 400;
  readonly code = 'TEMPLATE_PUBLISH_ERROR';
  constructor(message = 'Template cannot be published') {
    super(message);
    this.name = 'TemplatePublishError';
  }
}

export class TemplateValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'TEMPLATE_VALIDATION_ERROR';
  constructor(message = 'Template validation failed') {
    super(message);
    this.name = 'TemplateValidationError';
  }
}

export class TemplatePackageError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_TEMPLATE_PACKAGE';
  constructor(message = 'Invalid template package') {
    super(message);
    this.name = 'TemplatePackageError';
  }
}
