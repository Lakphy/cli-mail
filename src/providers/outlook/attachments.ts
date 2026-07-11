// Outlook attachment operations via Microsoft Graph API

import type { HttpClient } from '../../utils/http.js'
import type { AttachmentSummary, AttachmentDetail } from '../types.js'
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
} from 'node:fs'
import { link, open, rename, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getRegularFileSize } from '../../utils/files.js'

export const SIMPLE_ATTACHMENT_LIMIT = 3 * 1024 * 1024
export const MAX_ATTACHMENT_SIZE = 150 * 1024 * 1024
export const UPLOAD_CHUNK_SIZE = 3_276_800

export type OutlookAttachmentType = 'file' | 'item' | 'reference' | 'unknown'

interface GraphAttachment {
  id: string
  name: string
  contentType?: string
  size: number
  isInline?: boolean
  contentBytes?: string
  sourceUrl?: string
  providerType?: string
  permission?: string
  previewUrl?: string
  thumbnailUrl?: string
  item?: unknown
  '@odata.type'?: string
}

interface GraphAttachmentList {
  value: GraphAttachment[]
}

interface GraphUploadSession {
  uploadUrl: string
  expirationDateTime?: string
  nextExpectedRanges?: string[]
}

export interface OutlookAttachmentSummary extends AttachmentSummary {
  attachmentType: OutlookAttachmentType
  sourceUrl?: string
}

export interface OutlookAttachmentDetail extends AttachmentDetail {
  attachmentType: OutlookAttachmentType
  sourceUrl?: string
  providerType?: string
  permission?: string
  previewUrl?: string
  thumbnailUrl?: string
  item?: unknown
}

export async function listAttachments(
  client: HttpClient,
  messageId: string,
): Promise<OutlookAttachmentSummary[]> {
  const list = await client.get<GraphAttachmentList>(
    `/messages/${encodeURIComponent(messageId)}/attachments`,
    { '$select': 'id,name,contentType,size,isInline' },
  )
  return (list.value || []).map(normalizeAttachment)
}

export async function getAttachment(
  client: HttpClient,
  messageId: string,
  attachmentId: string,
): Promise<OutlookAttachmentDetail> {
  const path = `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
  let attachment = await client.get<GraphAttachment>(
    path,
    { '$select': 'id,name,contentType,size,isInline' },
  )
  // A full reference attachment response is small and carries the URL/preview
  // metadata needed to explain why `/$value` cannot be downloaded. Avoid a
  // full fileAttachment response because it would include large contentBytes.
  if (attachmentType(attachment) === 'reference' && !attachment.sourceUrl) {
    attachment = await client.get<GraphAttachment>(path)
  }
  return normalizeAttachmentDetail(attachment)
}

async function getDownloadResponse(
  client: HttpClient,
  messageId: string,
  attachmentId: string,
  prefetchedDetail?: OutlookAttachmentDetail,
): Promise<Response> {
  if (prefetchedDetail && prefetchedDetail.id !== attachmentId) {
    throw new TypeError('Prefetched Outlook attachment does not match the requested attachment')
  }
  const attachment = prefetchedDetail
    ?? await getAttachment(client, messageId, attachmentId)
  if (attachment.attachmentType === 'reference') {
    const target = attachment.sourceUrl ? ` (${attachment.sourceUrl})` : ''
    throw new TypeError(`Reference attachments cannot be downloaded as file content${target}`)
  }
  if (attachment.attachmentType === 'unknown') {
    throw new TypeError('Unsupported Outlook attachment type')
  }

  return client.getRaw(
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`,
  )
}

