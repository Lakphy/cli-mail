import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import {
  listDrafts,
  getDraft,
  createDraft,
  updateDraft,
  sendDraft,
  deleteDraft,
} from '../../../src/providers/outlook/drafts'

describe('Outlook Drafts Provider', () => {
  const mockClient = createMockHttpClient()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('listDrafts calls /mailFolders/drafts/messages', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({
      value: [{ id: 'd1', subject: 'draft 1' }],
      '@odata.nextLink': 'next'
    })
    
    const result = await listDrafts(mockClient, { top: 5 })
    expect(mockClient.get).toHaveBeenCalledWith('/mailFolders/Drafts/messages', expect.objectContaining({
      $top: 5
    }))
    expect(result.drafts.length).toBe(1)
    expect(result.drafts[0].id).toBe('d1')
  })

  test('getDraft fetches /messages/{id}', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({ id: 'd2', body: { content: 'test data' } })
    const result = await getDraft(mockClient, 'd2')
    expect(mockClient.get).toHaveBeenCalledWith('/messages/d2', expect.any(Object))
    expect(result.id).toBe('d2')
  })

  test('createDraft calls /messages for draft saving', async () => {
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'new-d' })
    const result = await createDraft(mockClient, { to: [], subject: 'hello draft', body: '' })
    expect(mockClient.post).toHaveBeenCalledWith('/messages', {
      subject: 'hello draft',
      toRecipients: [],
      body: { contentType: 'Text', content: '' },
      importance: 'normal',
    })
    expect(result.id).toBe('new-d')
  })

  test('updateDraft calls PATCH /messages/{id}', async () => {
    ;(mockClient.patch as Mock).mockResolvedValue({ id: 'd3' })
    await updateDraft(mockClient, 'd3', { subject: 'updated sub' })
    expect(mockClient.patch).toHaveBeenCalledWith('/messages/d3', expect.objectContaining({
      subject: 'updated sub'
    }))
  })

  test('updateDraft preserves HTML body type when only content changes', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({
      id: 'd-html',
      body: { contentType: 'HTML', content: '<p>old</p>' },
    })
    ;(mockClient.patch as Mock).mockResolvedValue({ id: 'd-html' })

    await updateDraft(mockClient, 'd-html', { body: '<p>new</p>' })

    expect(mockClient.get).toHaveBeenCalledWith('/messages/d-html', { $select: 'body' })
    expect(mockClient.patch).toHaveBeenCalledWith('/messages/d-html', {
      body: { contentType: 'HTML', content: '<p>new</p>' },
    })
  })

  test('updateDraft rejects bodyType without an explicit body', async () => {
    await expect(updateDraft(mockClient, 'd-text', { bodyType: 'html' }))
      .rejects.toThrow('bodyType can only be changed together with body')

    expect(mockClient.get).not.toHaveBeenCalled()
    expect(mockClient.patch).not.toHaveBeenCalled()
  })

  test('listDrafts follows a validated Graph continuation URL', async () => {
    const nextLink = 'https://graph.microsoft.com/v1.0/me/mailFolders/Drafts/messages?%24skiptoken=x'
    ;(mockClient.get as Mock).mockResolvedValue({ value: [] })
    const result = await listDrafts(mockClient, { pageToken: nextLink })
    expect(mockClient.get).toHaveBeenCalledWith(nextLink)
    expect(result.nextPageToken).toBeUndefined()
  })

  test('sendDraft calls POST /messages/{id}/send', async () => {
    await sendDraft(mockClient, 'd-send')
    expect(mockClient.post).toHaveBeenCalledWith('/messages/d-send/send')
  })

  test('deleteDraft calls DELETE /messages/{id}', async () => {
    await deleteDraft(mockClient, 'd-del')
    expect(mockClient.delete).toHaveBeenCalledWith('/messages/d-del')
  })
})
