import hmac
import hashlib


def verify_webhook_signature(payload: str, signature: str, secret: str) -> bool:
    """
    Verify HMAC-SHA256 signature for incoming webhooks.

    :param payload: Raw string body of the incoming request
    :param signature: Value from the X-Webhook-Signature header
    :param secret: Webhook signing secret
    :return: True if signature is valid, False otherwise
    """
    if not signature or not payload or not secret:
        return False

    try:
        expected = hmac.new(
            secret.encode('utf-8'),
            payload.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()

        return hmac.compare_digest(signature, expected)
    except Exception:
        return False


def generate_webhook_signature(payload: str, secret: str) -> str:
    """Generate HMAC-SHA256 signature for testing"""
    return hmac.new(
        secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
