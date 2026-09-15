import * as crypto from 'crypto';

/**
 * Verify the HMAC signature of a webhook payload
 * @param payload - The raw request body as a string
 * @param signature - The signature from the X-Webhook-Signature header
 * @param secret - The webhook secret
 * @returns true if the signature is valid
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) {
    return false;
  }

  try {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    // Use timing-safe comparison
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

/**
 * Generate a webhook signature for testing
 * @param payload - The payload to sign
 * @param secret - The webhook secret
 * @returns HMAC signature
 */
export function generateWebhookSignature(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return hmac.digest('hex');
}
