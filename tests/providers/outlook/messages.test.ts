import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import { ApiError } from '../../../src/utils/error'
import {
  listMessages,
  listMessagesSince,
  getMessage,
  sendMessage,
  deleteMessage,
  moveMessage,
  copyMessage,
  markMessage,
  trashMessage,
  untrashMessage,
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
    expect(result.nextPageToken).toBe('next-skip=10')
  })

  test('listMessagesSince owns Graph filter syntax', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({ value: [] })
    await listMessagesSince(
      mockClient,
      new Date('2026-07-11T00:00:00.000Z'),
      7,
    )
    expect(mockClient.get).toHaveBeenCalledWith(
      '/messages',
      expect.objectContaining({
        $top: 7,
        $filter: 'receivedDateTime ge 2026-07-11T00:00:00.000Z',
      }),
    )
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
    expect(callArgs[1].message.importance).toBe('normal')
  })

  test('deleteMessage uses permanentDelete action with the Graph user ID', async () => {
    const result = await deleteMessage(mockClient, 'm1', true, 'user-id')
    expect(mockClient.post).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/users/user-id/messages/m1/permanentDelete',
    )
    expect(mockClient.delete).not.toHaveBeenCalled()
    expect(result).toEqual({ id: 'm1', permanentlyDeleted: true })
  })

  test('deleteMessage resolves and caches the Graph user ID when not provided', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({ id: 'graph-user' })

    await deleteMessage(mockClient, 'first', true)
    await deleteMessage(mockClient, 'second', true)

    expect(mockClient.get).toHaveBeenCalledTimes(1)
    expect(mockClient.get).toHaveBeenCalledWith('', { $select: 'id' })
    expect(mockClient.post).toHaveBeenNthCalledWith(
      2,
      'https://graph.microsoft.com/v1.0/users/graph-user/messages/second/permanentDelete',
    )
  })

  test('deleteMessage moves to DeletedItems by default and returns the response ID', async () => {
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'immutable-id' })
    const result = await deleteMessage(mockClient, 'm1')
    expect(mockClient.post).toHaveBeenCalledWith('/messages/m1/move', {
      destinationId: 'DeletedItems',
    })
    expect(result).toEqual({ id: 'immutable-id' })
  })

  test('trash and untrash own the well-known Outlook folders', async () => {
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'immutable-id' })
    await trashMessage(mockClient, 'm1')
    expect(mockClient.post).toHaveBeenLastCalledWith('/messages/m1/move', {
      destinationId: 'deleteditems',
    })
    await untrashMessage(mockClient, 'm1')
    expect(mockClient.post).toHaveBeenLastCalledWith('/messages/m1/move', {
      destinationId: 'Inbox',
    })
  })

  test('moveMessage calls /move endpoint', async () => {
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'm-new' })
    const result = await moveMessage(mockClient, 'old-id', 'dest-fldr')
    expect(mockClient.post).toHaveBeenCalledWith('/messages/old-id/move', { destinationId: 'dest-fldr' })
    expect(result).toEqual({ id: 'm-new' })
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

  test('uses an operation-bound Graph continuation URL for the next page', async () => {
    const nextLink = 'https://graph.microsoft.com/v1.0/me/messages?%24skiptoken=abc'
    ;(mockClient.get as Mock).mockResolvedValue({ value: [] })

    await listMessages(mockClient, { pageToken: nextLink })

    expect(mockClient.get).toHaveBeenCalledWith(nextLink)
  })

  test('rejects a continuation URL for another Graph operation', async () => {
    const nextLink = 'https://graph.microsoft.com/v1.0/me/mailFolders?%24skiptoken=abc'
    await expect(listMessages(mockClient, { pageToken: nextLink })).rejects.toThrow(
      'token does not match this operation',
    )
    expect(mockClient.get).not.toHaveBeenCalled()
  })

  test('treats --query as KQL and keeps it separate from OData filters', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({ value: [] })
    await listMessages(mockClient, { query: 'from:alice@example.com' })
    const query = (mockClient.get as Mock).mock.calls[0][1]
    expect(query.$search).toBe('"from:alice@example.com"')
    expect(query.$orderby).toBeUndefined()

    await expect(listMessages(mockClient, {
      query: 'from:alice@example.com',
      filter: 'isRead eq false',
    })).rejects.toThrow('mutually exclusive')
  })

  test('attaches Graph search/sort advice at the provider boundary', async () => {
    const graphError = new ApiError(
      "The query parameter '$orderby' is not supported with '$search'",
      400,
      { error: { code: 'OrderByWithSearch' } },
    )
    ;(mockClient.get as Mock).mockRejectedValue(graphError)

    await expect(listMessages(mockClient, { query: 'from:alice@example.com' }))
      .rejects.toMatchObject({
        suggestion: expect.stringContaining('sorting'),
      })
  })
})
