import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest'
import {
  messageAll,
  messageGet,
  messageList,
  messageMove,
  messageRecent,
  messageReply,
  messageTrash,
} from '../../src/commands/message'
import * as resolveModule from '../../src/commands/resolve'
import * as formatterModule from '../../src/output/formatter'
import * as gmailMessages from '../../src/providers/gmail/messages'
import * as outlookMessages from '../../src/providers/outlook/messages'
import * as gmailSettings from '../../src/providers/gmail/settings'
import * as configStore from '../../src/config/store'
import * as commandResolve from '../../src/commands/resolve'

// Mock dependencies
vi.mock('../../src/commands/resolve', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/commands/resolve')>(),
  resolveAccount: vi.fn(),
  createClientForAccount: vi.fn(),
}))
vi.mock('../../src/output/formatter', () => ({
  output: vi.fn(),
  outputList: vi.fn(),
  outputPartial: vi.fn(),
  outputSuccess: vi.fn(),
  outputRaw: vi.fn(),
}))
vi.mock('../../src/utils/error', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/error')>()
  return {
    ...actual,
    handleError: vi.fn((error: unknown) => { throw error }),
  }
})
vi.mock('../../src/providers/gmail/messages', () => ({
  listMessages: vi.fn(),
  listMessagesSince: vi.fn(),
  getMessage: vi.fn(),
  moveMessage: vi.fn(),
  trashMessage: vi.fn(),
  replyToMessage: vi.fn(),
}))
vi.mock('../../src/providers/outlook/messages', () => ({
  listMessages: vi.fn(),
  listMessagesSince: vi.fn(),
  getMessage: vi.fn(),
  moveMessage: vi.fn(),
  trashMessage: vi.fn(),
  untrashMessage: vi.fn(),
}))
vi.mock('../../src/providers/gmail/settings', () => ({ getSendAsAliases: vi.fn() }))
vi.mock('../../src/config/store', () => ({
  loadConfig: vi.fn(),
  getAccountsByTag: vi.fn(),
}))

