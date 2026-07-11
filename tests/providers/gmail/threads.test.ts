import { describe, expect, test, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import { getThread, listThreads, trashThread } from '../../../src/providers/gmail/threads'

describe('Gmail threads provider', () => {
  test('uses repeated metadata headers and passes pageToken through', async () => {
    const client = createMockHttpClient()
    ;(client.get as Mock)
      .mockResolvedValueOnce({
        threads: [{ id: 't1' }],
        nextPageToken: 'next',
      })
      .mockResolvedValueOnce({
        id: 't1',
        messages: [{
          id: 'm1',
          threadId: 't1',
          payload: { headers: [{ name: 'Subject', value: 'Topic' }] },
        }],
      })

    const result = await listThreads(client, { top: 5, pageToken: 'page' })
    expect(client.get).toHaveBeenNthCalledWith(1, '/threads', {
      maxResults: 5,
      pageToken: 'page',
    })
    expect(client.get).toHaveBeenNthCalledWith(2, '/threads/t1', {
      format: 'metadata',
      metadataHeaders: ['Subject', 'Date'],
    })
    expect(result.nextPageToken).toBe('next')
  })

  test('encodes thread ids in both read and mutation paths', async () => {
    const client = createMockHttpClient()
    const id = '../thread%2Fid?x#y'
    ;(client.get as Mock).mockResolvedValue({ id, messages: [] })

    await getThread(client, id)
    await trashThread(client, id)
    const encoded = '..%2Fthread%252Fid%3Fx%23y'
    expect(client.get).toHaveBeenCalledWith(`/threads/${encoded}`, { format: 'full' })
    expect(client.post).toHaveBeenCalledWith(`/threads/${encoded}/trash`)
  })
})
