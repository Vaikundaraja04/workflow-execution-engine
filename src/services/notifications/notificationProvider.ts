/**
 * Phase 15.6 - Notification transport abstraction.
 *
 * The platform renders templates and hands finished messages to a provider.
 * Only the mock provider is implemented today (it records the message and
 * returns a synthetic id, so tests and local runs never call the network).
 * SendGrid / AWS SES / Resend slot in behind the same interface once their
 * credentials are configured - selecting one now fails fast instead of
 * pretending a message was delivered.
 */

export const NOTIFICATION_PROVIDER_NAMES = ['mock', 'sendgrid', 'ses', 'resend'] as const;
export type NotificationProviderName = (typeof NOTIFICATION_PROVIDER_NAMES)[number];

export interface NotificationMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface NotificationSendResult {
  provider: string;
  providerMessageId: string | null;
}

export interface NotificationProvider {
  name: string;
  send(message: NotificationMessage): Promise<NotificationSendResult>;
}

export function isNotificationProviderName(value: unknown): value is NotificationProviderName {
  return typeof value === 'string' && (NOTIFICATION_PROVIDER_NAMES as readonly string[]).includes(value);
}

/** Default provider. Real transports are opt-in through NOTIFICATION_PROVIDER. */
export function resolveNotificationProviderName(value?: string | undefined): NotificationProviderName {
  const candidate = (value ?? process.env.NOTIFICATION_PROVIDER ?? 'mock').trim().toLowerCase();
  return isNotificationProviderName(candidate) ? candidate : 'mock';
}

export class MockNotificationProvider implements NotificationProvider {
  readonly name = 'mock';
  /** Messages the mock provider has accepted, for assertions in tests. */
  readonly sent: NotificationMessage[] = [];

  async send(message: NotificationMessage): Promise<NotificationSendResult> {
    this.sent.push(message);
    return { provider: this.name, providerMessageId: `mock-${this.sent.length}` };
  }
}

class UnsupportedNotificationProvider implements NotificationProvider {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  async send(): Promise<NotificationSendResult> {
    throw new Error('UNSUPPORTED_PROVIDER_OPERATION');
  }
}

const mockProvider = new MockNotificationProvider();

export function createNotificationProvider(name?: string | undefined): NotificationProvider {
  const resolved = resolveNotificationProviderName(name);
  if (resolved === 'mock') return mockProvider;
  return new UnsupportedNotificationProvider(resolved);
}

export function getMockNotificationProvider(): MockNotificationProvider {
  return mockProvider;
}
