// Attachment commands

import { resolveAccount } from './resolve.js'
import { output, outputList, outputSuccess } from '../output/formatter.js'
import { handleError, ProviderError } from '../utils/error.js'
import * as gmailAttachments from '../providers/gmail/attachments.js'
import * as outlookAttachments from '../providers/outlook/attachments.js'
import { join, basename } from 'node:path'

export async function attachmentList(
  messageId: string,
  opts: { account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)

    if (account.provider === 'gmail') {
      const attachments = await gmailAttachments.listAttachments(client, messageId)
      outputList(
        attachments.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.contentType,
          size: formatSize(a.size),
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'Name' },
          { key: 'type', label: 'Type' },
          { key: 'size', label: 'Size' },
        ],
      )
    } else {
      const attachments = await outlookAttachments.listAttachments(client, messageId)
      outputList(
        attachments.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.contentType,
          size: formatSize(a.size),
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'Name' },
          { key: 'type', label: 'Type' },
          { key: 'size', label: 'Size' },
        ],
      )
    }
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

    if (account.provider === 'gmail') {
      const attachment = await gmailAttachments.getAttachment(client, messageId, attachmentId)
      output({
        id: attachment.id,
        name: attachment.name,
        contentType: attachment.contentType,
        size: attachment.size,
      })
    } else {
      const attachment = await outlookAttachments.getAttachment(client, messageId, attachmentId)
      output({
        id: attachment.id,
        name: attachment.name,
        contentType: attachment.contentType,
        size: attachment.size,
      })
    }
  } catch (error) {
    handleError(error)
  }
}

export async function attachmentDownload(
  messageId: string,
  attachmentId: string,
  opts: { output?: string; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)

    let outputPath = opts.output

    if (!outputPath) {
      if (account.provider === 'gmail') {
        const att = await gmailAttachments.getAttachment(client, messageId, attachmentId)
        outputPath = join(process.cwd(), att.name)
      } else {
        const att = await outlookAttachments.getAttachment(client, messageId, attachmentId)
        outputPath = join(process.cwd(), att.name)
      }
    }

    if (account.provider === 'gmail') {
      await gmailAttachments.downloadAttachment(client, messageId, attachmentId, outputPath)
    } else {
      await outlookAttachments.downloadAttachment(client, messageId, attachmentId, outputPath)
    }

    outputSuccess(`Attachment downloaded to: ${outputPath}`)
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
    if (account.provider !== 'outlook') {
      throw new ProviderError(
        'Adding attachments to existing messages is only supported for Outlook. For Gmail, use --attach when sending.',
        account.provider,
      )
    }
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
    if (account.provider !== 'outlook') {
      throw new ProviderError(
        'Deleting individual attachments is only supported for Outlook.',
        account.provider,
      )
    }
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
