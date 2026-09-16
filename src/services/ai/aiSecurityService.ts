import type { ValidationError } from '../../types/workflow.js';
import { safeParseWorkflowDefinition, type WorkflowDefinitionInput } from '../../schemas/workflowSchema.js';
import { validateGraph } from '../../engine/validateGraph.js';

export const MAX_PROMPT_LENGTH = 4000;

// Patterns for sensitive data detection
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI API Key
  { pattern: /sk-[a-zA-Z0-9-_]{20,}/g, replacement: '[REDACTED_API_KEY]' },
  // Generic Bearer Token
  { pattern: /Bearer\s+[a-zA-Z0-9_\-\.]{10,}/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  // AWS Access Key ID
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED_AWS_KEY]' },
  // Private Key Headers
  { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
  // Passwords in key-value / json
  { pattern: /("?password"?\s*[:=]\s*)(?:"[^"]+"|[^\s,;]+)/gi, replacement: '$1[REDACTED_PASSWORD]' },
  { pattern: /("?secret"?\s*[:=]\s*)(?:"[^"]+"|[^\s,;]+)/gi, replacement: '$1[REDACTED_SECRET]' },
];

// Patterns for prompt injection detection & mitigation
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|system)\s+prompts?/i,
  /you\s+are\s+now\s+in\s+dan\s+mode/i,
  /bypass\s+(?:all\s+)?safety\s+filters?/i,
  /reveal\s+(?:system\s+prompt|all\s+rules|api\s*key)/i,
];

export class AISecurityService {
  /**
   * Validate and enforce input size limits.
   */
  static validatePrompt(prompt: unknown, maxLength: number = MAX_PROMPT_LENGTH): string {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('PROMPT_EMPTY: Prompt cannot be empty');
    }
    const trimmed = prompt.trim();
    if (trimmed.length > maxLength) {
      throw new Error(`PROMPT_TOO_LONG: Prompt exceeds maximum allowed length of ${maxLength} characters`);
    }
    return trimmed;
  }

  /**
   * Sanitize prompt by removing dangerous control characters and neutralizing prompt injection phrases.
   */
  static sanitizePrompt(prompt: string): string {
    // Remove null bytes and non-printable control characters (except standard whitespace)
    let sanitized = prompt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Check for obvious prompt injection attempts and neutralize or flag
    for (const pattern of INJECTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[FILTERED_INSTRUCTION]');
    }

    // Filter sensitive tokens/secrets
    sanitized = this.filterSensitiveData(sanitized);

    return sanitized.trim();
  }

  /**
   * Filter and mask sensitive data such as API keys, tokens, and passwords.
   */
  static filterSensitiveData(text: string): string {
    if (!text || typeof text !== 'string') return '';
    let filtered = text;
    for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
      filtered = filtered.replace(pattern, replacement);
    }
    return filtered;
  }

  /**
   * Deep sanitize an object to strip secrets from metadata or configs before logging or sending.
   */
  static sanitizeMetadata(obj: Record<string, unknown>): Record<string, unknown> {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (/password|token|secret|apiKey|authorization/i.test(key)) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        result[key] = this.filterSensitiveData(value);
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.sanitizeMetadata(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Validate generated workflow structure against schema and graph validity rules.
   */
  static validateGeneratedWorkflow(draft: unknown): {
    isValid: boolean;
    errors: ValidationError[];
    validatedDefinition?: WorkflowDefinitionInput;
  } {
    if (!draft || typeof draft !== 'object') {
      return {
        isValid: false,
        errors: [{ type: 'INVALID_WORKFLOW_SCHEMA', message: 'Generated workflow is not an object' }],
      };
    }

    const parseResult = safeParseWorkflowDefinition(draft);
    if (!parseResult.success) {
      const zodErrors: ValidationError[] = parseResult.error.issues.map((issue) => ({
        type: 'INVALID_WORKFLOW_SCHEMA',
        message: `${issue.path.join('.')}: ${issue.message}`,
      }));
      return {
        isValid: false,
        errors: zodErrors,
      };
    }

    const graphErrors = validateGraph(parseResult.data);
    return {
      isValid: graphErrors.length === 0,
      errors: graphErrors,
      validatedDefinition: parseResult.data,
    };
  }
}
