import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ruleCreate,
  ruleDelete,
  ruleGet,
  ruleUpdate,
} from '../../src/commands/rule'
import {
  attachmentAdd,
  attachmentDelete,
  attachmentDownload,
  attachmentGet,
  attachmentList,
} from '../../src/commands/attachment'
import * as resolveModule from '../../src/commands/resolve'
import * as formatter from '../../src/output/formatter'
import * as gmailFilters from '../../src/providers/gmail/filters'
import * as outlookRules from '../../src/providers/outlook/rules'
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
vi.mock('../../src/providers/gmail/filters', () => ({
  getFilter: vi.fn(),
  createFilter: vi.fn(),
  deleteFilter: vi.fn(),
}))
vi.mock('../../src/providers/outlook/rules', () => ({
  getRule: vi.fn(),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
}))
vi.mock('../../src/providers/gmail/attachments', () => ({
  listAttachments: vi.fn(),
  getAttachmentInfo: vi.fn(),
  downloadAttachment: vi.fn(),
}))
vi.mock('../../src/providers/outlook/attachments', () => ({
  listAttachments: vi.fn(),
  getAttachment: vi.fn(),
  downloadAttachment: vi.fn(),
  addAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
}))
vi.mock('../../src/utils/error', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/utils/error')>(),
  handleError: vi.fn((error: unknown) => { throw error }),
}))

describe('rule command branches', () => {
  const client = {} as never

  beforeEach(() => vi.clearAllMocks())

  function useAccount(provider: 'gmail' | 'outlook', scopes: string[] = []): void {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: {
        id: `${provider}-1`,
        provider,
        status: 'active',
        scopes,
        tokens: {},
      } as never,
      client,
    })
  }

  test.each(['gmail', 'outlook'] as const)('ruleGet routes %s', async (provider) => {
    useAccount(provider)
    const result = { id: 'rule-1', name: 'Rule' }
    if (provider === 'gmail') vi.mocked(gmailFilters.getFilter).mockResolvedValue(result as never)
    else vi.mocked(outlookRules.getRule).mockResolvedValue(result as never)

    await ruleGet('rule-1', {})

    if (provider === 'gmail') expect(gmailFilters.getFilter).toHaveBeenCalledWith(client, 'rule-1')
    else expect(outlookRules.getRule).toHaveBeenCalledWith(client, 'rule-1')
    expect(formatter.output).toHaveBeenCalledWith(result)
  })

  test('ruleCreate creates a Gmail filter', async () => {
    useAccount('gmail')
    vi.mocked(gmailFilters.createFilter).mockResolvedValue({ id: 'filter-1' } as never)

    await ruleCreate({ json: '{"conditions":{"from":"boss@example.test"}}' })

    expect(gmailFilters.createFilter).toHaveBeenCalledWith(client, {
      conditions: { from: 'boss@example.test' },
    })
    expect(formatter.outputSuccess).toHaveBeenCalledWith('Filter created (id: filter-1)')
  })

  test('ruleCreate creates an Outlook rule', async () => {
    useAccount('outlook')
    vi.mocked(outlookRules.createRule).mockResolvedValue({ id: 'rule-1', name: 'Move it' } as never)

    await ruleCreate({ json: '{"displayName":"Move it"}' })

    expect(outlookRules.createRule).toHaveBeenCalledWith(client, { displayName: 'Move it' })
    expect(formatter.outputSuccess).toHaveBeenCalledWith('Rule created (id: rule-1, name: Move it)')
  })

  test('permanent-delete create requires confirmation before account resolution', async () => {
    await expect(ruleCreate({
      json: '{"actions":{"permanentDelete":true}}',
    })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })

    expect(resolveModule.resolveAccount).not.toHaveBeenCalled()
  })

  test('permanent-delete create requires Outlook and its capability', async () => {
    useAccount('gmail', ['https://mail.google.com/'])
    await expect(ruleCreate({
      json: '{"actions":{"permanentDelete":true}}',
      yes: true,
    })).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })

    useAccount('outlook')
    await expect(ruleCreate({
      json: '{"actions":{"permanentDelete":true}}',
      yes: true,
    })).rejects.toMatchObject({ code: 'CAPABILITY_REQUIRED' })
  })

  test('permanent-delete create succeeds for authorized Outlook', async () => {
    useAccount('outlook', ['Mail.ReadWrite'])
    vi.mocked(outlookRules.createRule).mockResolvedValue({ id: 'rule-2', name: 'Destroy' } as never)

    await ruleCreate({
      json: '{"actions":{"permanentDelete":true}}',
      yes: true,
    })

    expect(outlookRules.createRule).toHaveBeenCalledWith(client, {
      actions: { permanentDelete: true },
    })
  })

  test('ruleUpdate explains that Gmail filters cannot be updated', async () => {
    useAccount('gmail')

    await expect(ruleUpdate('filter-1', { json: '{"conditions":{}}' })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      provider: 'gmail',
    })
    expect(outlookRules.updateRule).not.toHaveBeenCalled()
  })

  test('ruleUpdate updates an Outlook rule', async () => {
    useAccount('outlook')
    vi.mocked(outlookRules.updateRule).mockResolvedValue({ id: 'rule-1' } as never)

    await ruleUpdate('rule-1', { json: '{"isEnabled":false}' })

    expect(outlookRules.updateRule).toHaveBeenCalledWith(client, 'rule-1', { isEnabled: false })
    expect(formatter.outputSuccess).toHaveBeenCalledWith('Rule updated (id: rule-1)')
  })

  test.each(['gmail', 'outlook'] as const)('ruleDelete routes %s', async (provider) => {
    useAccount(provider)

    await ruleDelete('rule-1', {})

    if (provider === 'gmail') expect(gmailFilters.deleteFilter).toHaveBeenCalledWith(client, 'rule-1')
    else expect(outlookRules.deleteRule).toHaveBeenCalledWith(client, 'rule-1')
    expect(formatter.outputSuccess).toHaveBeenCalledWith('Rule/Filter deleted: rule-1')
  })

  test.each(['not-json', '[]'])('rule JSON must be an object: %s', async (json) => {
    await expect(ruleCreate({ json })).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
    expect(resolveModule.resolveAccount).not.toHaveBeenCalled()
  })
})

