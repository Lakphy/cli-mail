// Outlook attachment operations via Microsoft Graph API

import type { HttpClient } from '../../utils/http.js'
import type { AttachmentSummary, AttachmentDetail } from '../types.js'
import { writeFileSync } from 'node:fs'

interface GraphAttachment {
  id: string
  name: string
  contentType: string
  size: number
  isInline?: boolean
  contentBytes?: string // base64 encoded
  '@odata.type'?: string
}

interface GraphAttachmentList {
  value: GraphAttachment[]
}

export async function listAttachments(
  client: HttpClient,
  messageId: string,
): Promise<AttachmentSummary[]> {
  const list = await client.get<GraphAttachmentList>(
    `/messages/${messageId}/attachments`,
    { '$select': 'id,name,contentType,size,isInline' },
  )
  return (list.value || []).map(normalizeAttachment)
}

export async function getAttachment(
  client: HttpClient,
  messageId: string,
  attachmentId: string,
): Promise<AttachmentDetail> {
  const attachment = await client.get<GraphAttachment>(
    `/messages/${messageId}/attachments/${attachmentId}`,
  )
  return {
    id: attachment.id,
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
    isInline: attachment.isInline,
    content: attachment.contentBytes,
  }
}

export async function downloadAttachment(
  client: HttpClient,
  messageId: string,
  attachmentId: string,
  outputPath: string,
): Promise<string> {
  const attachment = await getAttachment(client, messageId, attachmentId)
  if (attachment.content) {
    const buffer = Buffer.from(attachment.content, 'base64')
    writeFileSync(outputPath, buffer)
  }
  return outputPath
}

export async function addAttachment(
  client: HttpClient,
  messageId: string,
  filePath: string,
  fileName: string,
): Promise<AttachmentSummary> {
  const { readFileSync } = await import('node:fs')
  const content = readFileSync(filePath)

  const attachment = await client.post<GraphAttachment>(
    `/messages/${messageId}/attachments`,
    {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: fileName,
      contentBytes: content.toString('base64'),
    },
  )
  return normalizeAttachment(attachment)
}

export async function deleteAttachment(
  client: HttpClient,
  messageId: string,
  attachmentId: string,
): Promise<void> {
  await client.delete(`/messages/${messageId}/attachments/${attachmentId}`)
}

function normalizeAttachment(att: GraphAttachment): AttachmentSummary {
  return {
    id: att.id,
    name: att.name,
    contentType: att.contentType,
    size: att.size,
    isInline: att.isInline,
  }
}
