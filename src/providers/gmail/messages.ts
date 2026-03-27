// Gmail message operations

import type { HttpClient } from '../../utils/http.js'
import type {
  MessageSummary,
  MessageDetail,
  SendMessageOptions,
  ListOptions,
  EmailAddress,
} from '../types.js'
import {
  buildMimeMessage,
  toBase64Url,
  extractTextFromPayload,
  getHeader,
  type GmailPayload,
} from '../../utils/mime.js'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

// --- Gmail API response types ---

interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  payload?: GmailPayload
  sizeEstimate?: number
  historyId?: string
  internalDate?: string
  raw?: string
}

interface GmailMessageList {
  messages?: Array<{ id: string; threadId: string }>
  nextPageToken?: string
  resultSizeEstimate?: number
}

// --- Operations ---

export async function listMessages(
  client: HttpClient,
  options: ListOptions = {},
): Promise<{ messages: MessageSummary[]; nextPageToken?: string }> {
  const query: Record<string, string | number | boolean | undefined> = {
    maxResults: options.top || 20,
  }

  if (options.query) {
    query.q = options.query
  }
  if (options.folder) {
    query.labelIds = options.folder
  }
  if (options.skip) {
    // Gmail uses pageToken, not skip. We'll just note this.
    // For simplicity, we ignore skip for Gmail.
  }

  const list = await client.get<GmailMessageList>('/messages', query)

  if (!list.messages || list.messages.length === 0) {
    return { messages: [], nextPageToken: list.nextPageToken }
  }

  // Fetch each message's metadata
  const messages = await Promise.all(
    list.messages.map((m) =>
      client.get<GmailMessage>(`/messages/${m.id}`, { format: 'metadata', metadataHeaders: 'From,To,Subject,Date' }),
    ),
  )

  return {
    messages: messages.map(normalizeMessageSummary),
    nextPageToken: list.nextPageToken,
  }
}

export async function getMessage(
  client: HttpClient,
  id: string,
): Promise<MessageDetail> {
  const msg = await client.get<GmailMessage>(`/messages/${id}`, { format: 'full' })
  return normalizeMessageDetail(msg)
}

