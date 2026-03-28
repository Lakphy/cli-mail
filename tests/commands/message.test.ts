import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest'
import { messageList, messageGet, messageTrash } from '../../src/commands/message'
import * as resolveModule from '../../src/commands/resolve'
import * as formatterModule from '../../src/output/formatter'
import * as gmailMessages from '../../src/providers/gmail/messages'
import * as outlookMessages from '../../src/providers/outlook/messages'

// Mock dependencies
vi.mock('../../src/commands/resolve', () => ({ resolveAccount: vi.fn() }))
vi.mock('../../src/output/formatter', () => ({
  output: vi.fn(),
  outputList: vi.fn(),
  outputSuccess: vi.fn(),
  outputRaw: vi.fn(),
  getGlobalFormat: vi.fn().mockReturnValue('markdown'),
}))
vi.mock('../../src/providers/gmail/messages', () => ({
  listMessages: vi.fn(),
  getMessage: vi.fn(),
  trashMessage: vi.fn(),
}))
vi.mock('../../src/providers/outlook/messages', () => ({
  listMessages: vi.fn(),
  getMessage: vi.fn(),
  moveMessage: vi.fn(),
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

  test('messageGet handles generic output', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'gmail' } as any, client: dummyClient })
    vi.mocked(gmailMessages.getMessage).mockResolvedValue({ id: 'msg-id', body: 'body content' } as any)

    await messageGet('msg-id', {})

    expect(gmailMessages.getMessage).toHaveBeenCalledWith(dummyClient, 'msg-id')
    expect(formatterModule.output).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-id' }))
  })

  test('messageTrash correctly branches to trash (Gmail) vs move (Outlook)', async () => {
    // 1. Test Gmail Branch
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'gmail' } as any, client: dummyClient })
    await messageTrash('msg-g', {})
    expect(gmailMessages.trashMessage).toHaveBeenCalledWith(dummyClient, 'msg-g')

    // 2. Test Outlook Branch
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'outlook' } as any, client: dummyClient })
    await messageTrash('msg-o', {})
    expect(outlookMessages.moveMessage).toHaveBeenCalledWith(dummyClient, 'msg-o', 'deleteditems')
    
    expect(formatterModule.outputSuccess).toHaveBeenCalledTimes(2)
  })
})
