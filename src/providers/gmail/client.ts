// Gmail REST API client factory

import { HttpClient } from '../../utils/http.js'
import { refreshAccessToken } from '../../auth/token-store.js'
import type { AccountConfig, OAuthTokens } from '../../config/types.js'

const GMAIL_BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me'

export function createGmailClient(account: AccountConfig): HttpClient {
  let currentTokens = { ...account.tokens }

  return new HttpClient({
    baseUrl: GMAIL_BASE_URL,
    accountIdentity: {
      id: account.id,
      alias: account.alias,
      provider: account.provider,
      clientId: account.client_id,
    },
    isRetryableForbidden: isGmailQuotaError,
    getTokens: () => currentTokens,
    refreshTokens: async (): Promise<OAuthTokens> => {
      const newTokens = await refreshAccessToken({
        provider: 'gmail',
        client_id: account.client_id,
        client_secret: account.client_secret,
        tokens: currentTokens,
      })
      currentTokens = newTokens
      return newTokens
    },
  })
}

function isGmailQuotaError(body: unknown): boolean {
  const value = JSON.stringify(body ?? '').toLowerCase()
  return value.includes('ratelimitexceeded')
    || value.includes('userratelimitexceeded')
    || value.includes('quotaexceeded')
}
