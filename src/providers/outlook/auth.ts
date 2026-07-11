// Microsoft Graph OAuth2 authentication for a public native client.

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
import { OUTLOOK_AUTH, type OAuthTokens } from '../../config/types.js'

export interface OutlookAuthFlowOptions {
  clientId: string
  timeoutMs?: number
  launchBrowser?: BrowserLauncher
  onAuthorizationUrl?: (url: string) => void
}

export async function outlookAuthFlow(
  options: OutlookAuthFlowOptions,
): Promise<{ tokens: OAuthTokens; email: string }> {
  if (!options.clientId) throw new Error('An Outlook public-client ID is required')

  const state = generateOAuthState()
  const pkce = generatePkcePair()
  const callback = await startOAuthCallbackServer({
    port: 0,
    host: 'localhost',
    path: '/',
    expectedState: state,
    timeoutMs: options.timeoutMs,
  })
  // Entra's public desktop platform registers the exact redirect
  // `http://localhost`; its native-app matching ignores the ephemeral port.
  const redirectUri = `http://localhost:${callback.port}`
  const authUrl = buildAuthUrl({
    provider: 'outlook',
    client_id: options.clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: pkce.challenge,
  })

  let code: string
  try {
    await openOrShowUrl(
      authUrl,
      options.launchBrowser ?? launchSystemBrowser,
      options.onAuthorizationUrl,
    )
    ;({ code } = await callback.result)
  } finally {
    callback.server.close()
  }
  const tokens = await exchangeCodeForTokens({
    provider: 'outlook',
    code,
    client_id: options.clientId,
    redirect_uri: redirectUri,
    code_verifier: pkce.verifier,
  })
  if (!tokens.scope) {
    // The v2 endpoint normally returns scope, but persisting the requested set
    // keeps capability derivation deterministic if it is omitted.
    tokens.scope = OUTLOOK_AUTH.scopes.join(' ')
  }

  const profileResponse = await fetch(
    'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,id',
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    },
  )
  if (!profileResponse.ok) throw new Error('Failed to get Microsoft profile')

  const profile = await profileResponse.json() as {
    mail?: string
    userPrincipalName?: string
  }
  const email = profile.mail || profile.userPrincipalName
  if (!email) throw new Error('Microsoft profile did not include an email address')
  return { tokens, email }
}
