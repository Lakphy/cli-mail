// Gmail OAuth2 authentication for installed/desktop public clients.

import { z } from 'zod'
import { readRegularFile } from '../../utils/files.js'
import { startOAuthCallbackServer } from '../../auth/oauth-server.js'
import {
  launchSystemBrowser,
  openOrShowUrl,
  type BrowserLauncher,
} from '../../auth/browser.js'
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  generateOAuthState,
  generatePkcePair,
} from '../../auth/token-store.js'
import { GMAIL_AUTH, type OAuthTokens } from '../../config/types.js'
import { errorMessage } from '../../utils/error.js'

export interface GmailDesktopCredentials {
  clientId: string
  clientSecret?: string
}

export interface GmailAuthFlowOptions {
  clientId?: string
  clientSecret?: string
  credentialsFile?: string
  fullAccess?: boolean
  timeoutMs?: number
  launchBrowser?: BrowserLauncher
  onAuthorizationUrl?: (url: string) => void
}

const credentialsFileSchema = z.object({
  installed: z.object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1).optional(),
    auth_uri: z.enum([
      GMAIL_AUTH.authUrl,
      'https://accounts.google.com/o/oauth2/auth',
    ]),
    token_uri: z.literal(GMAIL_AUTH.tokenUrl),
    redirect_uris: z.array(z.string()).min(1),
  }).passthrough(),
  web: z.never().optional(),
}).passthrough()

export function readGmailDesktopCredentials(path: string): GmailDesktopCredentials {
  let value: unknown
  try {
    value = JSON.parse(
      readRegularFile(path, 'Gmail OAuth credentials file', 1024 * 1024).toString('utf8'),
    ) as unknown
  } catch (error) {
    const reason = errorMessage(error)
    throw new Error(`Failed to read Gmail desktop OAuth credentials: ${reason}`)
  }

  const parsed = credentialsFileSchema.safeParse(value)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
    throw new Error(
      `Invalid Gmail credentials file. Export an OAuth Desktop app credential: ${details}`,
    )
  }

  const hasLoopbackRedirect = parsed.data.installed.redirect_uris.some((uri) => {
    try {
      const url = new URL(uri)
      return url.protocol === 'http:'
        && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    } catch {
      return false
    }
  })
  if (!hasLoopbackRedirect) {
    throw new Error('Invalid Gmail desktop credentials: no loopback redirect URI')
  }

  return {
    clientId: parsed.data.installed.client_id,
    ...(parsed.data.installed.client_secret
      ? { clientSecret: parsed.data.installed.client_secret }
      : {}),
  }
}

export async function gmailAuthFlow(
  options: GmailAuthFlowOptions,
): Promise<{ tokens: OAuthTokens; email: string }> {
  const resolvedOptions = options.credentialsFile
    ? { ...options, ...readGmailDesktopCredentials(options.credentialsFile) }
    : options
  if (!resolvedOptions.clientId) throw new Error('A Gmail desktop OAuth client ID is required')

  const state = generateOAuthState()
  const pkce = generatePkcePair()
  const callback = await startOAuthCallbackServer({
    port: 0,
    expectedState: state,
    timeoutMs: resolvedOptions.timeoutMs,
  })
  const redirectUri = `http://127.0.0.1:${callback.port}/callback`
  const authUrl = buildAuthUrl({
    provider: 'gmail',
    client_id: resolvedOptions.clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: pkce.challenge,
    fullAccess: resolvedOptions.fullAccess,
  })

  let code: string
  try {
    await openOrShowUrl(
      authUrl,
      resolvedOptions.launchBrowser ?? launchSystemBrowser,
      resolvedOptions.onAuthorizationUrl,
    )
    ;({ code } = await callback.result)
  } finally {
    // The callback normally closes itself when it settles. Closing here also
    // covers browser/onAuthorizationUrl failures before a callback arrives.
    callback.server.close()
  }
  const tokens = await exchangeCodeForTokens({
    provider: 'gmail',
    code,
    client_id: resolvedOptions.clientId,
    client_secret: resolvedOptions.clientSecret,
    redirect_uri: redirectUri,
    code_verifier: pkce.verifier,
  })
  if (!tokens.scope) {
    tokens.scope = (
      resolvedOptions.fullAccess ? GMAIL_AUTH.fullAccessScopes : GMAIL_AUTH.scopes
    ).join(' ')
  }

  const profileResponse = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    },
  )
  if (!profileResponse.ok) throw new Error('Failed to get Gmail profile')

  const profile = await profileResponse.json() as { emailAddress?: string }
  if (!profile.emailAddress) throw new Error('Gmail profile did not include an email address')
  return { tokens, email: profile.emailAddress }
}