export async function downloadAttachment(
  client: HttpClient,
  messageId: string,
  attachmentId: string,
  outputPath: string,
  options: { force?: boolean; detail?: OutlookAttachmentDetail } = {},
): Promise<string> {
  const response = await getDownloadResponse(
    client,
    messageId,
    attachmentId,
    options.detail,
  )
  if (!response.body) throw new Error('Outlook attachment response did not contain a body')

  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}.part`,
  )
  const file = await open(temporaryPath, 'wx', 0o600)
  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      file.createWriteStream(),
    )
  } catch (error) {
    await file.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
  await file.close().catch(() => undefined)
  try {
    if (options.force) {
      await rename(temporaryPath, outputPath)
    } else {
      await link(temporaryPath, outputPath)
      await rm(temporaryPath, { force: true })
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
  return outputPath
}

/**
 * Add a file attachment using the simple API below 3 MiB and an Outlook upload
 * session from 3 MiB through 150 MiB.
 */
export async function addAttachment(
  client: HttpClient,
  messageId: string,
  filePath: string,
  fileName: string,
): Promise<OutlookAttachmentSummary> {
  const size = getRegularFileSize(filePath, 'Outlook attachment', MAX_ATTACHMENT_SIZE)

  if (size < SIMPLE_ATTACHMENT_LIMIT) {
    const content = readFileSync(filePath)
    const attachment = await client.post<GraphAttachment>(
      `/messages/${encodeURIComponent(messageId)}/attachments`,
      {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: fileName,
        contentBytes: content.toString('base64'),
      },
    )
    return normalizeAttachment(attachment)
  }

  return uploadLargeAttachment(client, messageId, filePath, fileName, size)
}

export async function deleteAttachment(
  client: HttpClient,
  messageId: string,
  attachmentId: string,
): Promise<void> {
  await client.delete(
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  )
}

async function uploadLargeAttachment(
  client: HttpClient,
  messageId: string,
  filePath: string,
  fileName: string,
  size: number,
): Promise<OutlookAttachmentSummary> {
  const session = await client.post<GraphUploadSession>(
    `/messages/${encodeURIComponent(messageId)}/attachments/createUploadSession`,
    {
      AttachmentItem: {
        attachmentType: 'file',
        name: fileName,
        size,
      },
    },
  )
  validateUploadUrl(session.uploadUrl)

  const descriptor = openSync(filePath, 'r')
  let location: string | null = null
  try {
    for (let start = 0; start < size; start += UPLOAD_CHUNK_SIZE) {
      const length = Math.min(UPLOAD_CHUNK_SIZE, size - start)
      const chunk = Buffer.allocUnsafe(length)
      const bytesRead = readSync(descriptor, chunk, 0, length, start)
      if (bytesRead !== length) {
        throw new Error(`Attachment changed while uploading: expected ${length} bytes, read ${bytesRead}`)
      }

      const end = start + length - 1
      const response = await client.putRawUnauthenticated(
        session.uploadUrl,
        chunk,
        {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(length),
          'Content-Range': `bytes ${start}-${end}/${size}`,
        },
      )

      if (end === size - 1) {
        location = response.headers.get('Location')
      }
      // Consume any intermediate upload-session JSON so the connection can be
      // reused. The server dictates sequential ranges and fixed chunks satisfy
      // that contract without trusting response-provided arbitrary offsets.
      await response.arrayBuffer()
    }
  } finally {
    closeSync(descriptor)
  }

  if (!location) {
    throw new Error('Outlook completed the upload without returning an attachment Location')
  }

  const id = attachmentIdFromLocation(location)
  if (!id) {
    throw new Error('Outlook returned an invalid attachment Location')
  }

  return {
    id,
    name: fileName,
    contentType: 'application/octet-stream',
    size,
    isInline: false,
    attachmentType: 'file',
  }
}

function validateUploadUrl(uploadUrl: string): void {
  let url: URL
  try {
    url = new URL(uploadUrl)
  } catch {
    throw new TypeError('Microsoft Graph returned an invalid attachment upload URL')
  }

  if (
    url.protocol !== 'https:'
    || url.hostname !== 'outlook.office.com'
    || url.port !== ''
    || url.username !== ''
    || url.password !== ''
  ) {
    throw new TypeError('Microsoft Graph returned an untrusted attachment upload URL')
  }
}

function attachmentIdFromLocation(location: string): string | undefined {
  try {
    const path = decodeURIComponent(new URL(location).pathname)
    const match = /\/Attachments\('([^']+)'\)\/?$/i.exec(path)
    return match?.[1].replace(/''/g, "'")
  } catch {
    return undefined
  }
}

function attachmentType(att: GraphAttachment): OutlookAttachmentType {
  switch (att['@odata.type']?.replace(/^#/, '')) {
    case 'microsoft.graph.fileAttachment':
      return 'file'
    case 'microsoft.graph.itemAttachment':
      return 'item'
    case 'microsoft.graph.referenceAttachment':
      return 'reference'
    default:
      return 'unknown'
  }
}

function normalizeAttachment(att: GraphAttachment): OutlookAttachmentSummary {
  return {
    id: att.id,
    name: att.name,
    contentType: att.contentType || 'application/octet-stream',
    size: att.size,
    isInline: att.isInline,
    attachmentType: attachmentType(att),
    sourceUrl: att.sourceUrl,
  }
}

function normalizeAttachmentDetail(att: GraphAttachment): OutlookAttachmentDetail {
  return {
    ...normalizeAttachment(att),
    content: att.contentBytes,
    providerType: att.providerType,
    permission: att.permission,
    previewUrl: att.previewUrl,
    thumbnailUrl: att.thumbnailUrl,
    item: att.item,
  }
}