export async function getMessageRaw(
  client: HttpClient,
  id: string,
): Promise<string> {
  const msg = await client.get<GmailMessage>(`/messages/${id}`, { format: 'raw' })
  if (msg.raw) {
    return Buffer.from(msg.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
  }
  return ''
}

export async function sendMessage(
  client: HttpClient,
  options: SendMessageOptions,
): Promise<{ id: string; threadId: string }> {
  // Build MIME message
  let mime: string

  if (options.attachments && options.attachments.length > 0) {
    mime = buildMimeWithAttachments(options)
  } else {
    mime = buildMimeMessage({
      to: options.to,
      cc: options.cc,
      bcc: options.bcc,
      subject: options.subject,
      body: options.body,
      contentType: options.bodyType === 'html' ? 'text/html' : 'text/plain',
    })
  }

  const raw = toBase64Url(mime)

  const result = await client.post<GmailMessage>('/messages/send', { raw })
  return { id: result.id, threadId: result.threadId }
}

export async function replyToMessage(
  client: HttpClient,
  messageId: string,
  body: string,
  replyAll = false,
): Promise<{ id: string; threadId: string }> {
  // Get original message to extract headers
  const original = await getMessage(client, messageId)

  const to = replyAll
    ? [original.from, ...(original.to || []), ...(original.cc || [])].map((a) => a.address)
    : [original.from.address]

  const subject = original.subject.startsWith('Re:')
    ? original.subject
    : `Re: ${original.subject}`

  const mime = buildMimeMessage({
    to,
    subject,
    body,
    inReplyTo: original.internetMessageId,
    references: original.internetMessageId,
  })

  const raw = toBase64Url(mime)

  const result = await client.post<GmailMessage>('/messages/send', {
    raw,
    threadId: original.threadId,
  })
  return { id: result.id, threadId: result.threadId }
}

export async function forwardMessage(
  client: HttpClient,
  messageId: string,
  to: string[],
  body?: string,
): Promise<{ id: string; threadId: string }> {
  const original = await getMessage(client, messageId)
  const rawOriginal = await getMessageRaw(client, messageId)

  const forwardBody = body
    ? `${body}\n\n---------- Forwarded message ----------\n${rawOriginal}`
    : `---------- Forwarded message ----------\n${rawOriginal}`

  const subject = original.subject.startsWith('Fwd:')
    ? original.subject
    : `Fwd: ${original.subject}`

  const mime = buildMimeMessage({
    to,
    subject,
    body: forwardBody,
  })

  const raw = toBase64Url(mime)
  const result = await client.post<GmailMessage>('/messages/send', { raw })
  return { id: result.id, threadId: result.threadId }
}

export async function deleteMessage(
  client: HttpClient,
  id: string,
  permanent = false,
): Promise<void> {
  if (permanent) {
    await client.delete(`/messages/${id}`)
  } else {
    await client.post(`/messages/${id}/trash`)
  }
}

export async function moveMessage(
  client: HttpClient,
  id: string,
  addLabels: string[],
  removeLabels: string[],
): Promise<void> {
  await client.post(`/messages/${id}/modify`, {
    addLabelIds: addLabels,
    removeLabelIds: removeLabels,
  })
}

export async function markMessage(
  client: HttpClient,
  id: string,
  options: { read?: boolean; flagged?: boolean },
): Promise<void> {
  const addLabelIds: string[] = []
  const removeLabelIds: string[] = []

  if (options.read === true) {
    removeLabelIds.push('UNREAD')
  } else if (options.read === false) {
    addLabelIds.push('UNREAD')
  }

  if (options.flagged === true) {
    addLabelIds.push('STARRED')
  } else if (options.flagged === false) {
    removeLabelIds.push('STARRED')
  }

  if (addLabelIds.length > 0 || removeLabelIds.length > 0) {
    await client.post(`/messages/${id}/modify`, { addLabelIds, removeLabelIds })
  }
}

export async function searchMessages(
  client: HttpClient,
  query: string,
  top = 20,
): Promise<{ messages: MessageSummary[]; nextPageToken?: string }> {
  return listMessages(client, { query, top })
}

export async function batchDeleteMessages(
  client: HttpClient,
  ids: string[],
): Promise<void> {
  await client.post('/messages/batchDelete', { ids })
}

export async function importMessage(
  client: HttpClient,
  rawMime: string,
): Promise<{ id: string }> {
  const raw = toBase64Url(rawMime)
  const result = await client.post<GmailMessage>('/messages/import', { raw })
  return { id: result.id }
}

export async function untrashMessage(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.post(`/messages/${id}/untrash`)
}

export async function trashMessage(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.post(`/messages/${id}/trash`)
}

export async function batchModifyMessages(
  client: HttpClient,
  ids: string[],
  addLabelIds?: string[],
  removeLabelIds?: string[],
): Promise<void> {
  await client.post('/messages/batchModify', {
    ids,
    addLabelIds: addLabelIds || [],
    removeLabelIds: removeLabelIds || [],
  })
}

export async function insertMessage(
  client: HttpClient,
  rawMime: string,
): Promise<{ id: string }> {
  const raw = toBase64Url(rawMime)
  const result = await client.post<GmailMessage>('/messages/insert', { raw })
  return { id: result.id }
}

// --- Helpers ---

function parseEmailAddress(raw: string): EmailAddress {
  const match = raw.match(/^(.+?)\s*<(.+?)>$/)
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ''), address: match[2] }
  }
  return { address: raw.trim() }
}

function parseEmailAddresses(raw: string): EmailAddress[] {
  if (!raw) return []
  return raw.split(',').map((addr) => parseEmailAddress(addr.trim()))
}

function normalizeMessageSummary(msg: GmailMessage): MessageSummary {
  const headers = msg.payload?.headers || []
  return {
    id: msg.id,
    subject: getHeader(headers, 'Subject') || '(no subject)',
    from: parseEmailAddress(getHeader(headers, 'From')),
    to: parseEmailAddresses(getHeader(headers, 'To')),
    date: getHeader(headers, 'Date') || new Date(parseInt(msg.internalDate || '0')).toISOString(),
    snippet: msg.snippet,
    isRead: !(msg.labelIds || []).includes('UNREAD'),
    hasAttachments: hasAttachments(msg.payload),
    labels: msg.labelIds,
  }
}

