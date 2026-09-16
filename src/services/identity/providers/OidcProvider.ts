import type { IdentityProvider, IdentityProviderConfig, CallbackParams, CallbackResult } from './IdentityProvider.js';
import { randomBytes, createHash } from 'node:crypto';
import { URLSearchParams } from 'node:url';

/**
 * PKCE (Proof Key for Code Exchange) utilities
 */
export class Pkce {
  static async generateVerifier(): Promise<string> {
    return randomBytes(32).toString('base64url');
  }

  static async challengeFromVerifier(verifier: string): Promise<string> {
    const digest = createHash('sha256').update(verifier).digest();
    return digest
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
}

export class OidcProvider implements IdentityProvider {
  readonly issuer: string;
  readonly clientId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly userinfoEndpoint?: string | undefined;
  readonly jwksUri?: string | undefined;
  readonly scopes: string[];

  private clientSecret: string | undefined;

  constructor(config: IdentityProviderConfig & { clientSecret?: string | undefined }) {
    this.issuer = config.issuer;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.authorizationEndpoint = config.authorizationEndpoint;
    this.tokenEndpoint = config.tokenEndpoint;
    this.userinfoEndpoint = config.userinfoEndpoint;
    this.jwksUri = config.jwksUri;
    this.scopes = config.scopes && config.scopes.length > 0 ? config.scopes : ['openid', 'profile', 'email'];
  }

  async getAuthorizationUrl(
    state: string,
    nonce: string,
    redirectUri?: string | undefined,
    codeChallenge?: string | undefined,
  ): Promise<string> {
    const callbackUri = redirectUri || `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/sso/callback`;

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: callbackUri,
      response_type: 'code',
      scope: this.scopes.join(' '),
      state,
      nonce,
    });

    if (codeChallenge) {
      params.append('code_challenge', codeChallenge);
      params.append('code_challenge_method', 'S256');
    }

    const separator = this.authorizationEndpoint.includes('?') ? '&' : '?';
    return `${this.authorizationEndpoint}${separator}${params.toString()}`;
  }

  async handleCallback(params: CallbackParams): Promise<CallbackResult> {
    if (!this.tokenEndpoint) {
      throw new Error('Token endpoint not configured');
    }

    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      client_id: this.clientId,
    });

    if (params.redirectUri) {
      bodyParams.append('redirect_uri', params.redirectUri);
    }
    if (this.clientSecret) {
      bodyParams.append('client_secret', this.clientSecret);
    }
    if (params.codeVerifier) {
      bodyParams.append('code_verifier', params.codeVerifier);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };

    if (this.clientSecret && !bodyParams.has('client_secret')) {
      const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers,
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Token exchange failed with status ${response.status}: ${errText}`);
    }

    const tokenData = (await response.json()) as {
      access_token?: string | undefined;
      id_token?: string | undefined;
      token_type?: string | undefined;
      expires_in?: number | undefined;
      refresh_token?: string | undefined;
    };

    const result: CallbackResult = {};
    if (tokenData.access_token !== undefined) result.accessToken = tokenData.access_token;
    if (tokenData.id_token !== undefined) result.idToken = tokenData.id_token;
    if (tokenData.token_type !== undefined) result.tokenType = tokenData.token_type;
    if (tokenData.expires_in !== undefined) result.expiresIn = tokenData.expires_in;
    if (tokenData.refresh_token !== undefined) result.refreshToken = tokenData.refresh_token;

    return result;
  }

  async validateIdToken(idToken: string, expectedNonce?: string | undefined): Promise<Record<string, unknown>> {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid ID token format');
    }

    const [headerB64, payloadB64] = parts;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(headerB64!, 'base64url').toString('utf8')); // header check
      payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf8'));
    } catch {
      throw new Error('Failed to decode ID token');
    }

    // Verify issuer
    if (payload.iss !== this.issuer) {
      throw new Error('Invalid issuer');
    }

    // Verify audience (client_id)
    if (Array.isArray(payload.aud)) {
      if (!payload.aud.includes(this.clientId)) {
        throw new Error('Invalid audience');
      }
    } else if (payload.aud !== this.clientId) {
      throw new Error('Invalid audience');
    }

    // Verify expiration
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < nowSec) {
      throw new Error('Token expired');
    }

    // Verify nonce if provided
    if (expectedNonce && payload.nonce !== expectedNonce) {
      throw new Error('Invalid nonce');
    }

    return payload;
  }

  async getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
    if (!this.userinfoEndpoint) {
      throw new Error('Userinfo endpoint not configured');
    }

    const response = await fetch(this.userinfoEndpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user info: ${response.status}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  async logout(_refreshToken?: string | undefined): Promise<void> {
    return;
  }
}
