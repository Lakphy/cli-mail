import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import {
  listMessages,
  getMessage,
  sendMessage,
  trashMessage,
  deleteMessage,
  moveMessage,
  batchDeleteMessages,
  batchModifyMessages,
  insertMessage,
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
  })

  test('getMessage calls /messages/{id}', async () => {
    ;(mockClient.get as Mock).mockResolvedValueOnce({ id: 'msg1', threadId: 't1', snippet: 'hello' })
    const result = await getMessage(mockClient, 'msg1')
    expect(mockClient.get).toHaveBeenCalledWith('/messages/msg1', { format: 'full' })
    expect(result.id).toBe('msg1')
  })

  test('sendMessage constructs MIME and calls /messages/send', async () => {
    vi.mocked(mimeUtils.buildMimeMessage).mockReturnValue('raw-mime')
    vi.mocked(mimeUtils.toBase64Url).mockReturnValue('base64-mime')
    ;(mockClient.post as Mock).mockResolvedValueOnce({ id: 'new-msg' })

    const result = await sendMessage(mockClient, { to: ['user@example.com'], subject: 'test', body: 'body' })

    expect(mimeUtils.buildMimeMessage).toHaveBeenCalledWith(expect.objectContaining({ subject: 'test', body: 'body' }))
    expect(mockClient.post).toHaveBeenCalledWith('/messages/send', { raw: 'base64-mime' })
    expect(result.id).toBe('new-msg')
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
    await moveMessage(mockClient, 'msg1', ['LABEL_ID'], ['INBOX'])
    expect(mockClient.post).toHaveBeenCalledWith('/messages/msg1/modify', {
      addLabelIds: ['LABEL_ID'],
      removeLabelIds: ['INBOX'],
    })
  })

  test('batchDeleteMessages calls /messages/batchDelete', async () => {
    await batchDeleteMessages(mockClient, ['id1', 'id2'])
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

  test('insertMessage calls /messages/insert', async () => {
    vi.mocked(mimeUtils.toBase64Url).mockReturnValue('base64')
    ;(mockClient.post as Mock).mockResolvedValueOnce({ id: 'inserted-msg' })

    const result = await insertMessage(mockClient, 'raw-text')
    expect(mockClient.post).toHaveBeenCalledWith('/messages/insert', { raw: 'base64' })
    expect(result.id).toBe('inserted-msg')
  })
})
