import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import {
  listDrafts,
  getDraft,
  createDraft,
  updateDraft,
  sendDraft,
  deleteDraft,
} from '../../../src/providers/gmail/drafts'
import * as mimeUtils from '../../../src/utils/mime'

vi.mock('../../../src/utils/mime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/mime')>()
  return {
    ...actual,
    buildMimeMessage: vi.fn(),
    toBase64Url: vi.fn(),
  }
})

describe('Gmail Drafts Provider', () => {
  const mockClient = createMockHttpClient()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('listDrafts calls /drafts and maps correctly', async () => {
    ;(mockClient.get as Mock).mockResolvedValueOnce({
      drafts: [{ id: 'd1', message: { id: 'm1', threadId: 't1', payload: { headers: [] } } }]
    })
    // Sequential get mock for detail resolving
    ;(mockClient.get as Mock).mockResolvedValue({ id: 'd1', message: { id: 'm1', threadId: 't1', payload: { headers: [] } } })

    const result = await listDrafts(mockClient, 5)
    expect(mockClient.get).toHaveBeenCalledWith('/drafts', { maxResults: 5 })
    expect(result.drafts.length).toBe(1)
    expect(result.drafts[0].id).toBe('d1')
  })

  test('getDraft fetches /drafts/{id} with format full', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({
      id: 'd1',
      message: { id: 'm1', threadId: 't1', snippet: 'hi' }
    })
    
    const draftContent = await getDraft(mockClient, 'd1')
    expect(mockClient.get).toHaveBeenCalledWith('/drafts/d1', { format: 'full' })
    expect(draftContent.id).toBe('d1')
  })

  test('createDraft calls /drafts', async () => {
    vi.mocked(mimeUtils.buildMimeMessage).mockReturnValue('raw')
    vi.mocked(mimeUtils.toBase64Url).mockReturnValue('base64')
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'd-new' })

    const opts = { to: ['test@local'], subject: 'S', body: 'B' }
    const draft = await createDraft(mockClient, opts)
    
    expect(mimeUtils.buildMimeMessage).toHaveBeenCalledWith(expect.objectContaining(opts))
    expect(mockClient.post).toHaveBeenCalledWith('/drafts', { message: { raw: 'base64' } })
    expect(draft.id).toBe('d-new')
  })

  test('updateDraft calls PUT /drafts/{id}', async () => {
    // Requires getting the old draft first to fetch headers/raw?
    ;(mockClient.get as Mock).mockResolvedValue({
      id: 'd1',
      message: { id: 'm1', payload: { headers: [{ name: 'To', value: 'old@local' }] } }
    })
    vi.mocked(mimeUtils.buildMimeMessage).mockReturnValue('raw')
    vi.mocked(mimeUtils.toBase64Url).mockReturnValue('base64')
    ;(mockClient.put as Mock).mockResolvedValue({ id: 'd1' })

    await updateDraft(mockClient, 'd1', { to: ['new@local'] })
    expect(mockClient.put).toHaveBeenCalledWith('/drafts/d1', { message: { raw: 'base64' } })
  })

  test('sendDraft calls /drafts/send', async () => {
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'sent-msg' })
    await sendDraft(mockClient, 'draft123')
    expect(mockClient.post).toHaveBeenCalledWith('/drafts/send', { id: 'draft123' })
  })

  test('deleteDraft calls /drafts/{id}', async () => {
    await deleteDraft(mockClient, 'draft123')
    expect(mockClient.delete).toHaveBeenCalledWith('/drafts/draft123')
  })
})
