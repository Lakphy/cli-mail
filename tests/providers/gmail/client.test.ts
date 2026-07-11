import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AccountConfig } from '../../../src/config/types'
import { createGmailClient } from '../../../src/providers/gmail/client'
import { RateLimitError } from '../../../src/utils/error'

describe('Gmail client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  test('classifies Gmail quota 403 responses as retryable rate limits', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
        error: {
          errors: [{ reason: 'userRateLimitExceeded' }],
          message: 'User rate limit exceeded',
        },
      }), {
        status: 403,
        headers: { 'Retry-After': '0' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const account: AccountConfig = {
      id: 'account-id',
      status: 'active',
      alias: 'gmail',
      provider: 'gmail',
      email: 'me@example.com',
      client_id: 'client-id',
      client_secret: 'client-secret',
      tokens: {
        access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer',
        expires_at: Date.now() + 60 * 60 * 1000,
      },
      scopes: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }

    const request = createGmailClient(account).get('/messages')
    const rejection = expect(request).rejects.toBeInstanceOf(RateLimitError)
    await vi.runAllTimersAsync()
    await rejection

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
