import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  threadDelete,
  threadGet,
  threadList,
  threadModify,
  threadTrash,
  threadUntrash,
} from '../../src/commands/thread'
import { historyList } from '../../src/commands/history'
import * as resolveModule from '../../src/commands/resolve'
import * as formatter from '../../src/output/formatter'
import * as gmailThreads from '../../src/providers/gmail/threads'
import * as gmailHistory from '../../src/providers/gmail/history'
import { decodePageTokenState, encodePageToken } from '../../src/utils/page-token'

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
vi.mock('../../src/providers/gmail/threads', () => ({
  listThreads: vi.fn(),
  getThread: vi.fn(),
  modifyThread: vi.fn(),
  trashThread: vi.fn(),
  untrashThread: vi.fn(),
  deleteThread: vi.fn(),
}))
vi.mock('../../src/providers/gmail/history', () => ({ listHistory: vi.fn() }))
vi.mock('../../src/utils/error', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/utils/error')>(),
  handleError: vi.fn((error: unknown) => { throw error }),
}))

describe('thread command coverage and page-token context', () => {
  const client = {} as never
  const gmailAccount = {
    id: 'gmail-account',
    provider: 'gmail',
    status: 'active',
    scopes: ['https://mail.google.com/'],
    tokens: {},
  } as never

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: gmailAccount,
      client,
    })
  })

  test('threadList maps summaries and captures every result-shaping option', async () => {
    vi.mocked(gmailThreads.listThreads).mockResolvedValue({
      threads: [{
        id: 'thread-1',
        subject: 'Planning',
        messageCount: 3,
        lastDate: '2026-07-12',
        snippet: 'Latest update',
      }],
      nextPageToken: 'gmail-cursor',
    })

    await threadList({ query: 'from:boss', top: '7' })

    expect(gmailThreads.listThreads).toHaveBeenCalledWith(client, {
      query: 'from:boss',
      top: 7,
      pageToken: undefined,
    })
    const [items, , options] = vi.mocked(formatter.outputList).mock.calls[0]
    expect(items).toEqual([{
      id: 'thread-1',
      subject: 'Planning',
      messages: 3,
      lastDate: '2026-07-12',
      snippet: 'Latest update',
    }])
    expect(decodePageTokenState(
      options.meta?.nextToken as string,
      gmailAccount,
      'thread.list',
    )).toEqual({
      cursor: 'gmail-cursor',
      context: { query: 'from:boss', top: '7' },
    })
  })

  test('threadList restores omitted options and rejects explicit mismatches', async () => {
    vi.mocked(gmailThreads.listThreads).mockResolvedValue({ threads: [] })
    const pageToken = encodePageToken(gmailAccount, 'thread.list', 'cursor-2', {
      query: 'is:unread',
      top: '11',
    })!

    await threadList({ pageToken })

    expect(gmailThreads.listThreads).toHaveBeenCalledWith(client, {
      query: 'is:unread',
      top: 11,
      pageToken: 'cursor-2',
    })
    await expect(threadList({ pageToken, query: 'is:read' })).rejects.toThrow(/--query.*does not match/)
    await expect(threadList({ pageToken, top: '12' })).rejects.toThrow(/--top.*does not match/)
  })

  test('threadList emits the partial-page contract', async () => {
    vi.mocked(gmailThreads.listThreads).mockResolvedValue({
      threads: [{
        id: 'ok', subject: 'Subject', messageCount: 1, lastDate: '', snippet: '',
      }],
      errors: [{ id: 'bad', message: 'detail unavailable' }],
    })

    await threadList({})

    expect(formatter.outputPartial).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'ok', messages: 1 })],
      [{ code: 'THREAD_FETCH_FAILED', message: 'detail unavailable', item: { id: 'bad' } }],
      { meta: { nextToken: undefined } },
    )
  })

  test('thread operations route to their providers and report success', async () => {
    vi.mocked(gmailThreads.getThread).mockResolvedValue({ id: 't1', messages: [] })

    await threadGet('t1', {})
    await threadModify('t1', { addLabels: ['STARRED'], removeLabels: ['INBOX'] })
    await threadTrash('t1', {})
    await threadUntrash('t1', {})
    await threadDelete('t1', {})

    expect(gmailThreads.getThread).toHaveBeenCalledWith(client, 't1')
    expect(formatter.output).toHaveBeenCalledWith({ id: 't1', messages: [] })
    expect(gmailThreads.modifyThread).toHaveBeenCalledWith(client, 't1', ['STARRED'], ['INBOX'])
    expect(gmailThreads.trashThread).toHaveBeenCalledWith(client, 't1')
    expect(gmailThreads.untrashThread).toHaveBeenCalledWith(client, 't1')
    expect(gmailThreads.deleteThread).toHaveBeenCalledWith(client, 't1')
    expect(formatter.outputSuccess).toHaveBeenCalledTimes(4)
  })

  test('thread operations reject Outlook and permanent delete checks capability', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { id: 'outlook', provider: 'outlook' } as never,
      client,
    })
    await expect(threadGet('t1', {})).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })

    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: {
        id: 'gmail-limited',
        provider: 'gmail',
        status: 'active',
        scopes: ['https://www.googleapis.com/auth/gmail.modify'],
        tokens: {},
      } as never,
      client,
    })
    await expect(threadDelete('t1', {})).rejects.toMatchObject({ code: 'CAPABILITY_REQUIRED' })
    expect(gmailThreads.deleteThread).not.toHaveBeenCalled()
  })
})

