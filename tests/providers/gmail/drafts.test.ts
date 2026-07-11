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

    const result = await listDrafts(mockClient, { top: 5, pageToken: 'next-page' })
    expect(mockClient.get).toHaveBeenCalledWith('/drafts', {
      maxResults: 5,
      pageToken: 'next-page',
    })
    expect(mockClient.get).toHaveBeenLastCalledWith('/drafts/d1', {
      format: 'metadata',
      metadataHeaders: ['To', 'Subject', 'Date'],
    })
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
    vi.mocked(mimeUtils.buildMimeMessage).mockResolvedValue(Buffer.from('raw'))
    vi.mocked(mimeUtils.toBase64Url).mockReturnValue('base64')
    ;(mockClient.post as Mock).mockResolvedValue({ id: 'd-new' })

    const opts = { to: ['test@local'], subject: 'S', body: 'B' }
    const draft = await createDraft(mockClient, opts)
    
    expect(mimeUtils.buildMimeMessage).toHaveBeenCalledWith(expect.objectContaining(opts))
    expect(mockClient.post).toHaveBeenCalledWith('/drafts', { message: { raw: 'base64' } })
    expect(draft.id).toBe('d-new')
  })

  test('updateDraft calls PUT /drafts/{id}', async () => {
    const currentRaw = Buffer.from([
      'To: old@local',
      'Subject: old',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'old body',
    ].join('\r\n'))
    ;(mockClient.get as Mock).mockResolvedValue({
      id: 'd1',
      message: { id: 'm1', threadId: 't1', raw: currentRaw.toString('base64url') }
    })
    vi.mocked(mimeUtils.buildMimeMessage).mockResolvedValue(Buffer.from('updated'))
    vi.mocked(mimeUtils.toBase64Url).mockReturnValue('base64')
    ;(mockClient.put as Mock).mockResolvedValue({ id: 'd1' })

    await updateDraft(mockClient, 'd1', { to: ['new@local'] })
    expect(mockClient.get).toHaveBeenCalledWith('/drafts/d1', { format: 'raw' })
    expect(mockClient.put).toHaveBeenCalledWith('/drafts/d1', {
      message: { raw: 'base64', threadId: 't1' },
    })
    expect(mimeUtils.buildMimeMessage).toHaveBeenCalledWith(expect.objectContaining({
      to: ['new@local'],
      subject: 'old',
      body: 'old body',
    }))
  })

  test('updateDraft preserves explicit empty subject and body', async () => {
    const currentRaw = Buffer.from('To: old@local\r\nSubject: old\r\n\r\nold')
    ;(mockClient.get as Mock).mockResolvedValue({
      id: 'd1',
      message: { id: 'm1', threadId: 't1', raw: currentRaw.toString('base64url') },
    })
    vi.mocked(mimeUtils.buildMimeMessage).mockResolvedValue(Buffer.from('updated'))
    vi.mocked(mimeUtils.toBase64Url).mockReturnValue('base64')
    ;(mockClient.put as Mock).mockResolvedValue({ id: 'd1' })

    await updateDraft(mockClient, 'd1', { subject: '', body: '' })
    expect(mimeUtils.buildMimeMessage).toHaveBeenCalledWith(expect.objectContaining({
      subject: '',
      body: '',
    }))
  })

  test('updateDraft refuses signed MIME', async () => {
    const signed = Buffer.from('Content-Type: multipart/signed; boundary=x\r\n\r\n--x--')
    ;(mockClient.get as Mock).mockResolvedValue({
      id: 'd1',
      message: { id: 'm1', threadId: 't1', raw: signed.toString('base64url') },
    })

    await expect(updateDraft(mockClient, 'd1', { subject: 'new' }))
      .rejects.toMatchObject({ code: 'UNSAFE_DRAFT_MUTATION' })
    expect(mockClient.put).not.toHaveBeenCalled()
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

  test('encodes draft ids before adding them to REST paths', async () => {
    const id = '../draft%2Fid?x#y'
    ;(mockClient.get as Mock).mockResolvedValue({
      id,
      message: { id: 'm1', threadId: 't1' },
    })

    await getDraft(mockClient, id)
    await deleteDraft(mockClient, id)
    const encoded = '..%2Fdraft%252Fid%3Fx%23y'
    expect(mockClient.get).toHaveBeenCalledWith(`/drafts/${encoded}`, { format: 'full' })
    expect(mockClient.delete).toHaveBeenCalledWith(`/drafts/${encoded}`)
  })
})
