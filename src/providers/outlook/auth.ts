// Outlook (Microsoft Graph) OAuth2 authentication

import { startOAuthCallbackServer } from '../../auth/oauth-server.js'
import { exchangeCodeForTokens, buildAuthUrl } from '../../auth/token-store.js'
import type { OAuthTokens } from '../../config/types.js'

/**
 * Run the Outlook OAuth2 authorization flow via Microsoft Graph.
 */
export async function outlookAuthFlow(
  clientId: string,
  clientSecret: string,
): Promise<{ tokens: OAuthTokens; email: string }> {
  const { result } = await startOAuthCallbackServer()
  const redirectUri = 'http://localhost:4088/callback'

  const authUrl = buildAuthUrl({
    provider: 'outlook',
    client_id: clientId,
    redirect_uri: redirectUri,
  })

  process.stdout.write(`\nOpen the following URL in your browser to authorize:\n\n${authUrl}\n\nWaiting for authorization...\n`)

  const { code } = await result

  const tokens = await exchangeCodeForTokens({
    provider: 'outlook',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  })

  // Get user email from Microsoft Graph
  const profileResponse = await fetch(
    'https://graph.microsoft.com/v1.0/me',
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  )

  if (!profileResponse.ok) {
    throw new Error('Failed to get Microsoft profile')
  }

  const profile = (await profileResponse.json()) as {
    mail?: string
    userPrincipalName?: string
  }

  return { tokens, email: profile.mail || profile.userPrincipalName || '' }
}