describe('Message Command Handlers', () => {
  const dummyClient = {} as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('messageList routing to Gmail', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'gmail' } as any, client: dummyClient })
    vi.mocked(gmailMessages.listMessages).mockResolvedValue({
      messages: [{ id: 'm1', subject: 'hi', from: { address: 'a@c.com' }, date: 'd', isRead: true, hasAttachments: false } as any],
      nextPageToken: 'next',
    })

    await messageList({ folder: 'inbox', account: 'test' })

    expect(resolveModule.resolveAccount).toHaveBeenCalledWith('test')
    expect(gmailMessages.listMessages).toHaveBeenCalledWith(dummyClient, expect.objectContaining({ folder: 'inbox' }))
    expect(outlookMessages.listMessages).not.toHaveBeenCalled()
    expect(formatterModule.outputList).toHaveBeenCalled()
  })

  test('messageList routing to Outlook', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'outlook' } as any, client: dummyClient })
    vi.mocked(outlookMessages.listMessages).mockResolvedValue({
      messages: [{ id: 'o1', subject: 'hi', from: { address: 'o@c.com' }, date: 'd', isRead: false, hasAttachments: false } as any],
    })

    await messageList({ top: '10', skip: '5' })

    expect(outlookMessages.listMessages).toHaveBeenCalledWith(dummyClient, { top: 10, skip: 5, folder: undefined })
    expect(formatterModule.outputList).toHaveBeenCalled()
  })

  test('messageList distinguishes partial from complete page failure', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { id: 'gmail-1', provider: 'gmail' } as any,
      client: dummyClient,
    })
    vi.mocked(gmailMessages.listMessages).mockResolvedValueOnce({
      messages: [{
        id: 'ok', subject: 'ok', from: { address: 'a@example.com' },
        date: 'd', isRead: true, hasAttachments: false,
      } as any],
      errors: [{ id: 'bad', message: 'failed' }],
    })
    await messageList({})
    expect(formatterModule.outputPartial).toHaveBeenCalled()

    vi.mocked(gmailMessages.listMessages).mockResolvedValueOnce({
      messages: [],
      errors: [{ id: 'bad', message: 'failed' }],
    })
    await expect(messageList({})).rejects.toMatchObject({ code: 'MESSAGE_PAGE_FAILED' })
  })

  test('messageGet handles generic output', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'gmail' } as any, client: dummyClient })
    vi.mocked(gmailMessages.getMessage).mockResolvedValue({ id: 'msg-id', body: 'body content' } as any)

    await messageGet('msg-id', {})

    expect(gmailMessages.getMessage).toHaveBeenCalledWith(dummyClient, 'msg-id')
    expect(formatterModule.output).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-id' }))
  })

  test('messageTrash routes to provider semantics', async () => {
    // 1. Test Gmail Branch
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'gmail' } as any, client: dummyClient })
    await messageTrash('msg-g', {})
    expect(gmailMessages.trashMessage).toHaveBeenCalledWith(dummyClient, 'msg-g')

    // 2. Test Outlook Branch
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'outlook' } as any, client: dummyClient })
    await messageTrash('msg-o', {})
    expect(outlookMessages.trashMessage).toHaveBeenCalledWith(dummyClient, 'msg-o')
    
    expect(formatterModule.outputSuccess).toHaveBeenCalledTimes(2)
  })

  test('messageMove reports Gmail and Outlook message IDs through one output path', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValueOnce({
      account: { provider: 'gmail' } as any,
      client: dummyClient,
    })
    await messageMove('gmail-id', { toFolder: 'STARRED' })
    expect(gmailMessages.moveMessage).toHaveBeenCalledWith(
      dummyClient,
      'gmail-id',
      'STARRED',
    )
    expect(formatterModule.outputSuccess).toHaveBeenLastCalledWith(
      'Message moved to: STARRED',
      { id: 'gmail-id', folderId: 'STARRED' },
    )

    vi.mocked(resolveModule.resolveAccount).mockReturnValueOnce({
      account: { provider: 'outlook' } as any,
      client: dummyClient,
    })
    vi.mocked(outlookMessages.moveMessage).mockResolvedValue({ id: 'outlook-new-id' })
    await messageMove('outlook-old-id', { toFolder: 'archive' })
    expect(formatterModule.outputSuccess).toHaveBeenLastCalledWith(
      'Message moved to: archive',
      { id: 'outlook-new-id', folderId: 'archive' },
    )
  })

  test('messageReply starts Gmail identity and message fetches together', async () => {
    let resolveAliases!: (aliases: string[]) => void
    let resolveMessage!: (message: any) => void
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'gmail', email: 'me@example.com' } as any,
      client: dummyClient,
    })
    vi.mocked(gmailSettings.getSendAsAliases).mockReturnValue(new Promise((resolve) => {
      resolveAliases = resolve
    }))
    vi.mocked(gmailMessages.getMessage).mockReturnValue(new Promise((resolve) => {
      resolveMessage = resolve
    }))
    vi.mocked(gmailMessages.replyToMessage).mockResolvedValue({ id: 'reply', threadId: 'thread' })

    const operation = messageReply('original', { body: 'hello' })
    expect(gmailSettings.getSendAsAliases).toHaveBeenCalledWith(dummyClient)
    expect(gmailMessages.getMessage).toHaveBeenCalledWith(dummyClient, 'original')

    const original = { id: 'original', threadId: 'thread' } as any
    resolveAliases(['alias@example.com'])
    resolveMessage(original)
    await operation
    expect(gmailMessages.replyToMessage).toHaveBeenCalledWith(
      dummyClient,
      'original',
      'hello',
      undefined,
      { email: 'me@example.com', aliases: ['alias@example.com'] },
      original,
    )
  })

  test('messageAll reuses its loaded config for tag filtering', async () => {
    const account = {
      id: 'gmail-1',
      alias: 'work',
      email: 'work@example.com',
      provider: 'gmail',
      status: 'active',
    } as any
    const config = { defaultAccountId: 'gmail-1', accounts: [account] } as any
    vi.mocked(configStore.loadConfig).mockReturnValue(config)
    vi.mocked(configStore.getAccountsByTag).mockReturnValue([account])
    vi.mocked(commandResolve.createClientForAccount).mockReturnValue(dummyClient)
    vi.mocked(gmailMessages.listMessagesSince).mockResolvedValue({ messages: [] })

    await messageAll({ tag: 'work' })
    expect(configStore.loadConfig).toHaveBeenCalledTimes(1)
    expect(configStore.getAccountsByTag).toHaveBeenCalledWith('work', config)
  })

  test('messageRecent delegates date-query syntax to the provider', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { id: 'gmail-1', provider: 'gmail' } as any,
      client: dummyClient,
    })
    vi.mocked(gmailMessages.listMessagesSince).mockResolvedValue({ messages: [] })

    await messageRecent({ since: '2026-07-11T00:00:00.000Z', top: '7' })

    expect(gmailMessages.listMessagesSince).toHaveBeenCalledWith(
      dummyClient,
      new Date('2026-07-11T00:00:00.000Z'),
      7,
      undefined,
    )
  })
})
