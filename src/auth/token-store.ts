// Token persistence & refresh

import type { OAuthTokens, Provider } from '../config/types.js'
import { GMAIL_AUTH, OUTLOOK_AUTH } from '../config/types.js'

export interface TokenRefreshConfig {
  provider: Provider
  client_id: string
  client_secret: string
  tokens: OAuthTokens
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(config: TokenRefreshConfig): Promise<OAuthTokens> {
  const tokenUrl = config.provider === 'gmail' ? GMAIL_AUTH.tokenUrl : OUTLOOK_AUTH.tokenUrl

  const params = new URLSearchParams({
    client_id: config.client_id,
    client_secret: config.client_secret,
    refresh_token: config.tokens.refresh_token,
    grant_type: 'refresh_token',
  })

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Token refresh failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    token_type: string
    scope?: string
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || config.tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type,
    scope: data.scope || config.tokens.scope,
  }
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCodeForTokens(options: {
  provider: Provider
  code: string
  client_id: string
  client_secret: string
  redirect_uri: string
}): Promise<OAuthTokens> {
  const tokenUrl = options.provider === 'gmail' ? GMAIL_AUTH.tokenUrl : OUTLOOK_AUTH.tokenUrl

  const params = new URLSearchParams({
    client_id: options.client_id,
    client_secret: options.client_secret,
    code: options.code,
    redirect_uri: options.redirect_uri,
    grant_type: 'authorization_code',
  })

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Token exchange failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    token_type: string
    scope?: string
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type,
    scope: data.scope,
  }
}

/**
 * Build the OAuth2 authorization URL.
 */
export function buildAuthUrl(options: {
  provider: Provider
  client_id: string
  redirect_uri: string
  state?: string
}): string {
  const config = options.provider === 'gmail' ? GMAIL_AUTH : OUTLOOK_AUTH
  const params = new URLSearchParams({
    client_id: options.client_id,
    redirect_uri: options.redirect_uri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  })

  if (options.state) {
    params.set('state', options.state)
  }

  return `${config.authUrl}?${params.toString()}`
}
