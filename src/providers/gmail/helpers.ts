import type { AttachmentSummary, MessageSummary } from '../types.js'
import {
  getHeader,
  parseEmailAddress,
  parseEmailAddresses,
  type GmailPayload,
  type MimeAttachment,
} from '../../utils/mime.js'
import { errorMessage } from '../../utils/error.js'

interface GmailMessageSummarySource {
  id: string
  labelIds?: string[]
  snippet?: string
  payload?: GmailPayload
  internalDate?: string
}

interface ParsedAttachmentSource {
  filename?: string
  content: Buffer
  contentType: string
  contentDisposition?: string
  cid?: string
}

export interface GmailItemError {
  id: string
  message: string
}

/** Map while preserving input order and never exceeding the requested limit. */
export async function settledMapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(values.length)
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++
      try {
        results[index] = {
          status: 'fulfilled',
          value: await mapper(values[index], index),
        }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  const workerCount = Math.min(Math.max(1, limit), values.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

export function settledValuesAndErrors<T>(
  ids: readonly string[],
  results: Array<PromiseSettledResult<T>>,
): { values: T[]; errors: GmailItemError[] } {
  const values: T[] = []
  const errors: GmailItemError[] = []

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      values.push(result.value)
    } else {
      errors.push({
        id: ids[index] ?? '',
        message: errorMessage(result.reason),
      })
    }
  })
  return { values, errors }
}

export function extractGmailAttachments(
  payload?: GmailPayload,
): AttachmentSummary[] {
  if (!payload) return []

  const attachments = new Map<string, AttachmentSummary>()
  function walk(part: GmailPayload): void {
    const attachmentId = part.body?.attachmentId
    const disposition = getHeader(part.headers, 'Content-Disposition').toLowerCase()
    const isAttachmentPart = Boolean(
      attachmentId
      && (part.filename || disposition.includes('attachment')),
    )

    if (attachmentId && isAttachmentPart && !attachments.has(attachmentId)) {
      attachments.set(attachmentId, {
        id: attachmentId,
        name: part.filename || 'attachment',
        contentType: part.mimeType || 'application/octet-stream',
        size: part.body?.size ?? 0,
        isInline: disposition.includes('inline'),
      })
    }
    for (const child of part.parts ?? []) walk(child)
  }

  walk(payload)
  return [...attachments.values()]
}

export function payloadHasAttachments(payload?: GmailPayload): boolean {
  return extractGmailAttachments(payload).length > 0
}

/**
 * Normalize Gmail's millisecond timestamp.
 *
 * Missing, non-numeric, and out-of-range values consistently return
 * `undefined`. Callers whose public contract requires a string can adapt that
 * absence to an empty string at the boundary.
 */
export function normalizeInternalDate(value?: string): string | undefined {
  if (!value) return undefined
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp)) return undefined

  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function headersToRecord(
  headers: ReadonlyArray<{ name: string; value: string }>,
): Record<string, string> {
  return Object.fromEntries(headers.map((header) => [header.name, header.value]))
}

/** Remove control characters that could create extra MIME headers. */
export function sanitizeRemoteFilename(filename?: string): string | undefined {
  if (!filename) return undefined
  return filename.replace(/[\r\n\0]/g, '_') || 'attachment'
}

export function toMimeAttachments(
  attachments: readonly ParsedAttachmentSource[],
): MimeAttachment[] {
  return attachments.map((attachment) => ({
    filename: sanitizeRemoteFilename(attachment.filename),
    content: attachment.content,
    contentType: attachment.contentType,
    contentDisposition: attachment.contentDisposition === 'inline'
      ? 'inline'
      : 'attachment',
    cid: attachment.cid,
  }))
}

export function normalizeMessageSummary(
  message: GmailMessageSummarySource,
): MessageSummary {
  const headers = message.payload?.headers ?? []
  return {
    id: message.id,
    subject: getHeader(headers, 'Subject') || '(no subject)',
    from: parseEmailAddress(getHeader(headers, 'From')),
    to: parseEmailAddresses(getHeader(headers, 'To')),
    date: getHeader(headers, 'Date')
      || normalizeInternalDate(message.internalDate)
      || '',
    snippet: message.snippet,
    isRead: !(message.labelIds ?? []).includes('UNREAD'),
    hasAttachments: payloadHasAttachments(message.payload),
    labels: message.labelIds,
  }
}
