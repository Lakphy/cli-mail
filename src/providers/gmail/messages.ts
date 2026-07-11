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
  base64UrlToBuffer,
  extractBodyFromPayload,
  formatEmailAddress,
  getHeader,
  parseEmailAddresses,
  parseMimeMessage,
  parsedAddressObjectToList,
  type GmailPayload,
} from '../../utils/mime.js'
import { CliMailError, ConfigError } from '../../utils/error.js'
import {
  extractGmailAttachments,
  encodeGmailPathSegment,
  headersToRecord,
  normalizeMessageSummary,
  settledMapWithConcurrency,
  settledValuesAndErrors,
  toMimeAttachments,
  type GmailItemError,
} from './helpers.js'

const DETAIL_CONCURRENCY = 8
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

export const attachmentLimits = {
  maxFileBytes: MAX_ATTACHMENT_BYTES,
  assertTotalSize(totalBytes: number): void {
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      throw new ConfigError('Gmail attachments exceed the combined 25 MiB limit')
    }
  },
}

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

export interface GmailMessageListResult {
  messages: MessageSummary[]
  nextPageToken?: string
  /** Per-message failures; successful items are still returned. */
  errors?: GmailItemError[]
}

export interface GmailReplyIdentity {
  email: string
  aliases?: string[]
}

export async function listMessages(
  client: HttpClient,
  options: ListOptions = {},
): Promise<GmailMessageListResult> {
  if (options.skip !== undefined) {
    throw new ConfigError(
      'Gmail does not support numeric skip pagination; use a page token instead.',
    )
  }
  const query: Record<string, string | number | boolean | string[] | undefined> = {
    maxResults: options.top ?? 20,
    q: options.query,
    labelIds: options.folder,
    pageToken: options.pageToken,
  }
  const list = await client.get<GmailMessageList>('/messages', query)
  const listed = list.messages ?? []

  if (listed.length === 0) {
    return { messages: [], nextPageToken: list.nextPageToken }
  }

  // format=metadata does not include MIME parts, so it cannot determine
  // whether a message has attachments. A narrowed full response provides both
  // headers and the part tree without fetching attachment contents.
  const settled = await settledMapWithConcurrency(
    listed,
    DETAIL_CONCURRENCY,
    (message) => client.get<GmailMessage>(
      `/messages/${encodeGmailPathSegment(message.id)}`,
      {
        format: 'full',
        fields: 'id,threadId,labelIds,snippet,internalDate,payload',
      },
    ),
  )
  const { values, errors } = settledValuesAndErrors(
    listed.map((message) => message.id),
    settled,
  )

  return {
    messages: values.map(normalizeMessageSummary),
    nextPageToken: list.nextPageToken,
    ...(errors.length > 0 ? { errors } : {}),
  }
}

export function listMessagesSince(
  client: HttpClient,
  sinceDate: Date,
  top: number,
  pageToken?: string,
): Promise<GmailMessageListResult> {
  return listMessages(client, {
    query: `after:${Math.floor(sinceDate.getTime() / 1000)}`,
    top,
    pageToken,
  })
}

/** List only Inbox messages received after the supplied time. */
export function listInboxMessagesSince(
  client: HttpClient,
  sinceDate: Date,
  top: number,
  pageToken?: string,
): Promise<GmailMessageListResult> {
  return listMessages(client, {
    folder: 'INBOX',
    query: `after:${Math.floor(sinceDate.getTime() / 1000)}`,
    top,
    pageToken,
  })
}

export async function getMessage(
  client: HttpClient,
  id: string,
): Promise<MessageDetail> {
  const message = await client.get<GmailMessage>(
    `/messages/${encodeGmailPathSegment(id)}`,
    { format: 'full' },
  )
  return normalizeMessageDetail(message)
}

/** Return the exact decoded RFC 5322 bytes supplied by Gmail. */
export async function getMessageRaw(
  client: HttpClient,
  id: string,
): Promise<Buffer> {
  const message = await client.get<GmailMessage>(
    `/messages/${encodeGmailPathSegment(id)}`,
    { format: 'raw' },
  )
  return message.raw ? base64UrlToBuffer(message.raw) : Buffer.alloc(0)
}

export async function sendMessage(
  client: HttpClient,
  options: SendMessageOptions,
): Promise<{ id: string; threadId: string }> {
  const mime = await buildMimeMessage({
    to: options.to,
    cc: options.cc,
    bcc: options.bcc,
    subject: options.subject,
    body: options.body,
    contentType: options.bodyType === 'html' ? 'text/html' : 'text/plain',
    attachments: options.attachments?.map((attachment) => ({
      filename: attachment.name || undefined,
      path: attachment.path,
      contentDisposition: 'attachment',
    })),
    headers: options.importance && options.importance !== 'normal'
      ? { Importance: options.importance }
      : undefined,
  })

  const result = await client.post<GmailMessage>('/messages/send', {
    raw: toBase64Url(mime),
  })
  return { id: result.id, threadId: result.threadId }
}

