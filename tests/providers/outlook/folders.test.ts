import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import {
  listFolders,
  getFolder,
  createFolder,
  updateFolder,
  deleteFolder,
  moveFolder,
  copyFolder,
  listFolderMessages,
} from '../../../src/providers/outlook/folders'

describe('Outlook Folders Provider', () => {
  const mockClient = createMockHttpClient()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('listFolders calls /mailFolders', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({
      value: [{ id: 'f1', displayName: 'Inbox', hidden: false, unreadItemCount: 1, totalItemCount: 2 }]
    })
    
    const result = await listFolders(mockClient)
    expect(mockClient.get).toHaveBeenCalledWith('/mailFolders', expect.any(Object))
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('f1')
    expect(result[0].name).toBe('Inbox')
  })

  test('listFolders with parentId uses childFolders', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({ value: [] })
    await listFolders(mockClient, 'parent1')
    expect(mockClient.get).toHaveBeenCalledWith('/mailFolders/parent1/childFolders', expect.any(Object))
  })

  test('getFolder fetches /mailFolders/{id}', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({ id: 'f2', displayName: 'Sent Items' })
    const result = await getFolder(mockClient, 'f2')
    expect(mockClient.get).toHaveBeenCalledWith('/mailFolders/f2')
    expect(result.name).toBe('Sent Items')
  })

  test('createFolder posts to /mailFolders', async () => {
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'f3', displayName: 'New Folder' })
    const result = await createFolder(mockClient, 'New Folder')
    expect(mockClient.post).toHaveBeenCalledWith('/mailFolders', expect.objectContaining({ displayName: 'New Folder' }))
    expect(result.id).toBe('f3')
  })

  test('updateFolder patches /mailFolders/{id}', async () => {
    ;(mockClient.patch as Mock).mockResolvedValue({ id: 'f1', displayName: 'Updated' })
    const result = await updateFolder(mockClient, 'f1', 'Updated')
    expect(mockClient.patch).toHaveBeenCalledWith('/mailFolders/f1', expect.objectContaining({ displayName: 'Updated' }))
    expect(result.name).toBe('Updated')
  })

  test('deleteFolder calls DELETE /mailFolders/{id}', async () => {
    await deleteFolder(mockClient, 'f-del')
    expect(mockClient.delete).toHaveBeenCalledWith('/mailFolders/f-del')
  })

  test('moveFolder uses /move endpoint', async () => {
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'f-moved' })
    const result = await moveFolder(mockClient, 'f-old', 'f-dest')
    expect(mockClient.post).toHaveBeenCalledWith('/mailFolders/f-old/move', { destinationId: 'f-dest' })
    expect(result.id).toBe('f-moved')
  })

  test('copyFolder uses /copy endpoint', async () => {
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'f-copied' })
    const result = await copyFolder(mockClient, 'f-old', 'f-dest')
    expect(mockClient.post).toHaveBeenCalledWith('/mailFolders/f-old/copy', { destinationId: 'f-dest' })
    expect(result.id).toBe('f-copied')
  })

  test('listFolderMessages calls /mailFolders/{id}/messages', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({ value: [{ id: 'm1' }] })
    const result = await listFolderMessages(mockClient, 'f1', 5)
    expect(mockClient.get).toHaveBeenCalledWith('/mailFolders/f1/messages', expect.objectContaining({ $top: 5 }))
    expect(result.messages.length).toBe(1)
  })
})
