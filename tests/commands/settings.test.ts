import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  autoReplySet,
  mailTipsGet,
  settingsGet,
  settingsUpdate,
  vacationSet,
} from '../../src/commands/settings'
import * as resolveModule from '../../src/commands/resolve'
import * as formatter from '../../src/output/formatter'
import * as gmailSettings from '../../src/providers/gmail/settings'
import * as outlookSettings from '../../src/providers/outlook/settings'

vi.mock('../../src/commands/resolve', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/commands/resolve')>(),
  resolveAccount: vi.fn(),
}))
vi.mock('../../src/output/formatter', () => ({
  output: vi.fn(),
  outputList: vi.fn(),
  outputPartial: vi.fn(),
  outputSuccess: vi.fn(),
}))
vi.mock('../../src/providers/gmail/settings', () => ({
  getSettings: vi.fn(),
  setVacation: vi.fn(),
  updateSettings: vi.fn(),
}))
vi.mock('../../src/providers/outlook/settings', () => ({
  getMailTips: vi.fn(),
  setAutoReply: vi.fn(),
}))
vi.mock('../../src/utils/error', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/utils/error')>(),
  handleError: vi.fn((error: unknown) => { throw error }),
}))

describe('settings commands', () => {
  beforeEach(() => vi.clearAllMocks())

  test('maps Gmail section failures to the partial envelope', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'gmail' } as never,
      client: {} as never,
    })
    vi.mocked(gmailSettings.getSettings).mockResolvedValue({
      settings: { language: 'en' },
      errors: [{ section: 'imap', code: 'API_ERROR', message: 'unavailable', statusCode: 503 }],
    })

    await settingsGet({})

    expect(formatter.output).not.toHaveBeenCalled()
    expect(formatter.outputPartial).toHaveBeenCalledWith(
      { language: 'en' },
      [{
        code: 'API_ERROR',
        message: 'unavailable',
        item: { section: 'imap' },
        details: { statusCode: 503 },
      }],
    )
  })

  test('maps Gmail update failures to the partial envelope', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'gmail' } as never,
      client: {} as never,
    })
    vi.mocked(gmailSettings.updateSettings).mockResolvedValue({
      updated: ['imap'],
      errors: [{ section: 'language', code: 'API_ERROR', message: 'unavailable', statusCode: 503 }],
    })

    await settingsUpdate({ json: '{"imap":{"enabled":true},"language":{"displayLanguage":"en"}}' })

    expect(formatter.outputSuccess).not.toHaveBeenCalled()
    expect(formatter.outputPartial).toHaveBeenCalledWith(
      { updated: ['imap'] },
      [{
        code: 'API_ERROR',
        message: 'unavailable',
        item: { section: 'language' },
        details: { statusCode: 503 },
      }],
    )
  })

  test('passes neutral Date options to the Gmail vacation provider', async () => {
    const client = {} as never
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'gmail' } as never,
      client,
    })

    await vacationSet({
      enabled: true,
      message: 'Away',
      start: '2026-08-01T00:00:00Z',
      end: '2026-08-02T00:00:00Z',
    })

    expect(gmailSettings.setVacation).toHaveBeenCalledWith(client, {
      enabled: true,
      message: 'Away',
      start: new Date('2026-08-01T00:00:00Z'),
      end: new Date('2026-08-02T00:00:00Z'),
    })
  })

  test('keeps Gmail auto-reply JSON provider-native and validates it in the provider', async () => {
    const client = {} as never
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'gmail' } as never,
      client,
    })
    vi.mocked(gmailSettings.updateSettings).mockResolvedValue({
      updated: ['vacation'],
      errors: [],
    })

    await autoReplySet({
      json: '{"enableAutoReply":true,"responseBodyPlainText":"Away"}',
    })

    expect(gmailSettings.updateSettings).toHaveBeenCalledWith(client, {
      vacation: {
        enableAutoReply: true,
        responseBodyPlainText: 'Away',
      },
    })
  })

  test('passes Outlook auto-reply JSON to the validating provider boundary', async () => {
    const client = {} as never
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'outlook' } as never,
      client,
    })

    await autoReplySet({ json: '{"enabled":true,"internalMessage":"Away"}' })

    expect(outlookSettings.setAutoReply).toHaveBeenCalledWith(client, {
      enabled: true,
      internalMessage: 'Away',
    })
  })

  test('mailTipsGet rejects Gmail as an unsupported provider', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'gmail' } as never,
      client: {} as never,
    })

    await expect(mailTipsGet({ addresses: ['recipient@example.com'] })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      provider: 'gmail',
    })
    expect(outlookSettings.getMailTips).not.toHaveBeenCalled()
    expect(formatter.output).not.toHaveBeenCalled()
  })
})
