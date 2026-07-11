import { describe, expect, test, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import { AuthError, RateLimitError } from '../../../src/utils/error'
import {
  getSendAs,
  getSendAsAliases,
  getSettings,
  setVacation,
  updateSettings,
} from '../../../src/providers/gmail/settings'

describe('Gmail settings provider', () => {
  test('aggregate read returns successful sections and structured per-section errors', async () => {
    const client = createMockHttpClient()
    ;(client.get as Mock).mockImplementation((path: string) => {
      switch (path) {
        case '/settings/vacation':
          return Promise.resolve({ enableAutoReply: true, responseBodyPlainText: 'Away' })
        case '/settings/autoForwarding':
          return Promise.reject(new RateLimitError(5_000))
        case '/settings/imap':
          return Promise.resolve({ enabled: true })
        case '/settings/pop':
          return Promise.resolve({ accessWindow: 'disabled' })
        case '/settings/language':
          return Promise.resolve({ displayLanguage: 'en' })
        default:
          return Promise.reject(new Error('unexpected path'))
      }
    })

    const result = await getSettings(client)
    expect(result.settings).toMatchObject({
      automaticReplies: { status: 'enabled', internalReplyMessage: 'Away' },
      language: 'en',
      imap: { enabled: true },
    })
    expect(result.settings.autoForwarding).toBeUndefined()
    expect(result.errors).toEqual([{
      section: 'autoForwarding',
      code: 'RATE_LIMIT_ERROR',
      message: 'Rate limit exceeded',
      statusCode: 429,
    }])
  })

  test('aggregate read rethrows authentication when every section fails', async () => {
    const client = createMockHttpClient()
    ;(client.get as Mock)
      .mockRejectedValueOnce(new Error('vacation failed'))
      .mockRejectedValueOnce(new AuthError('reauthenticate'))
      .mockRejectedValue(new Error('settings unavailable'))

    await expect(getSettings(client)).rejects.toBeInstanceOf(AuthError)
  })

  test('setVacation shapes neutral options into the Gmail wire format', async () => {
    const client = createMockHttpClient()
    ;(client.put as Mock).mockResolvedValue({ enableAutoReply: true })

    await setVacation(client, {
      enabled: true,
      message: 'Away',
      start: new Date('2026-08-01T00:00:00.000Z'),
      end: new Date('2026-08-02T00:00:00.000Z'),
    })

    expect(client.put).toHaveBeenCalledWith('/settings/vacation', {
      enableAutoReply: true,
      responseBodyPlainText: 'Away',
      startTime: '1785542400000',
      endTime: '1785628800000',
    })
  })

  test('setVacation rejects invalid or reversed neutral options before writing', async () => {
    const client = createMockHttpClient()
    await expect(setVacation(client, {
      enabled: true,
      start: new Date('2026-08-02T00:00:00Z'),
      end: new Date('2026-08-01T00:00:00Z'),
    })).rejects.toThrow('later than')
    await expect(setVacation(client, {
      enabled: true,
      start: new Date(Number.NaN),
    })).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
    expect(client.put).not.toHaveBeenCalled()
  })

  test.each([
    {},
    { vacation: undefined },
  ])('update rejects an empty supported update: %j', async (settings) => {
    const client = createMockHttpClient()
    await expect(updateSettings(client, settings)).rejects.toMatchObject({
      code: 'EMPTY_UPDATE',
    })
    expect(client.put).not.toHaveBeenCalled()
  })

  test('update strictly rejects unknown fields before making requests', async () => {
    const client = createMockHttpClient()
    await expect(updateSettings(client, {
      vacation: { enableAutoReply: true },
      typoField: {},
    })).rejects.toMatchObject({ code: 'INVALID_SETTINGS_FIELD' })
    expect(client.put).not.toHaveBeenCalled()
  })

  test('update rejects non-object section values', async () => {
    const client = createMockHttpClient()
    await expect(updateSettings(client, { language: 'en' }))
      .rejects.toMatchObject({ code: 'INVALID_SETTINGS_VALUE' })
    expect(client.put).not.toHaveBeenCalled()
  })

  test('update routes only supported fields', async () => {
    const client = createMockHttpClient()
    await expect(updateSettings(client, {
      imap: { enabled: true },
      language: { displayLanguage: 'en' },
    })).resolves.toEqual({ updated: ['imap', 'language'], errors: [] })
    expect(client.put).toHaveBeenNthCalledWith(1, '/settings/imap', { enabled: true })
    expect(client.put).toHaveBeenNthCalledWith(2, '/settings/language', {
      displayLanguage: 'en',
    })
  })

  test('update validates and preserves provider-native vacation settings', async () => {
    const client = createMockHttpClient()
    await expect(updateSettings(client, {
      vacation: {
        enableAutoReply: true,
        responseBodyPlainText: 'Away',
        startTime: '1785542400000',
      },
    })).resolves.toEqual({ updated: ['vacation'], errors: [] })
    expect(client.put).toHaveBeenCalledWith('/settings/vacation', {
      enableAutoReply: true,
      responseBodyPlainText: 'Away',
      startTime: '1785542400000',
    })
  })

  test('update rejects malformed provider-native sections before any write starts', async () => {
    const client = createMockHttpClient()
    await expect(updateSettings(client, {
      vacation: { enableAutoReply: 'yes', arbitraryWireField: true },
      language: { displayLanguage: 'en' },
    })).rejects.toMatchObject({ code: 'INVALID_SETTINGS_VALUE' })
    expect(client.put).not.toHaveBeenCalled()
  })

  test('update starts independent writes together and reports section failures', async () => {
    const client = createMockHttpClient()
    const resolvers = new Map<string, { resolve: (value?: unknown) => void; reject: (reason: unknown) => void }>()
    ;(client.put as Mock).mockImplementation((path: string) => new Promise((resolve, reject) => {
      resolvers.set(path, { resolve, reject })
    }))

    const update = updateSettings(client, {
      vacation: { enableAutoReply: true },
      imap: { enabled: true },
      pop: { accessWindow: 'disabled' },
      language: { displayLanguage: 'en' },
    })
    await Promise.resolve()
    expect([...resolvers.keys()]).toEqual([
      '/settings/vacation',
      '/settings/imap',
      '/settings/pop',
      '/settings/language',
    ])

    resolvers.get('/settings/vacation')?.resolve()
    resolvers.get('/settings/imap')?.resolve()
    resolvers.get('/settings/pop')?.reject(new RateLimitError(5_000))
    resolvers.get('/settings/language')?.resolve()
    await expect(update).resolves.toEqual({
      updated: ['vacation', 'imap', 'language'],
      errors: [{
        section: 'pop',
        code: 'RATE_LIMIT_ERROR',
        message: 'Rate limit exceeded',
        statusCode: 429,
      }],
    })
  })

  test('update preserves the most actionable error when every write fails', async () => {
    const client = createMockHttpClient()
    ;(client.put as Mock)
      .mockRejectedValueOnce(new Error('imap failed'))
      .mockRejectedValueOnce(new AuthError('reauthenticate'))

    await expect(updateSettings(client, {
      imap: { enabled: true },
      language: { displayLanguage: 'en' },
    })).rejects.toBeInstanceOf(AuthError)
  })

  test('removed admin write fails locally without an API request', async () => {
    const client = createMockHttpClient()
    await expect(updateSettings(client, { sharing: {} })).rejects.toMatchObject({
      code: 'COMMAND_REMOVED',
    })
    expect(client.get).not.toHaveBeenCalled()
    expect(client.put).not.toHaveBeenCalled()
    expect(client.post).not.toHaveBeenCalled()
    expect(client.delete).not.toHaveBeenCalled()
  })

  test('getSendAsAliases returns unique normalized identities', async () => {
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({
      sendAs: [
        { sendAsEmail: 'Primary@example.com', isPrimary: true },
        { sendAsEmail: ' alias@example.com ' },
        { sendAsEmail: 'ALIAS@example.com' },
        { sendAsEmail: '' },
      ],
    })

    await expect(getSendAsAliases(client)).resolves.toEqual([
      'Primary@example.com',
      'alias@example.com',
    ])
    expect(client.get).toHaveBeenCalledWith('/settings/sendAs')
  })

  test('encodes send-as identities used as REST path segments', async () => {
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({ sendAsEmail: 'value' })

    await getSendAs(client, '../alias%2Fid?x#y')
    expect(client.get).toHaveBeenCalledWith(
      '/settings/sendAs/..%2Falias%252Fid%3Fx%23y',
    )
  })
})
