// Gmail attachment operations

import type { HttpClient } from '../../utils/http.js'
import type { AttachmentSummary, AttachmentDetail } from '../types.js'
import { base64UrlToBuffer, type GmailPayload } from '../../utils/mime.js'
import { writeFileSync } from 'node:fs'

interface GmailAttachment {
  attachmentId: string
  size: number
  data: string // base64url encoded
}

export async function listAttachments(
  client: HttpClient,
  messageId: string,
): Promise<AttachmentSummary[]> {
  // Get message metadata to find attachments
  const msg = await client.get<{ payload?: GmailPayload }>(`/messages/${messageId}`, {
    format: 'full',
  })

  return extractAttachments(msg.payload)
}

export async function getAttachment(
  client: HttpClient,
  messageId: string,
  attachmentId: string,
): Promise<AttachmentDetail> {
  const attachment = await client.get<GmailAttachment>(
    `/messages/${messageId}/attachments/${attachmentId}`,
  )

  // Get filename from message metadata
  const msg = await client.get<{ payload?: GmailPayload }>(`/messages/${messageId}`, {
    format: 'metadata',
  })
  const attachments = extractAttachments(msg.payload)
  const meta = attachments.find((a) => a.id === attachmentId)

  return {
    id: attachmentId,
    name: meta?.name || 'attachment',
    contentType: meta?.contentType || 'application/octet-stream',
    size: attachment.size,
    content: attachment.data, // base64url encoded data
  }
}

export async function downloadAttachment(
  client: HttpClient,
  messageId: string,
  attachmentId: string,
  outputPath: string,
): Promise<string> {
  const attachment = await getAttachment(client, messageId, attachmentId)
  const buffer = base64UrlToBuffer(attachment.content || '')
  writeFileSync(outputPath, buffer)
  return outputPath
}

// --- Helpers ---

function extractAttachments(payload?: GmailPayload): AttachmentSummary[] {
  if (!payload) return []
  const attachments: AttachmentSummary[] = []

  function walk(p: GmailPayload): void {
    if (p.filename && p.filename.length > 0 && p.body?.attachmentId) {
      attachments.push({
        id: p.body.attachmentId,
        name: p.filename,
        contentType: p.mimeType || 'application/octet-stream',
        size: p.body.size || 0,
      })
    }
    if (p.parts) {
      for (const part of p.parts) {
        walk(part)
      }
    }
  }

  walk(payload)
  return attachments
}
