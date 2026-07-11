import { resolve } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { attachmentDownload, attachmentGet, attachmentList } from '../../src/commands/attachment'
import * as resolveModule from '../../src/commands/resolve'
import * as formatter from '../../src/output/formatter'
import * as gmailAttachments from '../../src/providers/gmail/attachments'
import * as outlookAttachments from '../../src/providers/outlook/attachments'

vi.mock('../../src/commands/resolve', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/commands/resolve')>(),
  resolveAccount: vi.fn(),
}))
vi.mock('../../src/output/formatter', () => ({
  output: vi.fn(),
  outputList: vi.fn(),
  outputSuccess: vi.fn(),
}))
vi.mock('../../src/providers/gmail/attachments', () => ({
  listAttachments: vi.fn(),
  getAttachmentInfo: vi.fn(),
  getAttachment: vi.fn(),
  downloadAttachment: vi.fn(),
}))
vi.mock('../../src/providers/outlook/attachments', () => ({
  listAttachments: vi.fn(),
  getAttachment: vi.fn(),
  downloadAttachment: vi.fn(),
  addAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
}))

describe('attachment command metadata and download routing', () => {
  const client = {} as never

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('Gmail attachment get uses metadata without requesting content', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'gmail' } as never,
      client,
    })
    vi.mocked(gmailAttachments.getAttachmentInfo).mockResolvedValue({
      id: 'a1',
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 4_096,
    })

    await attachmentGet('m1', 'a1', {})

    expect(gmailAttachments.getAttachmentInfo).toHaveBeenCalledTimes(1)
    expect(gmailAttachments.getAttachmentInfo).toHaveBeenCalledWith(client, 'm1', 'a1')
    expect(gmailAttachments.getAttachment).not.toHaveBeenCalled()
    expect(gmailAttachments.downloadAttachment).not.toHaveBeenCalled()
    expect(formatter.output).toHaveBeenCalledWith({
      id: 'a1',
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 4_096,
    })
  })

  test('attachment list keeps raw byte sizes and formats only the Markdown cell', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'gmail' } as never,
      client,
    })
    vi.mocked(gmailAttachments.listAttachments).mockResolvedValue([{
      id: 'a1',
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 1_536,
    }])

    await attachmentList('m1', {})

    const [items, columns] = vi.mocked(formatter.outputList).mock.calls[0]
    expect(items).toEqual([{
      id: 'a1',
      name: 'invoice.pdf',
      type: 'application/pdf',
      size: 1_536,
    }])
    expect(columns.find((column) => column.key === 'size')?.format?.(1_536, items[0])).toBe('1.5 KB')
  })

  test('Gmail default-name download fetches metadata once and content once', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'gmail' } as never,
      client,
    })
    vi.mocked(gmailAttachments.getAttachmentInfo).mockResolvedValue({
      id: 'a1',
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 4_096,
    })
    vi.mocked(gmailAttachments.downloadAttachment).mockResolvedValue('invoice.pdf')

    await attachmentDownload('m1', 'a1', { force: true })

    const outputPath = resolve(process.cwd(), 'invoice.pdf')
    expect(gmailAttachments.getAttachmentInfo).toHaveBeenCalledTimes(1)
    expect(gmailAttachments.getAttachment).not.toHaveBeenCalled()
    expect(gmailAttachments.downloadAttachment).toHaveBeenCalledTimes(1)
    expect(gmailAttachments.downloadAttachment).toHaveBeenCalledWith(
      client,
      'm1',
      'a1',
      outputPath,
      { force: true },
    )
  })

  test('Outlook default-name download passes its single metadata result through', async () => {
    const detail = {
      id: 'a1',
      name: 'report.pdf',
      contentType: 'application/pdf',
      size: 8_192,
      attachmentType: 'file' as const,
    }
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'outlook' } as never,
      client,
    })
    vi.mocked(outlookAttachments.getAttachment).mockResolvedValue(detail)
    vi.mocked(outlookAttachments.downloadAttachment).mockResolvedValue('report.pdf')

    await attachmentDownload('m1', 'a1', {})

    expect(outlookAttachments.getAttachment).toHaveBeenCalledTimes(1)
    expect(outlookAttachments.downloadAttachment).toHaveBeenCalledTimes(1)
    expect(outlookAttachments.downloadAttachment).toHaveBeenCalledWith(
      client,
      'm1',
      'a1',
      resolve(process.cwd(), 'report.pdf'),
      { force: undefined, detail },
    )
  })
})
