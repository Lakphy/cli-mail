// Attachment commands

import { requireProvider, resolveAccount } from './resolve.js'
import { output, outputList, outputSuccess } from '../output/formatter.js'
import { handleError } from '../utils/error.js'
import * as gmailAttachments from '../providers/gmail/attachments.js'
import * as outlookAttachments from '../providers/outlook/attachments.js'
import { basename, resolve } from 'node:path'

export async function attachmentList(
  messageId: string,
  opts: { account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)

    const attachments = account.provider === 'gmail'
      ? await gmailAttachments.listAttachments(client, messageId)
      : await outlookAttachments.listAttachments(client, messageId)
    outputList(
      attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.contentType,
        size: attachment.size,
      })),
      [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name' },
        { key: 'type', label: 'Type' },
        {
          key: 'size',
          label: 'Size',
          format: (value) => formatSize(Number(value)),
        },
      ],
    )
  } catch (error) {
    handleError(error)
  }
}

export async function attachmentGet(
  messageId: string,
  attachmentId: string,
  opts: { account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)

    const attachment = account.provider === 'gmail'
      ? await gmailAttachments.getAttachmentInfo(client, messageId, attachmentId)
      : await outlookAttachments.getAttachment(client, messageId, attachmentId)
    output({
      id: attachment.id,
      name: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
    })
  } catch (error) {
    handleError(error)
  }
}

export async function attachmentDownload(
  messageId: string,
  attachmentId: string,
  opts: { output?: string; force?: boolean; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)

    let outputPath = opts.output
    let outlookDetail: outlookAttachments.OutlookAttachmentDetail | undefined

    if (!outputPath) {
      if (account.provider === 'gmail') {
        const att = await gmailAttachments.getAttachmentInfo(client, messageId, attachmentId)
        outputPath = safeDefaultOutputPath(att.name, attachmentId)
      } else {
        outlookDetail = await outlookAttachments.getAttachment(client, messageId, attachmentId)
        outputPath = safeDefaultOutputPath(outlookDetail.name, attachmentId)
      }
    }

    if (account.provider === 'gmail') {
      await gmailAttachments.downloadAttachment(client, messageId, attachmentId, outputPath, { force: opts.force })
    } else {
      await outlookAttachments.downloadAttachment(client, messageId, attachmentId, outputPath, {
        force: opts.force,
        detail: outlookDetail,
      })
    }

    outputSuccess(`Attachment downloaded to: ${outputPath}`, { path: outputPath })
  } catch (error) {
    handleError(error)
  }
}

export async function attachmentAdd(
  messageId: string,
  opts: { file: string; name?: string; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(
      account,
      'outlook',
      'Adding attachments to existing messages is only supported for Outlook. For Gmail, use --attach when sending.',
    )
    const fileName = opts.name || basename(opts.file)
    const att = await outlookAttachments.addAttachment(client, messageId, opts.file, fileName)
    outputSuccess(`Attachment added: ${att.name} (id: ${att.id})`)
  } catch (error) {
    handleError(error)
  }
}

export async function attachmentDelete(
  messageId: string,
  attachmentId: string,
  opts: { account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(
      account,
      'outlook',
      'Deleting individual attachments is only supported for Outlook.',
    )
    await outlookAttachments.deleteAttachment(client, messageId, attachmentId)
    outputSuccess(`Attachment deleted: ${attachmentId}`)
  } catch (error) {
    handleError(error)
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function safeDefaultOutputPath(remoteName: string, attachmentId: string): string {
  return resolve(process.cwd(), sanitizeAttachmentFileName(remoteName, attachmentId))
}

export function sanitizeAttachmentFileName(remoteName: string, attachmentId: string): string {
  const fallback = `attachment-${attachmentId.replace(/[^a-zA-Z0-9._-]/g, '_') || 'download'}`
  let name = basename(remoteName)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .replace(/[. ]+$/g, '')

  if (!name || name === '.' || name === '..') name = fallback
  if (name.startsWith('.')) name = `attachment-${name.slice(1) || 'download'}`

  const stem = name.split('.')[0]?.toUpperCase()
  if (stem && /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) {
    name = `attachment-${name}`
  }
  if (name.length > 180) name = name.slice(0, 180).replace(/[. ]+$/g, '') || fallback
  return name
}
