import { describe, test, expect, beforeEach, vi } from 'vitest'
import { draftList, draftCreate, draftSend, draftUpdate } from '../../src/commands/draft'
import * as resolveModule from '../../src/commands/resolve'
import * as formatterModule from '../../src/output/formatter'
import * as gmailDrafts from '../../src/providers/gmail/drafts'
import * as outlookDrafts from '../../src/providers/outlook/drafts'
import { encodePageToken } from '../../src/utils/page-token'

vi.mock('../../src/commands/resolve', () => ({ resolveAccount: vi.fn() }))
vi.mock('../../src/output/formatter', () => ({
  output: vi.fn(),
  outputList: vi.fn(),
  outputSuccess: vi.fn(),
}))
vi.mock('../../src/utils/error', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/error')>()
  return { ...actual, handleError: vi.fn((error: unknown) => { throw error }) }
})
vi.mock('../../src/providers/gmail/drafts', () => ({
  listDrafts: vi.fn(),
  createDraft: vi.fn(),
  sendDraft: vi.fn(),
  updateDraft: vi.fn(),
}))
vi.mock('../../src/providers/outlook/drafts', () => ({
  listDrafts: vi.fn(),
  createDraft: vi.fn(),
  sendDraft: vi.fn(),
  updateDraft: vi.fn(),
}))

describe('Draft Command Handlers', () => {
  const dummyClient = {} as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('draftList routes to configured provider', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'gmail' } as any, client: dummyClient })
    vi.mocked(gmailDrafts.listDrafts).mockResolvedValue({ drafts: [] })
    await draftList({ top: '10' })
    expect(gmailDrafts.listDrafts).toHaveBeenCalledWith(dummyClient, { top: 10, pageToken: undefined })
    expect(formatterModule.outputList).toHaveBeenCalled()
  })

  test('draftList restores top from a v2 page token', async () => {
    const account = { id: 'gmail-1', provider: 'gmail' as const }
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: account as any, client: dummyClient })
    vi.mocked(gmailDrafts.listDrafts).mockResolvedValue({ drafts: [] })
    const pageToken = encodePageToken(account, 'draft.list', 'provider-next', { top: '13' })

    await draftList({ pageToken })

    expect(gmailDrafts.listDrafts).toHaveBeenCalledWith(dummyClient, {
      top: 13,
      pageToken: 'provider-next',
    })
  })

  test('draftUpdate requires body when changing body type', async () => {
    await expect(draftUpdate('draft-id', { bodyType: 'text' }))
      .rejects.toThrow('--body-type requires --body when updating a draft')
    expect(resolveModule.resolveAccount).not.toHaveBeenCalled()
  })

  test('draftCreate routes and passes options', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'outlook' } as any, client: dummyClient })
    vi.mocked(outlookDrafts.createDraft).mockResolvedValue({ id: 'd-new' } as any)
    
    await draftCreate({ to: ['test@example'], subject: 'S', bodyType: 'html', body: '<b>h</b>' })
    expect(outlookDrafts.createDraft).toHaveBeenCalledWith(dummyClient, {
      to: ['test@example'],
      subject: 'S',
      bodyType: 'html',
      body: '<b>h</b>',
      cc: undefined,
      bcc: undefined,
    })
    expect(formatterModule.outputSuccess).toHaveBeenCalledWith(expect.stringContaining('d-new'))
  })

  test('draftSend routes properly', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'gmail' } as any, client: dummyClient })
    vi.mocked(gmailDrafts.sendDraft).mockResolvedValue({ id: 'sent-msg' } as any)
    await draftSend('draft-id', {})
    expect(gmailDrafts.sendDraft).toHaveBeenCalledWith(dummyClient, 'draft-id')
    expect(formatterModule.outputSuccess).toHaveBeenCalled()
  })
})
