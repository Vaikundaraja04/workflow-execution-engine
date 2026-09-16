export interface CallbackParams {
  code: string;
  state: string;
  redirectUri?: string | undefined;
  codeVerifier?: string | undefined;
}

export interface CallbackResult {
  accessToken?: string | undefined;
  idToken?: string | undefined;
  tokenType?: string | undefined;
  expiresIn?: number | undefined;
  refreshToken?: string | undefined;
  profile?: Record<string, unknown> | undefined;
}

export interface IdentityProviderConfig {
  issuer: string;
  clientId: string;
  clientSecret?: string | undefined;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint?: string | undefined;
  jwksUri?: string | undefined;
  scopes: string[];
}

export interface IdentityProvider {
  readonly issuer: string;
  readonly clientId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly userinfoEndpoint?: string | undefined;
  readonly jwksUri?: string | undefined;
  readonly scopes: string[];

  /**
   * Builds the authorization URL to redirect the user to for initiating login.
   */
  getAuthorizationUrl(state: string, nonce: string, redirectUri?: string | undefined): Promise<string>;

  /**
   * Exchanges authorization code for tokens and extracts identity profile.
   */
  handleCallback(params: CallbackParams): Promise<CallbackResult>;

  /**
   * Validates and decodes an ID token, returning its verified claims payload.
   */
  validateIdToken(idToken: string, expectedNonce?: string | undefined): Promise<Record<string, unknown>>;

  /**
   * Fetches user profile information using the access token.
   */
  getUserInfo(accessToken: string): Promise<Record<string, unknown>>;

  /**
   * Optional logout / token revocation method.
   */
  logout(refreshToken?: string | undefined): Promise<void>;
}
