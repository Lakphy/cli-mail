// Gmail attachment operations

import type { HttpClient } from '../../utils/http.js'
import type { AttachmentSummary, AttachmentDetail } from '../types.js'
import { base64UrlToBuffer, type GmailPayload } from '../../utils/mime.js'
import { link, open, rename, rm, type FileHandle } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { encodeGmailPathSegment, extractGmailAttachments } from './helpers.js'
import { ApiError } from '../../utils/error.js'

interface GmailAttachment {
  attachmentId: string
  size: number
  data: string // base64url encoded
}

export async function listAttachments(
  client: HttpClient,
  messageId: string,
): Promise<AttachmentSummary[]> {
  // MIME parts are only present in full responses, not format=metadata.
  const msg = await client.get<{ payload?: GmailPayload }>(
    `/messages/${encodeGmailPathSegment(messageId)}`,
    { format: 'full' },
  )

  return extractGmailAttachments(msg.payload)
}

export async function getAttachmentInfo(
  client: HttpClient,
  messageId: string,
  attachmentId: string,
): Promise<AttachmentSummary> {
  const msg = await client.get<{ payload?: GmailPayload }>(
    `/messages/${encodeGmailPathSegment(messageId)}`,
    { format: 'full' },
  )
  const attachment = extractGmailAttachments(msg.payload)
    .find((candidate) => candidate.id === attachmentId)
  if (!attachment) {
    throw new ApiError(`Gmail attachment not found: ${attachmentId}`, 404)
  }
  return attachment
}

export async function getAttachment(
  client: HttpClient,
  messageId: string,
  attachmentId: string,
): Promise<AttachmentDetail> {
  const [attachment, info] = await Promise.all([
    client.get<GmailAttachment>(
      attachmentPath(messageId, attachmentId),
    ),
    getAttachmentInfo(client, messageId, attachmentId),
  ])

  return {
    ...info,
    // Shared AttachmentDetail uses standard base64 (Outlook contentBytes has
    // the same representation); Gmail's base64url is normalized here.
    content: base64UrlToBuffer(attachment.data).toString('base64'),
  }
}

export async function downloadAttachment(
  client: HttpClient,
  messageId: string,
  attachmentId: string,
  outputPath: string,
  options: { force?: boolean } = {},
): Promise<string> {
  // A caller already supplied the target path, so downloading does not need a
  // second message-detail request just to discover the remote filename.
  const attachment = await client.get<GmailAttachment>(
    attachmentPath(messageId, attachmentId),
  )
  await atomicWrite(outputPath, base64UrlToBuffer(attachment.data), options.force === true)
  return outputPath
}

function attachmentPath(messageId: string, attachmentId: string): string {
  return `/messages/${encodeGmailPathSegment(messageId)}/attachments/${encodeGmailPathSegment(attachmentId)}`
}

/**
 * Publish a complete attachment atomically without ever opening the caller's
 * destination for writing. A forced rename replaces a symlink directory entry
 * itself, while the hard-link publication used without force is an atomic
 * no-clobber operation.
 */
async function atomicWrite(
  outputPath: string,
  content: Buffer,
  force: boolean,
): Promise<void> {
  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.cli-mail-${process.pid}-${randomUUID()}.tmp`,
  )
  let handle: FileHandle | undefined

  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = undefined

    if (force) {
      // POSIX rename replaces the symlink entry, never the file it points to.
      await rename(temporaryPath, outputPath)
    } else {
      // link(2) fails with EEXIST if any file or symlink already occupies the
      // destination, and only exposes the fully written inode.
      await link(temporaryPath, outputPath)
      await rm(temporaryPath)
    }
  } finally {
    await handle?.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
