import { describe, expect, test, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import { listThreads } from '../../../src/providers/gmail/threads'

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
})
