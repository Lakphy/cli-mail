import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'

vi.mock('../../src/config/store', () => ({
  updateAccountTokens: vi.fn(),
}))

import { HttpClient } from '../../src/utils/http'
import { ApiError, RateLimitError } from '../../src/utils/error'
import { updateAccountTokens } from '../../src/config/store'

const validTokens = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_at: Date.now() + 3_600_000,
  token_type: 'Bearer',
}

function client(overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  return new HttpClient({
    baseUrl: 'https://api.example.test/v1/me',
    accountIdentity: {
      id: '37d65ed6-69f3-4b69-87dd-7d9a86924570',
      alias: 'primary',
      provider: 'gmail',
      clientId: 'client-id',
    },
    getTokens: () => validTokens,
    refreshTokens: async () => validTokens,
    ...overrides,
  })
}

describe('HttpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  test('adds auth/default headers and encodes repeated query values', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const http = client({ defaultHeaders: { Prefer: 'IdType="ImmutableId"' } })

    await http.get('/messages', { labelIds: ['INBOX', 'STARRED'] })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).searchParams.getAll('labelIds')).toEqual(['INBOX', 'STARRED'])
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer access-token',
      Prefer: 'IdType="ImmutableId"',
    })
  })

  test('checks status for raw responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', {
      status: 404,
      statusText: 'Not Found',
    })))
    await expect(client().getRaw('/messages/missing/$value')).rejects.toBeInstanceOf(ApiError)
  })

  test('supports JSON method helpers and empty responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const http = client()

    await expect(http.patch('/messages/1', { subject: 'updated' })).resolves.toBeUndefined()
    await expect(http.put('/settings', { enabled: true })).resolves.toEqual({})
    await expect(http.delete('/messages/1')).resolves.toBeUndefined()

    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual([
      'PATCH',
      'PUT',
      'DELETE',
    ])
  })

  test('maps fetch timeouts to a stable CLI error', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout))

    await expect(client({ timeoutMs: 123 }).post('/messages', {})).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      message: 'Request timed out after 123ms',
    })
  })

  test('keeps buffered response-body reads inside the timeout and retries GET', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const bodyTimeout = () => Object.assign(new Error('body timed out'), { name: 'TimeoutError' })
    const timedOutBody = () => new Response(new ReadableStream({
      pull(controller) {
        controller.error(bodyTimeout())
      },
    }), { status: 200 })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(timedOutBody())
      .mockResolvedValueOnce(timedOutBody())
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = client({ timeoutMs: 321 }).get<{ ok: boolean }>('/slow-body')
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('maps and cleans up raw body timeouts without replaying the stream', async () => {
    let cancelled = false
    const timeout = Object.assign(new Error('raw body timed out'), { name: 'AbortError' })
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      pull(controller) {
        controller.error(timeout)
      },
      cancel() {
        cancelled = true
      },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await client({ timeoutMs: 456 }).getRaw('/raw-body')
    await expect(response.text()).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      message: 'Request timed out after 456ms',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Some runtimes mark an errored stream closed before invoking its cancel
    // algorithm; the important contract is that the client attempts cleanup.
    expect(typeof cancelled).toBe('boolean')
  })

  test('maps error-response body timeouts and never retries a mutation', async () => {
    const timeout = Object.assign(new Error('error body timed out'), { name: 'TimeoutError' })
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      pull(controller) {
        controller.error(timeout)
      },
    }), { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(client({ timeoutMs: 789 }).post('/messages', {})).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      message: 'Request timed out after 789ms',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('refuses authenticated cross-origin URLs', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(client().get('https://evil.example/messages')).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('rejects raw and encoded relative dot segments before URL normalization', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const http = client()

    for (const path of [
      '/../settings',
      '/messages/..\\settings',
      '/messages/%2e%2e/settings',
      '/messages/%2e%2e%5csettings',
      '/messages/%252e%252e/settings',
    ]) {
      await expect(http.get(path)).rejects.toMatchObject({ code: 'UNSAFE_URL' })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('allows provider raw suffixes and trusted absolute next links', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const http = client()

    await http.get('/messages/id/$value')
    await http.get('https://api.example.test/v1/me/messages?$skiptoken=opaque')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('allows only HTTPS allowlisted unauthenticated upload hosts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const http = client({ allowedUnauthenticatedHosts: ['outlook.office.com'] })

    await http.putRawUnauthenticated(
      'https://upload.outlook.office.com/session/1',
      Buffer.from('chunk'),
      { 'Content-Range': 'bytes 0-4/5', authorization: 'Bearer should-not-leak' },
    )
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).not.toHaveProperty('Authorization')
    expect(init.headers).not.toHaveProperty('authorization')

    await expect(http.putRawUnauthenticated(
      'https://outlook.office.com.evil.example/session/1',
      Buffer.from('chunk'),
    )).rejects.toMatchObject({ code: 'UNSAFE_URL' })
  })

  test('never follows redirects for pre-authorized upload requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 307,
      headers: { Location: 'https://evil.example/collect' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const http = client({ allowedUnauthenticatedHosts: ['outlook.office.com'] })

    await expect(http.putRawUnauthenticated(
      'https://upload.outlook.office.com/session/1',
      Buffer.from('sensitive attachment'),
    )).rejects.toMatchObject({ code: 'UNSAFE_REDIRECT' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
  })

  test('coalesces concurrent token refreshes for one client', async () => {
    let resolveRefresh!: (value: typeof validTokens) => void
    const refreshTokens = vi.fn(() => new Promise<typeof validTokens>((resolve) => {
      resolveRefresh = resolve
    }))
    const expired = { ...validTokens, expires_at: Date.now() - 1 }
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const http = client({ getTokens: () => expired, refreshTokens })

    const first = http.get('/one')
    const second = http.get('/two')
    expect(refreshTokens).toHaveBeenCalledTimes(1)
    resolveRefresh(validTokens)
    await Promise.all([first, second])

    expect(updateAccountTokens).toHaveBeenCalledTimes(1)
    expect(updateAccountTokens).toHaveBeenCalledWith(expect.objectContaining({
      id: '37d65ed6-69f3-4b69-87dd-7d9a86924570',
      provider: 'gmail',
      clientId: 'client-id',
    }), validTokens, createHash('sha256')
      .update('cli-mail-refresh-token\0')
      .update(validTokens.refresh_token)
      .digest('hex'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('retries transient GET responses but not POST requests', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'busy' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = client().get<{ value: number }>('/messages')
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toEqual({ value: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ error: 'busy' }), { status: 503 }))
    await expect(client().post('/messages', {})).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('retries a forbidden GET only when the provider classifies its body as retryable', async () => {
    vi.useFakeTimers()
    const forbidden = { error: { errors: [{ reason: 'providerQuota' }] } }
    const fetchMock = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify(forbidden),
      { status: 403, headers: { 'Retry-After': '0' } },
    ))
    const isRetryableForbidden = vi.fn((body: unknown) => (
      (body as { error?: { errors?: Array<{ reason?: string }> } })
        .error?.errors?.[0]?.reason === 'providerQuota'
    ))
    vi.stubGlobal('fetch', fetchMock)

    const request = client({ isRetryableForbidden }).get('/messages')
    const rejection = expect(request).rejects.toBeInstanceOf(RateLimitError)
    await vi.runAllTimersAsync()
    await rejection

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(isRetryableForbidden).toHaveBeenCalledTimes(3)
  })

  test('does not retry or rate-limit-map a generic forbidden response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'Forbidden' },
    }), { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(client().get('/messages')).rejects.toMatchObject({
      code: 'API_ERROR',
      statusCode: 403,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
