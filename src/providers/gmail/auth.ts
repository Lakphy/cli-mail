// Gmail OAuth2 authentication

import { startOAuthCallbackServer } from '../../auth/oauth-server.js'
import { exchangeCodeForTokens, buildAuthUrl } from '../../auth/token-store.js'
import type { OAuthTokens } from '../../config/types.js'

/**
 * Run the Gmail OAuth2 authorization flow.
 * Opens a browser for the user to authorize, receives the callback.
 */
export async function gmailAuthFlow(
  clientId: string,
  clientSecret: string,
): Promise<{ tokens: OAuthTokens; email: string }> {
  // Start callback server
  const { result } = await startOAuthCallbackServer()
  const redirectUri = 'http://localhost:4088/callback'

  // Build auth URL
  const authUrl = buildAuthUrl({
    provider: 'gmail',
    client_id: clientId,
    redirect_uri: redirectUri,
  })

  // Print URL for user to open
  process.stdout.write(`\nOpen the following URL in your browser to authorize:\n\n${authUrl}\n\nWaiting for authorization...\n`)

  // Wait for callback
  const { code } = await result

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens({
    provider: 'gmail',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  })

  // Get user email
  const profileResponse = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  )

  if (!profileResponse.ok) {
    throw new Error('Failed to get Gmail profile')
  }

  const profile = (await profileResponse.json()) as { emailAddress: string }

  return { tokens, email: profile.emailAddress }
}
