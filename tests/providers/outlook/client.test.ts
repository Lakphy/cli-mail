import { afterEach, describe, expect, test, vi } from 'vitest'
import { createOutlookClient } from '../../../src/providers/outlook/client'
import type { AccountConfig } from '../../../src/config/types'
import { ApiError } from '../../../src/utils/error'

describe('Outlook client', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('applies ImmutableId preference to Graph requests and permits only Outlook upload URLs', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', fetchMock)
    const account: AccountConfig = {
      id: 'account-id',
      status: 'active',
      alias: 'outlook',
      provider: 'outlook',
      email: 'me@example.com',
      client_id: 'public-client-id',
      tokens: {
        access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer',
        expires_at: Date.now() + 60 * 60 * 1000,
      },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const client = createOutlookClient(account)

    await client.get('/messages')
    const graphHeaders = fetchMock.mock.calls[0][1].headers
    expect(graphHeaders.Prefer).toBe('IdType="ImmutableId"')
    expect(graphHeaders.Authorization).toBe('Bearer access')

    await client.putRawUnauthenticated(
      'https://outlook.office.com/upload?authtoken=opaque',
      Buffer.from('part'),
      { 'Content-Range': 'bytes 0-3/4' },
    )
    const uploadHeaders = fetchMock.mock.calls[1][1].headers
    expect(uploadHeaders.Authorization).toBeUndefined()

    await expect(client.putRawUnauthenticated(
      'https://evil.example/upload?authtoken=opaque',
      Buffer.from('part'),
    )).rejects.toMatchObject({ code: 'UNSAFE_URL' })
  })

  test('does not retry a generic Graph 403 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'ErrorAccessDenied', message: 'Forbidden' },
    }), { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    const account: AccountConfig = {
      id: 'account-id',
      status: 'active',
      alias: 'outlook',
      provider: 'outlook',
      email: 'me@example.com',
      client_id: 'public-client-id',
      tokens: {
        access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer',
        expires_at: Date.now() + 60 * 60 * 1000,
      },
      scopes: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }

    await expect(createOutlookClient(account).get('/messages')).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
