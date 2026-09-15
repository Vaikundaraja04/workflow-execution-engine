export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export interface LogRecord extends LogFields {
  level: LogLevel;
  message: string;
  service: string;
  timestamp: string;
}

export const SERVICE_NAME = 'workflow-execution-engine';

const SENSITIVE_KEY_PATTERN = /password|token|secret|authorization|cookie/i;

export function sanitizeLogFields(fields: LogFields): LogFields {
  const sanitized: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    sanitized[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : value;
  }
  return sanitized;
}

export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  }
  return { errorMessage: String(error) };
}

function write(record: LogRecord): void {
  const line = JSON.stringify(record);
  if (record.level === 'error' || record.level === 'warn') console.error(line);
  else console.log(line);
}

export function log(level: LogLevel, message: string, fields: LogFields = {}): void {
  write({
    ...sanitizeLogFields(fields),
    level,
    message,
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
  });
}

export const logger = {
  debug: (message: string, fields?: LogFields) => log('debug', message, fields),
  info: (message: string, fields?: LogFields) => log('info', message, fields),
  warn: (message: string, fields?: LogFields) => log('warn', message, fields),
  error: (message: string, fields?: LogFields) => log('error', message, fields),
};