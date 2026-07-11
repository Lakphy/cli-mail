import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import {
  listMessages,
  listMessagesSince,
  listInboxMessagesSince,
  getMessage,
  getMessageRaw,
  sendMessage,
  replyToMessage,
  trashMessage,
  deleteMessage,
  moveMessage,
  batchDeleteMessages,
  batchModifyMessages,
  insertMessage,
  importMessage,
  attachmentLimits,
} from '../../../src/providers/gmail/messages'
import * as mimeUtils from '../../../src/utils/mime'

vi.mock('../../../src/utils/mime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/mime')>()
  return {
    ...actual,
    buildMimeMessage: vi.fn(),
    toBase64Url: vi.fn(),
  }
})

describe('Gmail Messages Provider', () => {
  const mockClient = createMockHttpClient()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('listMessages calls /messages endpoint with maxResults', async () => {
    const mockResponse = { messages: [{ id: '1', threadId: 't1' }], nextPageToken: 'next' }
    ;(mockClient.get as Mock).mockResolvedValueOnce(mockResponse)

    // A second call resolving the actual message details (batch or sequential get)
    ;(mockClient.get as Mock).mockResolvedValue({ id: '1', threadId: 't1', snippet: 'hello' })

    const result = await listMessages(mockClient, { top: 10, pageToken: 'token123' })
    expect(mockClient.get).toHaveBeenCalledWith('/messages', expect.objectContaining({ maxResults: 10, pageToken: 'token123' }))
    
    // Validates the structure matches logic
    expect(result.messages.length).toBe(1)
    expect(result.nextPageToken).toBe('next')
    expect(mockClient.get).toHaveBeenLastCalledWith('/messages/1', {
      format: 'full',
      fields: 'id,threadId,labelIds,snippet,internalDate,payload',
    })
  })

  test('attachment policy enforces Gmail combined size', () => {
    expect(() => attachmentLimits.assertTotalSize(25 * 1024 * 1024)).not.toThrow()
    expect(() => attachmentLimits.assertTotalSize(25 * 1024 * 1024 + 1)).toThrow(
      'Gmail attachments exceed the combined 25 MiB limit',
    )
  })

  test('listMessagesSince owns Gmail date query syntax', async () => {
    ;(mockClient.get as Mock).mockResolvedValueOnce({ messages: [] })
    await listMessagesSince(
      mockClient,
      new Date('2026-07-11T00:00:00.000Z'),
      7,
      'next',
    )
    expect(mockClient.get).toHaveBeenCalledWith('/messages', expect.objectContaining({
      q: 'after:1783728000',
      maxResults: 7,
      pageToken: 'next',
    }))
  })

  test('listInboxMessagesSince scopes the Gmail query to INBOX', async () => {
    ;(mockClient.get as Mock).mockResolvedValueOnce({ messages: [] })
    await listInboxMessagesSince(
      mockClient,
      new Date('2026-07-11T00:00:00.000Z'),
      7,
      'next',
    )
    expect(mockClient.get).toHaveBeenCalledWith('/messages', expect.objectContaining({
      q: 'after:1783728000',
      labelIds: 'INBOX',
      maxResults: 7,
      pageToken: 'next',
    }))
  })

  test('listMessages rejects numeric skip instead of silently ignoring it', async () => {
    await expect(listMessages(mockClient, { skip: 0 })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
    })
    expect(mockClient.get).not.toHaveBeenCalled()
  })

  test('listMessages detects attachments from the full MIME part tree', async () => {
    ;(mockClient.get as Mock)
      .mockResolvedValueOnce({ messages: [{ id: '1', threadId: 't1' }] })
      .mockResolvedValueOnce({
        id: '1',
        threadId: 't1',
        payload: {
          headers: [
            { name: 'From', value: '"Doe, Jane" <jane@example.com>' },
            { name: 'To', value: 'one@example.com, two@example.com' },
          ],
          parts: [{
            mimeType: 'application/pdf',
            filename: 'invoice.pdf',
            body: { attachmentId: 'a1', size: 42 },
          }],
        },
      })

    const result = await listMessages(mockClient)
    expect(result.messages[0]).toMatchObject({
      from: { name: 'Doe, Jane', address: 'jane@example.com' },
      hasAttachments: true,
    })
    expect(result.messages[0].to).toHaveLength(2)
  })

  test('listMessages returns successful items and visible per-item failures', async () => {
    ;(mockClient.get as Mock)
      .mockResolvedValueOnce({
        messages: [
          { id: 'ok', threadId: 't1' },
          { id: 'bad', threadId: 't2' },
        ],
      })
      .mockResolvedValueOnce({ id: 'ok', threadId: 't1' })
      .mockRejectedValueOnce(new Error('not found'))

    const result = await listMessages(mockClient)
    expect(result.messages.map((message) => message.id)).toEqual(['ok'])
    expect(result.errors).toEqual([{ id: 'bad', message: 'not found' }])
  })

  test('listMessages caps detail requests at eight concurrent calls', async () => {
    const listed = Array.from({ length: 20 }, (_, index) => ({
      id: String(index),
      threadId: `t${index}`,
    }))
    let active = 0
    let maximum = 0
    ;(mockClient.get as Mock)
      .mockResolvedValueOnce({ messages: listed })
      .mockImplementation(async (path: string) => {
        active++
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, 1))
        active--
        const id = path.split('/').pop() ?? ''
        return { id, threadId: `t${id}` }
      })

    const result = await listMessages(mockClient)
    expect(result.messages).toHaveLength(20)
    expect(maximum).toBeLessThanOrEqual(8)
  })

  test('getMessage calls /messages/{id}', async () => {
    ;(mockClient.get as Mock).mockResolvedValueOnce({ id: 'msg1', threadId: 't1', snippet: 'hello' })
    const result = await getMessage(mockClient, 'msg1')
    expect(mockClient.get).toHaveBeenCalledWith('/messages/msg1', { format: 'full' })
    expect(result.id).toBe('msg1')
  })

  test('encodes opaque message ids before adding them to REST paths', async () => {
    const id = '../escape%2Fchild?format=raw#fragment'
    ;(mockClient.get as Mock).mockResolvedValueOnce({ id, threadId: 't1' })

    await getMessage(mockClient, id)
    expect(mockClient.get).toHaveBeenCalledWith(
      '/messages/..%2Fescape%252Fchild%3Fformat%3Draw%23fragment',
      { format: 'full' },
    )
  })

  test('sendMessage constructs MIME and calls /messages/send', async () => {
    vi.mocked(mimeUtils.buildMimeMessage).mockResolvedValue(Buffer.from('raw-mime'))
    vi.mocked(mimeUtils.toBase64Url).mockReturnValue('base64-mime')
    ;(mockClient.post as Mock).mockResolvedValueOnce({ id: 'new-msg' })

    const result = await sendMessage(mockClient, { to: ['user@example.com'], subject: 'test', body: 'body' })

    expect(mimeUtils.buildMimeMessage).toHaveBeenCalledWith(expect.objectContaining({ subject: 'test', body: 'body' }))
    expect(mockClient.post).toHaveBeenCalledWith('/messages/send', { raw: 'base64-mime' })
    expect(result.id).toBe('new-msg')
  })

  test('getMessageRaw returns exact bytes', async () => {
    const bytes = Buffer.from([0, 0xff, 0x41, 0x0d, 0x0a])
    ;(mockClient.get as Mock).mockResolvedValue({ raw: bytes.toString('base64url') })
    await expect(getMessageRaw(mockClient, 'raw1')).resolves.toEqual(bytes)
  })

  test('reply-all deduplicates recipients and excludes the account identity', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({
      id: 'original',
      threadId: 'thread1',
      payload: {
        headers: [
          { name: 'From', value: 'Sender <sender@example.com>' },
          { name: 'To', value: 'me@example.com, Other <other@example.com>' },
          { name: 'Cc', value: 'other@example.com, Copy <copy@example.com>' },
          { name: 'Subject', value: 'Topic' },
          { name: 'Message-ID', value: '<original@example.com>' },
          { name: 'References', value: '<older@example.com>' },
        ],
      },
    })
    vi.mocked(mimeUtils.buildMimeMessage).mockResolvedValue(Buffer.from('reply'))
    vi.mocked(mimeUtils.toBase64Url).mockReturnValue('encoded')
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'reply', threadId: 'thread1' })

    await replyToMessage(
      mockClient,
      'original',
      'hello',
      true,
      { email: 'me@example.com' },
    )

    expect(mimeUtils.buildMimeMessage).toHaveBeenCalledWith(expect.objectContaining({
      to: ['"Sender" <sender@example.com>', '"Other" <other@example.com>'],
      cc: ['"Copy" <copy@example.com>'],
      references: ['<older@example.com>', '<original@example.com>'],
    }))
  })

  test('replyToMessage uses a prefetched message without another GET', async () => {
    vi.mocked(mimeUtils.buildMimeMessage).mockResolvedValue(Buffer.from('reply'))
    vi.mocked(mimeUtils.toBase64Url).mockReturnValue('encoded')
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'reply', threadId: 'thread1' })

    await replyToMessage(
      mockClient,
      'original',
      'hello',
      false,
      undefined,
      {
        id: 'original',
        threadId: 'thread1',
        subject: 'Topic',
        from: { address: 'sender@example.com' },
        to: [],
        cc: [],
        bcc: [],
        date: '',
        body: '',
        bodyType: 'text',
        isRead: true,
        hasAttachments: false,
      },
    )

    expect(mockClient.get).not.toHaveBeenCalled()
    expect(mockClient.post).toHaveBeenCalledWith('/messages/send', {
      raw: 'encoded',
      threadId: 'thread1',
    })
  })

  test('replyToMessage safely quotes a prefetched display name', async () => {
    vi.mocked(mimeUtils.buildMimeMessage).mockResolvedValue(Buffer.from('reply'))
    vi.mocked(mimeUtils.toBase64Url).mockReturnValue('encoded')
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'reply', threadId: 'thread1' })

    await replyToMessage(
      mockClient,
      'original',
      'hello',
      false,
      undefined,
      {
        id: 'original',
        threadId: 'thread1',
        subject: 'Topic',
        from: { name: 'Sender "Alias" \\ Team', address: 'sender@example.com' },
        to: [],
        date: '',
        body: '',
        bodyType: 'text',
        isRead: true,
        hasAttachments: false,
      },
    )

    expect(mimeUtils.buildMimeMessage).toHaveBeenCalledWith(expect.objectContaining({
      to: [String.raw`"Sender \"Alias\" \\ Team" <sender@example.com>`],
    }))
    expect(mockClient.get).not.toHaveBeenCalled()
  })

  test('replyToMessage rejects CRLF injection in a prefetched display name', async () => {
    await expect(replyToMessage(
      mockClient,
      'original',
      'hello',
      false,
      undefined,
      {
        id: 'original',
        threadId: 'thread1',
        subject: 'Topic',
        from: {
          name: 'Sender\r\nBcc: attacker@example.com',
          address: 'sender@example.com',
        },
        to: [],
        date: '',
        body: '',
        bodyType: 'text',
        isRead: true,
        hasAttachments: false,
      },
    )).rejects.toMatchObject({ code: 'INVALID_HEADER_VALUE' })

    expect(mimeUtils.buildMimeMessage).not.toHaveBeenCalled()
    expect(mockClient.post).not.toHaveBeenCalled()
  })

  test('trashMessage calls /trash', async () => {
    await trashMessage(mockClient, 'msg1')
    expect(mockClient.post).toHaveBeenCalledWith('/messages/msg1/trash')
  })

  test('deleteMessage calls DELETE /messages/{id} if permanent', async () => {
    await deleteMessage(mockClient, 'msg2', true)
    expect(mockClient.delete).toHaveBeenCalledWith('/messages/msg2')
  })

  test('moveMessage uses modify to change labels', async () => {
    await moveMessage(mockClient, 'msg1', 'LABEL_ID')
    expect(mockClient.post).toHaveBeenCalledWith('/messages/msg1/modify', {
      addLabelIds: ['LABEL_ID'],
      removeLabelIds: ['INBOX'],
    })
  })

  test('batchDeleteMessages defaults to recoverable trash', async () => {
    await batchDeleteMessages(mockClient, ['id1', 'id2'])
    expect(mockClient.post).toHaveBeenCalledWith('/messages/batchModify', {
      ids: ['id1', 'id2'],
      addLabelIds: ['TRASH'],
      removeLabelIds: ['INBOX'],
    })
  })

  test('batchDeleteMessages uses batchDelete only when permanent is explicit', async () => {
    await batchDeleteMessages(mockClient, ['id1', 'id2'], true)
    expect(mockClient.post).toHaveBeenCalledWith('/messages/batchDelete', { ids: ['id1', 'id2'] })
  })

  test('batchModifyMessages calls /messages/batchModify', async () => {
    await batchModifyMessages(mockClient, ['id1'], ['ADD1'], ['REM1'])
    expect(mockClient.post).toHaveBeenCalledWith('/messages/batchModify', {
      ids: ['id1'],
      addLabelIds: ['ADD1'],
      removeLabelIds: ['REM1'],
    })
  })

  test('insertMessage calls the Gmail users.messages.insert endpoint', async () => {
    vi.mocked(mimeUtils.toBase64Url).mockReturnValue('base64')
    ;(mockClient.post as Mock).mockResolvedValueOnce({ id: 'inserted-msg' })

    const result = await insertMessage(mockClient, 'raw-text')
    expect(mockClient.post).toHaveBeenCalledWith('/messages', { raw: 'base64' })
    expect(result.id).toBe('inserted-msg')
  })

  test('importMessage base64url encodes binary MIME without UTF-8 conversion', async () => {
    vi.mocked(mimeUtils.toBase64Url).mockImplementation((value) => Buffer
      .from(value)
      .toString('base64url'))
    ;(mockClient.post as Mock).mockResolvedValueOnce({ id: 'imported' })
    const raw = Buffer.from([0, 0xff, 0x0d, 0x0a])

    await importMessage(mockClient, raw)
    expect(mockClient.post).toHaveBeenCalledWith('/messages/import', {
      raw: raw.toString('base64url'),
    })
  })
})