function normalizeMessageDetail(msg: GmailMessage): MessageDetail {
  const headers = msg.payload?.headers || []
  const body = msg.payload ? extractTextFromPayload(msg.payload) : ''
  const bodyType = detectBodyType(msg.payload) || 'text'

  return {
    id: msg.id,
    subject: getHeader(headers, 'Subject') || '(no subject)',
    from: parseEmailAddress(getHeader(headers, 'From')),
    to: parseEmailAddresses(getHeader(headers, 'To')),
    cc: parseEmailAddresses(getHeader(headers, 'Cc')),
    bcc: parseEmailAddresses(getHeader(headers, 'Bcc')),
    date: getHeader(headers, 'Date') || new Date(parseInt(msg.internalDate || '0')).toISOString(),
    snippet: msg.snippet,
    isRead: !(msg.labelIds || []).includes('UNREAD'),
    hasAttachments: hasAttachments(msg.payload),
    labels: msg.labelIds,
    body,
    bodyType,
    threadId: msg.threadId,
    internetMessageId: getHeader(headers, 'Message-ID'),
    importance: getHeader(headers, 'Importance') || undefined,
    attachments: extractAttachmentSummaries(msg.payload),
    headers: headersToRecord(headers),
  }
}

function hasAttachments(payload?: GmailPayload): boolean {
  if (!payload) return false
  if (payload.body?.attachmentId) return true
  if (payload.parts) {
    return payload.parts.some(
      (p) => (p.filename && p.filename.length > 0 && p.body?.attachmentId) || hasAttachments(p),
    )
  }
  return false
}

function detectBodyType(payload?: GmailPayload): 'text' | 'html' | null {
  if (!payload) return null
  if (payload.mimeType === 'text/html') return 'html'
  if (payload.mimeType === 'text/plain') return 'text'
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html') return 'html'
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain') return 'text'
    }
  }
  return 'text'
}

function extractAttachmentSummaries(
  payload?: GmailPayload,
): Array<{ id: string; name: string; contentType: string; size: number }> {
  if (!payload) return []
  const attachments: Array<{ id: string; name: string; contentType: string; size: number }> = []

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

function headersToRecord(
  headers: Array<{ name: string; value: string }>,
): Record<string, string> {
  const record: Record<string, string> = {}
  for (const h of headers) {
    record[h.name] = h.value
  }
  return record
}

function buildMimeWithAttachments(options: SendMessageOptions): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2)}`
  const lines: string[] = []

  lines.push(`To: ${options.to.join(', ')}`)
  if (options.cc?.length) lines.push(`Cc: ${options.cc.join(', ')}`)
  if (options.bcc?.length) lines.push(`Bcc: ${options.bcc.join(', ')}`)
  lines.push(`Subject: ${options.subject}`)
  lines.push(`MIME-Version: 1.0`)
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
  lines.push('')
  lines.push(`--${boundary}`)
  lines.push(`Content-Type: ${options.bodyType === 'html' ? 'text/html' : 'text/plain'}; charset=utf-8`)
  lines.push(`Content-Transfer-Encoding: base64`)
  lines.push('')
  lines.push(Buffer.from(options.body, 'utf-8').toString('base64'))
  lines.push('')

  for (const attachment of options.attachments || []) {
    const content = readFileSync(attachment.path)
    const name = attachment.name || basename(attachment.path)
    lines.push(`--${boundary}`)
    lines.push(`Content-Type: application/octet-stream; name="${name}"`)
    lines.push(`Content-Disposition: attachment; filename="${name}"`)
    lines.push(`Content-Transfer-Encoding: base64`)
    lines.push('')
    lines.push(content.toString('base64'))
    lines.push('')
  }

  lines.push(`--${boundary}--`)

  return lines.join('\r\n')
}
