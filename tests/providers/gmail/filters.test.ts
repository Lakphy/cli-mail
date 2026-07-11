import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import {
  deleteFilter,
  getFilter,
  listFilters,
} from '../../../src/providers/gmail/filters'

describe('Gmail filters provider', () => {
  const client = createMockHttpClient()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('lists and normalizes filters', async () => {
    ;(client.get as Mock).mockResolvedValue({
      filter: [{
        id: 'f1',
        criteria: { from: 'sender@example.com' },
        action: { addLabelIds: ['STARRED'] },
      }],
    })

    await expect(listFilters(client)).resolves.toEqual([{
      id: 'f1',
      conditions: { from: 'sender@example.com' },
      actions: { addLabelIds: ['STARRED'] },
    }])
  })

  test('encodes opaque filter ids in read and delete paths', async () => {
    const id = '../filter%2Fid?x#y'
    ;(client.get as Mock).mockResolvedValue({ id })

    await getFilter(client, id)
    await deleteFilter(client, id)

    const encoded = '..%2Ffilter%252Fid%3Fx%23y'
    expect(client.get).toHaveBeenCalledWith(`/settings/filters/${encoded}`)
    expect(client.delete).toHaveBeenCalledWith(`/settings/filters/${encoded}`)
  })
})
