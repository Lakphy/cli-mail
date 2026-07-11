import { describe, test, expect, beforeEach, vi } from 'vitest'
import { folderCreate, folderList, folderGet, folderMessages, folderMove, folderCopy } from '../../src/commands/folder'
import * as resolveModule from '../../src/commands/resolve'
import * as formatterModule from '../../src/output/formatter'
import * as gmailLabels from '../../src/providers/gmail/labels'
import * as outlookFolders from '../../src/providers/outlook/folders'
import * as gmailMessages from '../../src/providers/gmail/messages'
import { encodePageToken } from '../../src/utils/page-token'

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
vi.mock('../../src/providers/gmail/labels', () => ({
  createLabel: vi.fn(),
  listLabels: vi.fn(),
  getLabel: vi.fn(),
}))
vi.mock('../../src/providers/outlook/folders', () => ({
  listFoldersPage: vi.fn(),
  getFolder: vi.fn(),
  moveFolder: vi.fn(),
  copyFolder: vi.fn(),
  listFolderMessages: vi.fn(),
}))
vi.mock('../../src/providers/gmail/messages', () => ({ listMessages: vi.fn() }))
vi.mock('../../src/utils/error', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/error')>()
  return { ...actual, handleError: vi.fn() }
})

describe('Folder Command Handlers', () => {
  const dummyClient = {} as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('folderList routes between labels and folders', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'gmail' } as any, client: dummyClient })
    vi.mocked(gmailLabels.listLabels).mockResolvedValue([])
    await folderList({})
    expect(gmailLabels.listLabels).toHaveBeenCalledWith(dummyClient)

    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'outlook' } as any, client: dummyClient })
    vi.mocked(outlookFolders.listFoldersPage).mockResolvedValue({ folders: [] })
    await folderList({ parent: 'p1' })
    expect(outlookFolders.listFoldersPage).toHaveBeenCalledWith(dummyClient, {
      parentId: 'p1',
      top: 100,
      pageToken: undefined,
    })

    expect(formatterModule.outputList).toHaveBeenCalledTimes(2)
  })

  test('folderList restores parent and top from a v2 page token', async () => {
    const account = { id: 'outlook-1', provider: 'outlook' as const }
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: account as any, client: dummyClient })
    vi.mocked(outlookFolders.listFoldersPage).mockResolvedValue({ folders: [] })
    const pageToken = encodePageToken(account, 'folder.list', 'next-link', {
      parent: 'parent-1',
      top: '17',
    })

    await folderList({ pageToken })

    expect(outlookFolders.listFoldersPage).toHaveBeenCalledWith(dummyClient, {
      parentId: 'parent-1',
      top: 17,
      pageToken: 'next-link',
    })
    const { handleError } = await import('../../src/utils/error')
    vi.mocked(handleError).mockClear()
    await folderList({ pageToken, parent: 'other' })
    expect(handleError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/does not match/),
    }))
  })

  test('folderCreate leaves Gmail parent/name nesting to the provider', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'gmail' } as any,
      client: dummyClient,
    })
    vi.mocked(gmailLabels.createLabel).mockResolvedValue({
      id: 'label-1',
      name: 'Projects/Launch',
    })

    await folderCreate({ name: 'Launch', parent: 'Projects' })

    expect(gmailLabels.createLabel).toHaveBeenCalledWith(
      dummyClient,
      'Launch',
      'Projects',
    )
  })

  test('folderMove successfully routes to Outlook', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'outlook' } as any, client: dummyClient })
    vi.mocked(outlookFolders.moveFolder).mockResolvedValue({ id: 'f-m' } as any)
    
    await folderMove('f-old', { toFolder: 'f-dest' })
    expect(outlookFolders.moveFolder).toHaveBeenCalledWith(dummyClient, 'f-old', 'f-dest')
    expect(formatterModule.output).toHaveBeenCalled()
  })

  test('folderMessages reuses the message page shape and partial contract', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { id: 'gmail-1', provider: 'gmail' } as any,
      client: dummyClient,
    })
    vi.mocked(gmailMessages.listMessages).mockResolvedValue({
      messages: [{
        id: 'ok',
        from: { address: 'sender@example.com' },
        subject: 'Subject',
        date: '2026-07-11T00:00:00.000Z',
        isRead: true,
        hasAttachments: true,
      } as any],
      errors: [{ id: 'bad', message: 'failed' }],
    })

    await folderMessages('INBOX', {})

    expect(formatterModule.outputPartial).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'ok', attachments: true })],
      [{ code: 'MESSAGE_FETCH_FAILED', message: 'failed', item: { id: 'bad' } }],
      { meta: { nextToken: undefined } },
    )
  })

  test('folderMessages restores the folder id and top from a v2 page token', async () => {
    const account = { id: 'outlook-1', provider: 'outlook' as const }
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: account as any, client: dummyClient })
    vi.mocked(outlookFolders.listFolderMessages).mockResolvedValue({ messages: [] })
    const pageToken = encodePageToken(account, 'folder.messages', 'next-link', {
      label: 'folder-1',
      top: '8',
    })

    await folderMessages(undefined, { pageToken })

    expect(outlookFolders.listFolderMessages).toHaveBeenCalledWith(dummyClient, 'folder-1', {
      top: 8,
      pageToken: 'next-link',
    })
  })

  test('folderMove throws Error for Gmail', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'gmail' } as any, client: dummyClient })
    
    await folderMove('f-old', { toFolder: 'f-dest' })
    const { handleError } = await import('../../src/utils/error')
    expect(handleError).toHaveBeenCalled()
  })
})
