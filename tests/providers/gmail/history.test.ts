import { describe, expect, test, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import { listHistory } from '../../../src/providers/gmail/history'

describe('Gmail history provider', () => {
  test('sends historyTypes as repeated query values and preserves pagination', async () => {
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({
      history: [],
      historyId: '200',
      nextPageToken: 'next',
    })

    const result = await listHistory(client, {
      startHistoryId: '100',
      historyTypes: ['messageAdded', 'labelRemoved'],
      pageToken: 'page',
      maxResults: 25,
    })
    expect(client.get).toHaveBeenCalledWith('/history', {
      startHistoryId: '100',
      maxResults: 25,
      pageToken: 'page',
      historyTypes: ['messageAdded', 'labelRemoved'],
    })
    expect(result.nextPageToken).toBe('next')
  })
})
