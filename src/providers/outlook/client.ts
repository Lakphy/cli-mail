// Outlook (Microsoft Graph) REST API client factory

import { HttpClient } from '../../utils/http.js'
import { refreshAccessToken } from '../../auth/token-store.js'
import type { AccountConfig, OAuthTokens } from '../../config/types.js'

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0/me'

export function createOutlookClient(account: AccountConfig): HttpClient {
  let currentTokens = { ...account.tokens }

  return new HttpClient({
    baseUrl: GRAPH_BASE_URL,
    accountAlias: account.alias,
    // Outlook item IDs otherwise change when a message is moved. This header
    // must be present on every request that returns or consumes an item ID.
    defaultHeaders: {
      Prefer: 'IdType="ImmutableId"',
    },
    allowedUnauthenticatedHosts: ['outlook.office.com'],
    getTokens: () => currentTokens,
    refreshTokens: async (): Promise<OAuthTokens> => {
      const newTokens = await refreshAccessToken({
        provider: 'outlook',
        client_id: account.client_id,
        client_secret: account.client_secret,
        tokens: currentTokens,
      })
      currentTokens = newTokens
      return newTokens
    },
  })
}
