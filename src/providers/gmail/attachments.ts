// Gmail attachment operations

import type { HttpClient } from '../../utils/http.js'
import type { AttachmentSummary, AttachmentDetail } from '../types.js'
import { base64UrlToBuffer, type GmailPayload } from '../../utils/mime.js'
import { writeFile } from 'node:fs/promises'
import { extractGmailAttachments } from './helpers.js'
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
  const msg = await client.get<{ payload?: GmailPayload }>(`/messages/${messageId}`, {
    format: 'full',
  })

  return extractGmailAttachments(msg.payload)
}

export async function getAttachmentInfo(
  client: HttpClient,
  messageId: string,
  attachmentId: string,
): Promise<AttachmentSummary> {
  const msg = await client.get<{ payload?: GmailPayload }>(`/messages/${messageId}`, {
    format: 'full',
  })
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
      `/messages/${messageId}/attachments/${attachmentId}`,
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
    `/messages/${messageId}/attachments/${attachmentId}`,
  )
  await writeFile(outputPath, base64UrlToBuffer(attachment.data), {
    flag: options.force ? 'w' : 'wx',
    mode: 0o600,
  })
  return outputPath
}