export async function replyToMessage(
  client: HttpClient,
  messageId: string,
  body: string,
  replyAll = false,
  identity?: GmailReplyIdentity,
  prefetchedMessage?: MessageDetail,
): Promise<{ id: string; threadId: string }> {
  const original = prefetchedMessage ?? await getMessage(client, messageId)
  const selfAddresses = collectSelfAddresses(original, identity)
  const sender = original.from

  const toCandidates = replyAll
    ? [sender, ...original.to]
    : [sender]
  const usedAddresses = new Set(selfAddresses)
  const to = dedupeAddresses(toCandidates, usedAddresses)
  const cc = replyAll
    ? dedupeAddresses(original.cc ?? [], usedAddresses)
    : []

  if (to.length === 0 && cc.length === 0) {
    throw new CliMailError(
      'No reply recipients remain after excluding the current account.',
      'INVALID_REPLY_RECIPIENTS',
    )
  }

  const subject = /^re:/i.test(original.subject)
    ? original.subject
    : `Re: ${original.subject}`
  const messageIdHeader = original.internetMessageId
  const references = mergeReferences(
    findRecordHeader(original.headers, 'References'),
    messageIdHeader,
  )

  const mime = await buildMimeMessage({
    to,
    cc,
    subject,
    body,
    inReplyTo: messageIdHeader,
    references,
  })

  const result = await client.post<GmailMessage>('/messages/send', {
    raw: toBase64Url(mime),
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
  const rawOriginal = await getMessageRaw(client, messageId)
  const original = await parseMimeMessage(rawOriginal)
  const forwardedHeaderLines = [
    '---------- Forwarded message ----------',
    original.from?.text ? `From: ${original.from.text}` : undefined,
    original.date ? `Date: ${original.date.toUTCString()}` : undefined,
    original.subject !== undefined ? `Subject: ${original.subject}` : undefined,
    original.to
      ? `To: ${parsedAddressObjectToList(original.to).map(formatEmailAddress).join(', ')}`
      : undefined,
    original.cc
      ? `Cc: ${parsedAddressObjectToList(original.cc).map(formatEmailAddress).join(', ')}`
      : undefined,
  ].filter((line): line is string => line !== undefined)
  const forwardedHeader = forwardedHeaderLines.join('\n')

  // Deliberately reconstruct rather than embedding the raw headers: Bcc and
  // provider-internal routing/authentication headers must not be forwarded.
  const forwardBody = [body, forwardedHeader, '', original.text ?? '']
    .filter((part) => part !== undefined)
    .join('\n')
  const forwardHtml = typeof original.html === 'string'
    ? [
        body ? `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>` : undefined,
        '<hr>',
        `<div>${forwardedHeaderLines.map(escapeHtml).join('<br>')}</div>`,
        '<br>',
        original.html,
      ].filter((part): part is string => part !== undefined).join('\n')
    : undefined
  const subject = /^fwd:/i.test(original.subject ?? '')
    ? original.subject ?? ''
    : `Fwd: ${original.subject ?? ''}`
  const attachments = toMimeAttachments(original.attachments)

  const mime = await buildMimeMessage({
    to,
    subject,
    body: !original.text && forwardHtml ? forwardHtml : forwardBody,
    contentType: !original.text && forwardHtml ? 'text/html' : 'text/plain',
    textBody: original.text ? forwardBody : undefined,
    htmlBody: forwardHtml,
    attachments,
  })
  const result = await client.post<GmailMessage>('/messages/send', {
    raw: toBase64Url(mime),
  })
  return { id: result.id, threadId: result.threadId }
}

export async function deleteMessage(
  client: HttpClient,
  id: string,
  permanent = false,
): Promise<void> {
  const encodedId = encodeGmailPathSegment(id)
  if (permanent) {
    await client.delete(`/messages/${encodedId}`)
  } else {
    await client.post(`/messages/${encodedId}/trash`)
  }
}

export async function moveMessage(
  client: HttpClient,
  id: string,
  destinationLabelId: string,
): Promise<void> {
  await client.post(`/messages/${encodeGmailPathSegment(id)}/modify`, {
    addLabelIds: [destinationLabelId],
    removeLabelIds: ['INBOX'],
  })
}

export async function markMessage(
  client: HttpClient,
  id: string,
  options: { read?: boolean; flagged?: boolean },
): Promise<void> {
  const addLabelIds: string[] = []
  const removeLabelIds: string[] = []

  if (options.read === true) removeLabelIds.push('UNREAD')
  else if (options.read === false) addLabelIds.push('UNREAD')
  if (options.flagged === true) addLabelIds.push('STARRED')
  else if (options.flagged === false) removeLabelIds.push('STARRED')

  if (addLabelIds.length > 0 || removeLabelIds.length > 0) {
    await client.post(`/messages/${encodeGmailPathSegment(id)}/modify`, {
      addLabelIds,
      removeLabelIds,
    })
  }
}

export async function searchMessages(
  client: HttpClient,
  query: string,
  top = 20,
  pageToken?: string,
): Promise<GmailMessageListResult> {
  return listMessages(client, { query, top, pageToken })
}

/** Default batch deletion is recoverable; permanent deletion is explicit. */
export async function batchDeleteMessages(
  client: HttpClient,
  ids: string[],
  permanent = false,
): Promise<void> {
  if (permanent) {
    await client.post('/messages/batchDelete', { ids })
    return
  }
  await client.post('/messages/batchModify', {
    ids,
    addLabelIds: ['TRASH'],
    removeLabelIds: ['INBOX'],
  })
}

export async function importMessage(
  client: HttpClient,
  rawMime: string | Buffer,
): Promise<{ id: string }> {
  const result = await client.post<GmailMessage>('/messages/import', {
    raw: toBase64Url(rawMime),
  })
  return { id: result.id }
}

export async function untrashMessage(client: HttpClient, id: string): Promise<void> {
  await client.post(`/messages/${encodeGmailPathSegment(id)}/untrash`)
}

export async function trashMessage(client: HttpClient, id: string): Promise<void> {
  await client.post(`/messages/${encodeGmailPathSegment(id)}/trash`)
}

export async function batchModifyMessages(
  client: HttpClient,
  ids: string[],
  addLabelIds?: string[],
  removeLabelIds?: string[],
): Promise<void> {
  await client.post('/messages/batchModify', {
    ids,
    addLabelIds: addLabelIds ?? [],
    removeLabelIds: removeLabelIds ?? [],
  })
}

export async function insertMessage(
  client: HttpClient,
  rawMime: string | Buffer,
): Promise<{ id: string }> {
  const result = await client.post<GmailMessage>('/messages', {
    raw: toBase64Url(rawMime),
  })
  return { id: result.id }
}

function normalizeMessageDetail(message: GmailMessage): MessageDetail {
  const headers = message.payload?.headers ?? []
  const extracted = message.payload
    ? extractBodyFromPayload(message.payload)
    : { body: '', bodyType: 'text' as const }

  return {
    ...normalizeMessageSummary(message),
    cc: parseEmailAddresses(getHeader(headers, 'Cc')),
    bcc: parseEmailAddresses(getHeader(headers, 'Bcc')),
    body: extracted.body,
    bodyType: extracted.bodyType,
    threadId: message.threadId,
    internetMessageId: getHeader(headers, 'Message-ID'),
    importance: getHeader(headers, 'Importance') || undefined,
    attachments: extractGmailAttachments(message.payload),
    headers: headersToRecord(headers),
  }
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase()
}

function collectSelfAddresses(
  original: MessageDetail,
  identity?: GmailReplyIdentity,
): Set<string> {
  const result = new Set<string>()
  if (identity) {
    result.add(normalizeAddress(identity.email))
    for (const alias of identity.aliases ?? []) result.add(normalizeAddress(alias))
  }

  // These headers are useful as a safe fallback for callers that cannot yet
  // provide account identity. They are never copied into outgoing MIME.
  for (const name of ['Delivered-To', 'X-Original-To']) {
    const value = findRecordHeader(original.headers, name)
    for (const address of parseEmailAddresses(value ?? '')) {
      result.add(normalizeAddress(address.address))
    }
  }
  return result
}

function dedupeAddresses(
  addresses: EmailAddress[],
  seen: Set<string>,
): string[] {
  const result: string[] = []
  for (const item of addresses) {
    const key = normalizeAddress(item.address)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(formatEmailAddress(item))
  }
  return result
}

function findRecordHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase()
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === wanted)?.[1]
}

function mergeReferences(
  existing?: string,
  messageId?: string,
): string[] | undefined {
  const references = [...(existing?.match(/<[^>]+>/g) ?? [])]
  if (messageId && !references.includes(messageId)) references.push(messageId)
  return references.length > 0 ? references : undefined
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
