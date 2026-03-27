import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import {
  listLabels,
  getLabel,
  createLabel,
  updateLabel,
  deleteLabel,
} from '../../../src/providers/gmail/labels'

describe('Gmail Labels Provider', () => {
  const mockClient = createMockHttpClient()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('listLabels returns mapped folders', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({
      labels: [{ id: 'L1', name: 'MyLabel', messagesTotal: 10, messagesUnread: 2 }]
    })
    
    const result = await listLabels(mockClient)
    expect(mockClient.get).toHaveBeenCalledWith('/labels')
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('L1')
    expect(result[0].name).toBe('MyLabel')
    expect(result[0].messageCount).toBe(10)
    expect(result[0].unreadCount).toBe(2)
  })

  test('getLabel fetches /labels/{id}', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({
      id: 'L2', name: 'Important', type: 'system', messagesTotal: 5, messagesUnread: 0
    })
    
    const result = await getLabel(mockClient, 'L2')
    expect(mockClient.get).toHaveBeenCalledWith('/labels/L2')
    expect(result.id).toBe('L2')
    expect(result.name).toBe('Important')
  })

  test('createLabel posts to /labels', async () => {
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'L3', name: 'New' })
    const result = await createLabel(mockClient, 'New')
    expect(mockClient.post).toHaveBeenCalledWith('/labels', {
      name: 'New',
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show'
    })
    expect(result.id).toBe('L3')
  })

  test('updateLabel patches to /labels/{id}', async () => {
    ;(mockClient.patch as Mock).mockResolvedValueOnce({ id: 'L1', name: 'Updated' })

    const result = await updateLabel(mockClient, 'L1', 'Updated')
    expect(mockClient.patch).toHaveBeenCalledWith('/labels/L1', { name: 'Updated' })
    expect(result.name).toBe('Updated')
  })

  test('deleteLabel calls DELETE /labels/{id}', async () => {
    await deleteLabel(mockClient, 'label-id')
    expect(mockClient.delete).toHaveBeenCalledWith('/labels/label-id')
  })
})
