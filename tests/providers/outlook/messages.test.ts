import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import {
  listMessages,
  getMessage,
  sendMessage,
  deleteMessage,
  moveMessage,
  copyMessage,
  markMessage,
  createMessage,
} from '../../../src/providers/outlook/messages'

describe('Outlook Messages Provider', () => {
  const mockClient = createMockHttpClient()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('listMessages calls /messages with $top and $skip', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({
      value: [{ id: 'o1', subject: 'hello', isRead: true }],
      '@odata.nextLink': 'next-skip=10'
    })
    
    const result = await listMessages(mockClient, { top: 10, skip: 5 })
    
    expect(mockClient.get).toHaveBeenCalledWith('/messages', expect.objectContaining({
      $top: 10,
      $skip: 5,
    }))
    expect(result.messages.length).toBe(1)
    expect(result.nextLink).toBe('next-skip=10')
  })

  test('getMessage fetches from /messages/{id}', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({ id: 'm2', subject: 'sub', body: { content: 'hello', contentType: 'text' } })
    const result = await getMessage(mockClient, 'm2')
    expect(mockClient.get).toHaveBeenCalledWith('/messages/m2', expect.any(Object))
    expect(result.id).toBe('m2')
    expect(result.body).toBe('hello')
  })

  test('sendMessage calls /sendMail directly', async () => {
    await sendMessage(mockClient, { to: ['user@ms.com'], subject: 'test', body: 'body' })
    expect(mockClient.post).toHaveBeenCalled()
    const callArgs = (mockClient.post as Mock).mock.calls[0]
    expect(callArgs[0]).toBe('/sendMail')
    expect(callArgs[1].message.subject).toBe('test')
    expect(callArgs[1].message.toRecipients[0].emailAddress.address).toBe('user@ms.com')
  })

  test('deleteMessage deletes to /messages/{id} when permanent', async () => {
    await deleteMessage(mockClient, 'm1', true)
    expect(mockClient.delete).toHaveBeenCalledWith('/messages/m1')
  })

  test('moveMessage calls /move endpoint', async () => {
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'm-new' })
    await moveMessage(mockClient, 'old-id', 'dest-fldr')
    expect(mockClient.post).toHaveBeenCalledWith('/messages/old-id/move', { destinationId: 'dest-fldr' })
  })

  test('copyMessage calls /copy endpoint', async () => {
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'm-new' })
    const result = await copyMessage(mockClient, 'old-id', 'dest-fldr')
    expect(mockClient.post).toHaveBeenCalledWith('/messages/old-id/copy', { destinationId: 'dest-fldr' })
    expect(result.id).toBe('m-new')
  })

  test('markMessage patches /messages/{id}', async () => {
    await markMessage(mockClient, 'm1', { read: true, flagged: true })
    expect(mockClient.patch).toHaveBeenCalledWith('/messages/m1', {
      isRead: true,
      flag: { flagStatus: 'flagged' }
    })
  })

  test('createMessage creates draft directly via /messages', async () => {
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'm3' })
    const result = await createMessage(mockClient, { subject: 'hi', body: '', to: [] })
    expect(mockClient.post).toHaveBeenCalledWith('/messages', {
      subject: 'hi',
      toRecipients: [],
      body: { contentType: 'Text', content: '' }
    })
    expect(result.id).toBe('m3')
  })
})
