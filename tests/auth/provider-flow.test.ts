import { createHash } from 'node:crypto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { gmailAuthFlow } from '../../src/providers/gmail/auth'
import { outlookAuthFlow } from '../../src/providers/outlook/auth'

const realFetch = globalThis.fetch

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('provider OAuth flow', () => {
  test.each(['gmail', 'outlook'] as const)(
    '%s closes its callback listener when URL notification fails',
    async (provider) => {
      let redirectUri = ''
      const onAuthorizationUrl = (authorizationUrl: string) => {
        redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri') || ''
        throw new Error('notification failed')
      }
      const run = provider === 'gmail'
        ? gmailAuthFlow({
            clientId: 'desktop-id',
            timeoutMs: 60_000,
            onAuthorizationUrl,
            launchBrowser: async () => undefined,
          })
        : outlookAuthFlow({
            clientId: 'public-desktop-id',
            timeoutMs: 60_000,
            onAuthorizationUrl,
            launchBrowser: async () => undefined,
          })

      await expect(run).rejects.toThrow('notification failed')
      expect(redirectUri).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):\d+/)
      await new Promise<void>((resolve) => setImmediate(resolve))
      await expect(realFetch(redirectUri, { signal: AbortSignal.timeout(500) })).rejects.toThrow()
    },
  )

  test('Gmail binds state to the callback and exchanges an S256 verifier', async () => {
    let authorizationUrl = ''
    let tokenBody = ''
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL ? input.href : input.url
      if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init)
      if (url === 'https://oauth2.googleapis.com/token') {
        tokenBody = String(init?.body ?? '')
        return new Response(JSON.stringify({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') {
        return new Response(JSON.stringify({ emailAddress: 'person@example.com' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gmailAuthFlow({
      clientId: 'desktop-id',
      clientSecret: 'desktop-value',
      onAuthorizationUrl: (url) => { authorizationUrl = url },
      launchBrowser: async (url) => {
        const authorization = new URL(url)
        const redirect = authorization.searchParams.get('redirect_uri')
        const state = authorization.searchParams.get('state')
        expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
        await realFetch(`${redirect}?code=code&state=${encodeURIComponent(state || '')}`)
      },
    })

    expect(result.email).toBe('person@example.com')
    const authorization = new URL(authorizationUrl)
    const body = new URLSearchParams(tokenBody)
    const verifier = body.get('code_verifier') || ''
    expect(authorization.searchParams.get('state')).toBeTruthy()
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(verifier, 'ascii').digest('base64url'),
    )
    expect(body.get('client_secret')).toBe('desktop-value')
    expect(result.tokens.scope).toContain('gmail.modify')
  })

  test('Outlook uses the public desktop localhost root redirect with state and PKCE', async () => {
    let authorizationUrl = ''
    let tokenBody = ''
    let rejectedStateStatus = 0
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL ? input.href : input.url
      if (url.startsWith('http://localhost:')) return realFetch(input, init)
      if (url === 'https://login.microsoftonline.com/common/oauth2/v2.0/token') {
        tokenBody = String(init?.body ?? '')
        return new Response(JSON.stringify({
          access_token: 'outlook-access',
          refresh_token: 'outlook-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,id') {
        return new Response(JSON.stringify({ mail: 'outlook@example.com', id: 'graph-user' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await outlookAuthFlow({
      clientId: 'public-desktop-id',
      onAuthorizationUrl: (url) => { authorizationUrl = url },
      launchBrowser: async (url) => {
        const authorization = new URL(url)
        const redirect = authorization.searchParams.get('redirect_uri') || ''
        const state = authorization.searchParams.get('state') || ''
        expect(redirect).toMatch(/^http:\/\/localhost:\d+$/)
        expect(new URL(redirect).pathname).toBe('/')

        const rejected = await realFetch(
          `${redirect}/?code=attacker&state=wrong-state`,
        )
        rejectedStateStatus = rejected.status
        await realFetch(
          `${redirect}/?code=outlook-code&state=${encodeURIComponent(state)}`,
        )
      },
    })

    expect(rejectedStateStatus).toBe(400)
    expect(result.email).toBe('outlook@example.com')
    const authorization = new URL(authorizationUrl)
    const body = new URLSearchParams(tokenBody)
    const verifier = body.get('code_verifier') || ''
    expect(authorization.searchParams.get('state')).toBeTruthy()
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(verifier, 'ascii').digest('base64url'),
    )
    expect(body.get('redirect_uri')).toBe(authorization.searchParams.get('redirect_uri'))
    expect(body.get('client_secret')).toBeNull()
    expect(result.tokens.scope).toContain('Mail.ReadWrite')
  })
})