describe('history command coverage and page-token context', () => {
  const client = {} as never
  const account = { id: 'gmail-history', provider: 'gmail' as const }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: account as never,
      client,
    })
  })

  test('requires the start history id on page one', async () => {
    await expect(historyList({})).rejects.toThrow(/--start-history-id is required on the first page/)
    expect(gmailHistory.listHistory).not.toHaveBeenCalled()
  })

  test('passes first-page options and emits a resumable v2 token', async () => {
    vi.mocked(gmailHistory.listHistory).mockResolvedValue({
      historyId: '110',
      history: [{ id: '105' }],
      nextPageToken: 'history-cursor',
    })

    await historyList({
      startHistoryId: '100',
      labelId: 'INBOX',
      types: ['messagesDeleted', 'messagesAdded'],
      top: '25',
    })

    expect(gmailHistory.listHistory).toHaveBeenCalledWith(client, {
      startHistoryId: '100',
      labelId: 'INBOX',
      historyTypes: ['messagesAdded', 'messagesDeleted'],
      maxResults: 25,
      pageToken: undefined,
    })
    const [data, options] = vi.mocked(formatter.output).mock.calls[0]
    expect(data).toEqual({ historyId: '110', count: 1, history: [{ id: '105' }] })
    expect(decodePageTokenState(
      options?.meta?.nextToken as string,
      account,
      'history.list',
    )).toEqual({
      cursor: 'history-cursor',
      context: {
        startHistoryId: '100',
        label: 'INBOX',
        types: '["messagesAdded","messagesDeleted"]',
        top: '25',
      },
    })
  })

  test('restores all omitted history options from a token', async () => {
    vi.mocked(gmailHistory.listHistory).mockResolvedValue({ historyId: '120', history: [] })
    const pageToken = encodePageToken(account, 'history.list', 'history-cursor-2', {
      startHistoryId: '100',
      label: 'IMPORTANT',
      types: '["labelsAdded"]',
      top: '9',
    })!

    await historyList({ pageToken })

    expect(gmailHistory.listHistory).toHaveBeenCalledWith(client, {
      startHistoryId: '100',
      labelId: 'IMPORTANT',
      historyTypes: ['labelsAdded'],
      maxResults: 9,
      pageToken: 'history-cursor-2',
    })
  })

  test.each([
    [{ startHistoryId: '101' }, '--start-history-id'],
    [{ labelId: 'SENT' }, '--label-id'],
    [{ types: ['labelsRemoved'] }, '--types'],
    [{ top: '10' }, '--top'],
  ] as const)('rejects an explicit history context mismatch: %s', async (explicit, option) => {
    const pageToken = encodePageToken(account, 'history.list', 'cursor', {
      startHistoryId: '100',
      label: 'INBOX',
      types: '["labelsAdded"]',
      top: '9',
    })!

    await expect(historyList({ pageToken, ...explicit })).rejects.toThrow(
      new RegExp(`${option}.*does not match`),
    )
  })

  test('rejects malformed history type context and Outlook accounts', async () => {
    const malformed = encodePageToken(account, 'history.list', 'cursor', {
      startHistoryId: '100',
      types: 'not-json',
    })!
    await expect(historyList({ pageToken: malformed })).rejects.toThrow(/Invalid history type context/)

    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { id: 'outlook', provider: 'outlook' } as never,
      client,
    })
    await expect(historyList({ startHistoryId: '100' })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
  })
})
