// OAuth authorization, PKCE, token exchange and refresh primitives.

import { createHash, randomBytes } from 'node:crypto'
import type {
  OAuthProviderConfig,
  OAuthTokens,
  Provider,
} from '../config/types.js'
import {
  GMAIL_AUTH,
  OUTLOOK_AUTH,
} from '../config/types.js'

export interface TokenRefreshConfig {
  provider: Provider
  client_id: string
  client_secret?: string
  tokens: OAuthTokens
}

export interface PkcePair {
  verifier: string
  challenge: string
  method: 'S256'
}

const refreshes = new Map<string, Promise<OAuthTokens>>()
const AUTH_CONFIGS: Readonly<Record<Provider, OAuthProviderConfig>> = {
  gmail: GMAIL_AUTH,
  outlook: OUTLOOK_AUTH,
}

export function generateOAuthState(): string {
  return randomBytes(32).toString('base64url')
}

export function generatePkcePair(): PkcePair {
  // RFC 7636 permits 43-128 unreserved characters. A 64-byte base64url value
  // is 86 characters and contains only the permitted alphabet.
  const verifier = randomBytes(64).toString('base64url')
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
  return { verifier, challenge, method: 'S256' }
}

function refreshKey(config: TokenRefreshConfig): string {
  return createHash('sha256')
    .update(config.provider)
    .update('\0')
    .update(config.client_id)
    .update('\0')
    .update(config.tokens.refresh_token)
    .digest('hex')
}

function authConfig(provider: Provider): OAuthProviderConfig {
  return AUTH_CONFIGS[provider]
}

function appendClientSecret(
  params: URLSearchParams,
  config: OAuthProviderConfig,
  clientSecret: string | undefined,
): void {
  if (config.allowsClientSecret && clientSecret) {
    params.set('client_secret', clientSecret)
  }
}

async function oauthFailure(response: Response, action: string): Promise<Error> {
  let providerCode = 'oauth_error'
  try {
    const data = await response.json() as { error?: string }
    if (typeof data.error === 'string' && /^[a-zA-Z0-9_.-]+$/.test(data.error)) {
      providerCode = data.error
    }
  } catch {
    // Do not include arbitrary provider bodies: they can contain credentials.
  }
  return new Error(`${action} failed (${response.status}, ${providerCode})`)
}

async function performRefresh(config: TokenRefreshConfig): Promise<OAuthTokens> {
  if (!config.tokens.refresh_token) throw new Error('Token refresh failed: missing refresh token')
  const providerConfig = authConfig(config.provider)

  const params = new URLSearchParams({
    client_id: config.client_id,
    refresh_token: config.tokens.refresh_token,
    grant_type: 'refresh_token',
  })
  appendClientSecret(params, providerConfig, config.client_secret)

  const response = await fetch(providerConfig.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  })
  if (!response.ok) throw await oauthFailure(response, 'Token refresh')

  const data = await response.json() as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
    scope?: string
  }
  if (!data.access_token || typeof data.expires_in !== 'number'
    || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
    throw new Error('Token refresh failed: provider returned an invalid token response')
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || config.tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type || config.tokens.token_type || 'Bearer',
    scope: data.scope || config.tokens.scope,
  }
}

/** Refresh is single-flight for the same account credential set. */
export function refreshAccessToken(config: TokenRefreshConfig): Promise<OAuthTokens> {
  const key = refreshKey(config)
  const inFlight = refreshes.get(key)
  if (inFlight) return inFlight

  const operation = performRefresh(config).finally(() => {
    if (refreshes.get(key) === operation) refreshes.delete(key)
  })
  refreshes.set(key, operation)
  return operation
}

/** Exchange an authorization code using an S256 PKCE verifier. */
export async function exchangeCodeForTokens(options: {
  provider: Provider
  code: string
  client_id: string
  client_secret?: string
  redirect_uri: string
  code_verifier: string
}): Promise<OAuthTokens> {
  const providerConfig = authConfig(options.provider)
  const params = new URLSearchParams({
    client_id: options.client_id,
    code: options.code,
    redirect_uri: options.redirect_uri,
    grant_type: 'authorization_code',
  })
  params.set('code_verifier', options.code_verifier)
  appendClientSecret(params, providerConfig, options.client_secret)

  const response = await fetch(providerConfig.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  })
  if (!response.ok) throw await oauthFailure(response, 'Token exchange')

  const data = await response.json() as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
    scope?: string
  }
  if (!data.access_token || !data.refresh_token || typeof data.expires_in !== 'number'
    || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
    throw new Error('Token exchange failed: provider returned an invalid token response')
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type || 'Bearer',
    scope: data.scope,
  }
}

export function buildAuthUrl(options: {
  provider: Provider
  client_id: string
  redirect_uri: string
  state: string
  code_challenge: string
  scopes?: readonly string[]
  fullAccess?: boolean
}): string {
  const providerConfig = authConfig(options.provider)
  const scopes = options.scopes ?? (
    options.fullAccess
      ? providerConfig.fullAccessScopes ?? providerConfig.scopes
      : providerConfig.scopes
  )
  const params = new URLSearchParams({
    client_id: options.client_id,
    redirect_uri: options.redirect_uri,
    response_type: 'code',
    scope: scopes.join(' '),
  })

  for (const [key, value] of Object.entries(providerConfig.extraAuthParams)) {
    params.set(key, value)
  }
  params.set('state', options.state)
  params.set('code_challenge', options.code_challenge)
  params.set('code_challenge_method', 'S256')

  return `${providerConfig.authUrl}?${params.toString()}`
}
