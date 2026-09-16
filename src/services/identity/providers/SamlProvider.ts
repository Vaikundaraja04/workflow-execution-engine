import type { IdentityProvider, IdentityProviderConfig, CallbackParams, CallbackResult } from './IdentityProvider.js';

/**
 * SAML 2.0 Identity Provider Foundation
 *
 * Note: Full SAML 2.0 implementation requires a vetted XML-DSig and SAML library
 * (e.g. @node-saml/node-saml). This class implements the IdentityProvider interface
 * to establish architectural compatibility for future enterprise SAML integrations.
 */
export class SamlProvider implements IdentityProvider {
  readonly issuer: string;
  readonly clientId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly userinfoEndpoint?: string | undefined;
  readonly jwksUri?: string | undefined;
  readonly scopes: string[];

  constructor(config: IdentityProviderConfig) {
    this.issuer = config.issuer;
    this.clientId = config.clientId;
    this.authorizationEndpoint = config.authorizationEndpoint;
    this.tokenEndpoint = config.tokenEndpoint;
    this.userinfoEndpoint = config.userinfoEndpoint;
    this.jwksUri = config.jwksUri;
    this.scopes = config.scopes || [];
  }

  async getAuthorizationUrl(state: string, _nonce: string, redirectUri?: string | undefined): Promise<string> {
    const callback = redirectUri || `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/sso/callback`;
    const params = new URLSearchParams({
      RelayState: state,
      Target: callback,
    });
    const separator = this.authorizationEndpoint.includes('?') ? '&' : '?';
    return `${this.authorizationEndpoint}${separator}${params.toString()}`;
  }

  async handleCallback(_params: CallbackParams): Promise<CallbackResult> {
    throw new Error('SAML_PROTOCOL_NOT_IMPLEMENTED: SAML 2.0 assertion verification requires approved XML-DSig dependency');
  }

  async validateIdToken(_idToken: string, _expectedNonce?: string | undefined): Promise<Record<string, unknown>> {
    throw new Error('SAML_PROTOCOL_NOT_IMPLEMENTED: Use SAML assertion parser instead of ID token');
  }

  async getUserInfo(_accessToken: string): Promise<Record<string, unknown>> {
    return {};
  }

  async logout(_refreshToken?: string | undefined): Promise<void> {
    return;
  }
}
