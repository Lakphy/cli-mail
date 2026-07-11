import { createHash } from 'node:crypto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  generateOAuthState,
  generatePkcePair,
  refreshAccessToken,
} from '../../src/auth/token-store'
import { GMAIL_AUTH, OUTLOOK_AUTH } from '../../src/config/types'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OAuth authorization primitives', () => {
  test('Gmail defaults to modify and settings.basic scopes', () => {
    const url = new URL(buildAuthUrl({
      provider: 'gmail',
      client_id: 'client',
      redirect_uri: 'http://127.0.0.1:1234/callback',
      state: 'state',
      code_challenge: 'challenge',
    }))
    const scope = url.searchParams.get('scope') || ''
    expect(scope).toContain('gmail.modify')
    expect(scope).toContain('gmail.settings.basic')
    expect(scope).not.toContain('https://mail.google.com/')
    expect(url.searchParams.get('state')).toBe('state')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  test('Gmail full access is explicit', () => {
    const url = new URL(buildAuthUrl({
      provider: 'gmail',
      client_id: 'client',
      redirect_uri: 'http://127.0.0.1/callback',
      fullAccess: true,
      state: 'state',
      code_challenge: 'challenge',
    }))
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      ...GMAIL_AUTH.fullAccessScopes,
    ])
  })

  test('Outlook URL uses the public-client scopes', () => {
    const url = new URL(buildAuthUrl({
      provider: 'outlook',
      client_id: 'client',
      redirect_uri: 'http://localhost:2345/callback',
      state: 'state',
      code_challenge: 'challenge',
    }))
    expect(url.searchParams.get('scope')).toContain('Mail.ReadWrite')
    expect(url.searchParams.get('scope')).toContain('offline_access')
    expect(url.searchParams.has('access_type')).toBe(false)
    expect(url.searchParams.get('prompt')).toBe('select_account')
  })

  test('provider configs own authorization params and client-secret policy', () => {
    expect(GMAIL_AUTH.extraAuthParams).toEqual({
      access_type: 'offline',
      prompt: 'consent',
    })
    expect(GMAIL_AUTH.allowsClientSecret).toBe(true)
    expect(OUTLOOK_AUTH.extraAuthParams).toEqual({ prompt: 'select_account' })
    expect(OUTLOOK_AUTH.allowsClientSecret).toBe(false)
  })

  test('generates unpredictable state and a valid S256 PKCE pair', () => {
    const first = generateOAuthState()
    const second = generateOAuthState()
    expect(first).not.toBe(second)
    expect(first.length).toBeGreaterThanOrEqual(43)

    const pkce = generatePkcePair()
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43)
    expect(pkce.verifier.length).toBeLessThanOrEqual(128)
    expect(pkce.challenge).toBe(
      createHash('sha256').update(pkce.verifier, 'ascii').digest('base64url'),
    )
  })
})

describe('provider-configured token requests', () => {
  test('Gmail code exchange includes a configured desktop client secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_in: 3600,
      token_type: 'Bearer',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await exchangeCodeForTokens({
      provider: 'gmail',
      code: 'code',
      client_id: 'client',
      client_secret: 'desktop-secret',
      redirect_uri: 'http://127.0.0.1/callback',
      code_verifier: 'verifier',
    })

    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body)
    expect(body.get('client_secret')).toBe('desktop-secret')
  })

  test('Outlook code exchange sends PKCE but never a client secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_in: 3600,
      token_type: 'Bearer',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await exchangeCodeForTokens({
      provider: 'outlook',
      code: 'code',
      client_id: 'client',
      client_secret: 'must-not-leak',
      redirect_uri: 'http://localhost/callback',
      code_verifier: 'verifier',
    })

    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body)
    expect(body.get('code_verifier')).toBe('verifier')
    expect(body.has('client_secret')).toBe(false)
  })

  test('Gmail refresh includes a configured desktop client secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'new',
      expires_in: 3600,
      token_type: 'Bearer',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await refreshAccessToken({
      provider: 'gmail',
      client_id: 'client',
      client_secret: 'desktop-secret',
      tokens: {
        access_token: 'old',
        refresh_token: 'gmail-refresh',
        expires_at: 0,
        token_type: 'Bearer',
      },
    })

    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body)
    expect(body.get('client_secret')).toBe('desktop-secret')
  })

  test('concurrent refreshes for one credential are single-flight', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)
    const config = {
      provider: 'outlook' as const,
      client_id: 'client',
      client_secret: 'must-not-leak',
      tokens: {
        access_token: 'old',
        refresh_token: 'refresh',
        expires_at: 0,
        token_type: 'Bearer',
      },
    }

    const first = refreshAccessToken(config)
    const second = refreshAccessToken(config)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFetch(new Response(JSON.stringify({
      access_token: 'new',
      expires_in: 3600,
      token_type: 'Bearer',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body)
    expect(body.has('client_secret')).toBe(false)
  })
})