describe('attachment command branches', () => {
  const client = {} as never

  beforeEach(() => vi.clearAllMocks())

  function useProvider(provider: 'gmail' | 'outlook'): void {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { id: `${provider}-1`, provider } as never,
      client,
    })
  }

  test('lists Outlook attachment metadata and formats byte/megabyte cells', async () => {
    useProvider('outlook')
    vi.mocked(outlookAttachments.listAttachments).mockResolvedValue([
      { id: 'small', name: 'tiny.txt', contentType: 'text/plain', size: 100 },
      { id: 'large', name: 'large.bin', contentType: 'application/octet-stream', size: 2_097_152 },
    ] as never)

    await attachmentList('message-1', {})

    expect(outlookAttachments.listAttachments).toHaveBeenCalledWith(client, 'message-1')
    const [items, columns] = vi.mocked(formatter.outputList).mock.calls[0]
    const sizeColumn = columns.find((column) => column.key === 'size')!
    expect(sizeColumn.format?.(100, items[0])).toBe('100 B')
    expect(sizeColumn.format?.(2_097_152, items[1])).toBe('2.0 MB')
  })

  test('gets Outlook attachment detail', async () => {
    useProvider('outlook')
    vi.mocked(outlookAttachments.getAttachment).mockResolvedValue({
      id: 'attachment-1',
      name: 'report.pdf',
      contentType: 'application/pdf',
      size: 10,
      attachmentType: 'file',
    })

    await attachmentGet('message-1', 'attachment-1', {})

    expect(outlookAttachments.getAttachment).toHaveBeenCalledWith(
      client,
      'message-1',
      'attachment-1',
    )
    expect(formatter.output).toHaveBeenCalledWith({
      id: 'attachment-1',
      name: 'report.pdf',
      contentType: 'application/pdf',
      size: 10,
    })
  })

  test.each(['gmail', 'outlook'] as const)('explicit download path routes %s without metadata lookup', async (provider) => {
    useProvider(provider)

    await attachmentDownload('message-1', 'attachment-1', {
      output: '/tmp/output.bin',
      force: false,
    })

    if (provider === 'gmail') {
      expect(gmailAttachments.getAttachmentInfo).not.toHaveBeenCalled()
      expect(gmailAttachments.downloadAttachment).toHaveBeenCalledWith(
        client, 'message-1', 'attachment-1', '/tmp/output.bin', { force: false },
      )
    } else {
      expect(outlookAttachments.getAttachment).not.toHaveBeenCalled()
      expect(outlookAttachments.downloadAttachment).toHaveBeenCalledWith(
        client, 'message-1', 'attachment-1', '/tmp/output.bin',
        { force: false, detail: undefined },
      )
    }
    expect(formatter.outputSuccess).toHaveBeenCalledWith(
      'Attachment downloaded to: /tmp/output.bin',
      { path: '/tmp/output.bin' },
    )
  })

  test('adds an Outlook attachment with default and explicit names', async () => {
    useProvider('outlook')
    vi.mocked(outlookAttachments.addAttachment)
      .mockResolvedValueOnce({ id: 'a1', name: 'report.pdf' } as never)
      .mockResolvedValueOnce({ id: 'a2', name: 'renamed.pdf' } as never)

    await attachmentAdd('message-1', { file: '/tmp/report.pdf' })
    await attachmentAdd('message-1', { file: '/tmp/report.pdf', name: 'renamed.pdf' })

    expect(outlookAttachments.addAttachment).toHaveBeenNthCalledWith(
      1, client, 'message-1', '/tmp/report.pdf', 'report.pdf',
    )
    expect(outlookAttachments.addAttachment).toHaveBeenNthCalledWith(
      2, client, 'message-1', '/tmp/report.pdf', 'renamed.pdf',
    )
    expect(formatter.outputSuccess).toHaveBeenNthCalledWith(
      1,
      'Attachment added: report.pdf (id: a1)',
    )
  })

  test('deletes an Outlook attachment', async () => {
    useProvider('outlook')

    await attachmentDelete('message-1', 'attachment-1', {})

    expect(outlookAttachments.deleteAttachment).toHaveBeenCalledWith(
      client,
      'message-1',
      'attachment-1',
    )
    expect(formatter.outputSuccess).toHaveBeenCalledWith('Attachment deleted: attachment-1')
  })

  test('rejects Gmail attachment mutation helpers', async () => {
    useProvider('gmail')

    await expect(attachmentAdd('message-1', { file: '/tmp/report.pdf' })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
    await expect(attachmentDelete('message-1', 'attachment-1', {})).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
    expect(outlookAttachments.addAttachment).not.toHaveBeenCalled()
    expect(outlookAttachments.deleteAttachment).not.toHaveBeenCalled()
  })
})
