import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  focusedInboxAdd,
  focusedInboxDelete,
  focusedInboxList,
  forwardingGet,
  mailTipsGet,
  settingsGet,
  settingsUpdate,
  vacationGet,
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
  updateSettings: vi.fn(),
  getVacation: vi.fn(),
  setVacation: vi.fn(),
  getAutoForwarding: vi.fn(),
}))
vi.mock('../../src/providers/outlook/settings', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getAutoReply: vi.fn(),
  setAutoReply: vi.fn(),
  getMailTips: vi.fn(),
  listFocusedInboxOverrides: vi.fn(),
  createFocusedInboxOverride: vi.fn(),
  deleteFocusedInboxOverride: vi.fn(),
}))
vi.mock('../../src/utils/error', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/utils/error')>(),
  handleError: vi.fn((error: unknown) => { throw error }),
}))

describe('settings command branches', () => {
  const client = {} as never

  beforeEach(() => vi.clearAllMocks())

  function useProvider(provider: 'gmail' | 'outlook'): void {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { id: `${provider}-1`, provider } as never,
      client,
    })
  }

  test('settingsGet outputs complete Gmail settings directly', async () => {
    useProvider('gmail')
    vi.mocked(gmailSettings.getSettings).mockResolvedValue({
      settings: { language: { displayLanguage: 'en' } },
      errors: [],
    })

    await settingsGet({ account: 'work' })

    expect(resolveModule.resolveAccount).toHaveBeenCalledWith('work')
    expect(formatter.output).toHaveBeenCalledWith({ language: { displayLanguage: 'en' } })
    expect(formatter.outputPartial).not.toHaveBeenCalled()
  })

  test('settingsGet routes Outlook to the provider-native result', async () => {
    useProvider('outlook')
    const settings = { timeZone: 'China Standard Time', dateFormat: 'yyyy-MM-dd' }
    vi.mocked(outlookSettings.getSettings).mockResolvedValue(settings as never)

    await settingsGet({})

    expect(outlookSettings.getSettings).toHaveBeenCalledWith(client)
    expect(formatter.output).toHaveBeenCalledWith(settings)
  })

  test('settingsUpdate reports complete Gmail success', async () => {
    useProvider('gmail')
    vi.mocked(gmailSettings.updateSettings).mockResolvedValue({
      updated: ['language'],
      errors: [],
    })

    await settingsUpdate({ json: '{"language":{"displayLanguage":"fr"}}' })

    expect(gmailSettings.updateSettings).toHaveBeenCalledWith(client, {
      language: { displayLanguage: 'fr' },
    })
    expect(formatter.outputSuccess).toHaveBeenCalledWith('Settings updated')
  })

  test('settingsUpdate outputs Outlook provider data', async () => {
    useProvider('outlook')
    vi.mocked(outlookSettings.updateSettings).mockResolvedValue({ timeZone: 'UTC' } as never)

    await settingsUpdate({ json: '{"timeZone":"UTC"}' })

    expect(outlookSettings.updateSettings).toHaveBeenCalledWith(client, { timeZone: 'UTC' })
    expect(formatter.output).toHaveBeenCalledWith({ timeZone: 'UTC' })
  })

  test.each([
    ['gmail', { enabled: true, responseSubject: 'Away' }],
    ['outlook', { enabled: true, externalAudience: 'contactsOnly' }],
  ] as const)('vacationGet routes %s settings', async (provider, result) => {
    useProvider(provider)
    if (provider === 'gmail') {
      vi.mocked(gmailSettings.getVacation).mockResolvedValue(result as never)
    } else {
      vi.mocked(outlookSettings.getAutoReply).mockResolvedValue(result as never)
    }

    await vacationGet({})

    expect(formatter.output).toHaveBeenCalledWith(result)
  })

  test('vacationSet preserves Outlook external audience and schedule values', async () => {
    useProvider('outlook')

    await vacationSet({
      enabled: true,
      message: 'Away',
      externalAudience: 'contactsOnly',
      start: '2026-08-01T08:00:00Z',
      end: '2026-08-02T08:00:00Z',
    })

    expect(outlookSettings.setAutoReply).toHaveBeenCalledWith(client, {
      enabled: true,
      internalMessage: 'Away',
      externalMessage: 'Away',
      externalAudience: 'contactsOnly',
      startDateTime: '2026-08-01T08:00:00Z',
      endDateTime: '2026-08-02T08:00:00Z',
    })
    expect(formatter.outputSuccess).toHaveBeenCalledWith('Vacation/Auto-reply settings updated')
  })

  test('vacationSet omits optional Gmail dates and rejects Outlook-only audience', async () => {
    useProvider('gmail')

    await vacationSet({ enabled: false })
    expect(gmailSettings.setVacation).toHaveBeenCalledWith(client, {
      enabled: false,
      message: undefined,
      start: undefined,
      end: undefined,
    })

    await expect(vacationSet({
      enabled: true,
      externalAudience: 'all',
    })).rejects.toThrow(/only supported for Outlook/)
  })

  test.each([
    [{ enabled: true, start: 'not-a-date' }, '--start must be a valid ISO 8601 date'],
    [{ enabled: true, end: 'not-a-date' }, '--end must be a valid ISO 8601 date'],
    [{ enabled: true, start: '2026-08-02T00:00:00Z', end: '2026-08-01T00:00:00Z' }, '--end must be later'],
    [{ enabled: true, start: '2026-08-01T00:00:00Z', end: '2026-08-01T00:00:00Z' }, '--end must be later'],
  ] as const)('vacationSet rejects invalid scheduling: %s', async (options, message) => {
    useProvider('gmail')
    await expect(vacationSet(options)).rejects.toThrow(message)
    expect(gmailSettings.setVacation).not.toHaveBeenCalled()
  })

  test('forwardingGet routes both providers', async () => {
    useProvider('gmail')
    vi.mocked(gmailSettings.getAutoForwarding).mockResolvedValue({ enabled: true } as never)
    await forwardingGet({})
    expect(formatter.output).toHaveBeenCalledWith({ enabled: true })

    useProvider('outlook')
    vi.mocked(outlookSettings.getSettings).mockResolvedValue({ timeZone: 'UTC' } as never)
    await forwardingGet({})
    expect(formatter.output).toHaveBeenLastCalledWith({
      message: 'Outlook forwarding is managed via rules',
      settings: { timeZone: 'UTC' },
    })
  })

  test('mailTipsGet returns Outlook tips', async () => {
    useProvider('outlook')
    const tips = [{ emailAddress: { address: 'person@example.test' }, isModerated: false }]
    vi.mocked(outlookSettings.getMailTips).mockResolvedValue(tips as never)

    await mailTipsGet({ addresses: ['person@example.test'] })

    expect(outlookSettings.getMailTips).toHaveBeenCalledWith(client, ['person@example.test'])
    expect(formatter.output).toHaveBeenCalledWith(tips)
  })

  test('focusedInboxList maps Outlook overrides', async () => {
    useProvider('outlook')
    vi.mocked(outlookSettings.listFocusedInboxOverrides).mockResolvedValue([{
      id: 'override-1',
      senderEmailAddress: { address: 'sender@example.test' },
      classifyAs: 'focused',
    }] as never)

    await focusedInboxList({})

    expect(formatter.outputList).toHaveBeenCalledWith(
      [{ id: 'override-1', email: 'sender@example.test', classify: 'focused' }],
      expect.any(Array),
    )
  })

  test.each([
    ['focused', 'focused'],
    ['anything-else', 'other'],
  ])('focusedInboxAdd normalizes %s to %s', async (requested, normalized) => {
    useProvider('outlook')
    vi.mocked(outlookSettings.createFocusedInboxOverride).mockResolvedValue({
      id: 'override-1',
      senderEmailAddress: { address: 'sender@example.test' },
      classifyAs: normalized,
    } as never)

    await focusedInboxAdd({ email: 'sender@example.test', classify: requested })

    expect(outlookSettings.createFocusedInboxOverride).toHaveBeenCalledWith(
      client,
      'sender@example.test',
      normalized,
    )
    expect(formatter.outputSuccess).toHaveBeenCalledWith(
      `Focused Inbox override created: sender@example.test → ${normalized} (id: override-1)`,
    )
  })

  test('focusedInboxDelete removes an Outlook override', async () => {
    useProvider('outlook')

    await focusedInboxDelete('override-1', {})

    expect(outlookSettings.deleteFocusedInboxOverride).toHaveBeenCalledWith(client, 'override-1')
    expect(formatter.outputSuccess).toHaveBeenCalledWith(
      'Focused Inbox override deleted: override-1',
    )
  })

  test.each([focusedInboxList, focusedInboxDelete])(
    'focused Inbox operation rejects Gmail',
    async (handler) => {
      useProvider('gmail')
      if (handler === focusedInboxDelete) {
        await expect(handler('override-1', {})).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
      } else {
        await expect(handler({})).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
      }
    },
  )
})
