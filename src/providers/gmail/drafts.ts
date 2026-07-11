// Gmail draft operations

import type { HttpClient } from '../../utils/http.js'
import type {
  AttachmentSummary,
  DraftSummary,
  DraftDetail,
} from '../types.js'
import {
  assertDraftMimeIsMutable,
  buildMimeMessage,
  extractBodyFromPayload,
  formatEmailAddress,
  getHeader,
  parseEmailAddress,
  parseEmailAddresses,
  parseMimeMessage,
  parsedAddressObjectToList,
  toBase64Url,
  base64UrlToBuffer,
  type GmailPayload,
} from '../../utils/mime.js'
import { CliMailError } from '../../utils/error.js'
import {
  extractGmailAttachments,
  headersToRecord,
  normalizeInternalDate,
  settledMapWithConcurrency,
  settledValuesAndErrors,
  toMimeAttachments,
  type GmailItemError,
} from './helpers.js'

const DETAIL_CONCURRENCY = 8

interface GmailDraft {
  id: string
  message: {
    id: string
    threadId: string
    labelIds?: string[]
    snippet?: string
    payload?: GmailPayload
    internalDate?: string
    raw?: string
  }
}

interface GmailDraftList {
  drafts?: Array<{ id: string; message: { id: string; threadId: string } }>
  nextPageToken?: string
  resultSizeEstimate?: number
}

export interface GmailDraftDetail extends DraftDetail {
  threadId?: string
  attachments?: AttachmentSummary[]
  headers?: Record<string, string>
}

export interface GmailDraftListOptions {
  top?: number
  pageToken?: string
}

export interface GmailDraftListResult {
  drafts: DraftSummary[]
  nextPageToken?: string
  errors?: GmailItemError[]
}

export async function listDrafts(
  client: HttpClient,
  options: GmailDraftListOptions = {},
): Promise<GmailDraftListResult> {
  const list = await client.get<GmailDraftList>('/drafts', {
    maxResults: options.top ?? 20,
    pageToken: options.pageToken,
  })
  const listed = list.drafts ?? []

  if (listed.length === 0) {
    return { drafts: [], nextPageToken: list.nextPageToken }
  }

  const settled = await settledMapWithConcurrency(
    listed,
    DETAIL_CONCURRENCY,
    (draft) => client.get<GmailDraft>(`/drafts/${draft.id}`, {
      format: 'metadata',
      metadataHeaders: ['To', 'Subject', 'Date'],
    }),
  )
  const { values, errors } = settledValuesAndErrors(
    listed.map((draft) => draft.id),
    settled,
  )

  return {
    drafts: values.map(normalizeDraftSummary),
    nextPageToken: list.nextPageToken,
    ...(errors.length > 0 ? { errors } : {}),
  }
}

export async function getDraft(
  client: HttpClient,
  id: string,
): Promise<GmailDraftDetail> {
  const draft = await client.get<GmailDraft>(`/drafts/${id}`, { format: 'full' })
  return normalizeDraftDetail(draft)
}

export async function createDraft(
  client: HttpClient,
  options: {
    to: string[]
    subject: string
    body: string
    cc?: string[]
    bcc?: string[]
    bodyType?: 'text' | 'html'
  },
): Promise<{ id: string }> {
  const mime = await buildMimeMessage({
    to: options.to,
    cc: options.cc,
    bcc: options.bcc,
    subject: options.subject,
    body: options.body,
    contentType: options.bodyType === 'html' ? 'text/html' : 'text/plain',
  })

  const result = await client.post<GmailDraft>('/drafts', {
    message: { raw: toBase64Url(mime) },
  })
  return { id: result.id }
}

export async function updateDraft(
  client: HttpClient,
  id: string,
  options: {
    to?: string[]
    subject?: string
    body?: string
    cc?: string[]
    bcc?: string[]
    bodyType?: 'text' | 'html'
  },
): Promise<{ id: string }> {
  if (Object.values(options).every((value) => value === undefined)) {
    throw new CliMailError('At least one draft field must be provided.', 'EMPTY_UPDATE')
  }
  if (options.bodyType !== undefined && options.body === undefined) {
    throw new CliMailError(
      'bodyType can only be changed together with body.',
      'INVALID_DRAFT_UPDATE',
    )
  }

  // Fetch raw instead of normalizing through the summary DTO. This retains
  // attachment bytes, HTML alternatives, reply-chain headers and threadId.
  const current = await client.get<GmailDraft>(`/drafts/${id}`, { format: 'raw' })
  if (!current.message.raw) {
    throw new CliMailError('Gmail returned a draft without raw MIME.', 'INVALID_DRAFT')
  }
  const raw = base64UrlToBuffer(current.message.raw)
  assertDraftMimeIsMutable(raw)
  const parsed = await parseMimeMessage(raw)

  const to = options.to ?? parsedAddressObjectToList(parsed.to).map(formatEmailAddress)
  const cc = options.cc ?? parsedAddressObjectToList(parsed.cc).map(formatEmailAddress)
  const bcc = options.bcc ?? parsedAddressObjectToList(parsed.bcc).map(formatEmailAddress)
  const from = parsed.from?.text
  const subject = options.subject ?? parsed.subject ?? ''

  let body = ''
  let contentType: 'text/plain' | 'text/html' = 'text/plain'
  let textBody: string | undefined
  let htmlBody: string | undefined
  if (options.body !== undefined) {
    body = options.body
    const existingBodyType = typeof parsed.html === 'string' && !parsed.text
      ? 'html'
      : 'text'
    const requestedBodyType = options.bodyType ?? existingBodyType
    contentType = requestedBodyType === 'html' ? 'text/html' : 'text/plain'
  } else {
    textBody = parsed.text || undefined
    htmlBody = typeof parsed.html === 'string' ? parsed.html : undefined
    if (!textBody && htmlBody) contentType = 'text/html'
    body = contentType === 'text/html' ? htmlBody ?? '' : textBody ?? ''
  }

  const attachments = toMimeAttachments(parsed.attachments)
  const headers = preservedCustomHeaders(parsed.headers)

  const mime = await buildMimeMessage({
    from,
    to,
    cc,
    bcc,
    subject,
    body,
    contentType,
    textBody,
    htmlBody,
    messageId: parsed.messageId,
    date: parsed.date,
    inReplyTo: parsed.inReplyTo,
    references: parsed.references,
    headers,
    attachments,
  })

  const result = await client.put<GmailDraft>(`/drafts/${id}`, {
    message: {
      raw: toBase64Url(mime),
      threadId: current.message.threadId,
    },
  })
  return { id: result.id }
}

export async function sendDraft(
  client: HttpClient,
  id: string,
): Promise<{ id: string; threadId: string }> {
  return client.post<{ id: string; threadId: string }>('/drafts/send', { id })
}

export async function deleteDraft(client: HttpClient, id: string): Promise<void> {
  await client.delete(`/drafts/${id}`)
}

function normalizeDraftSummary(draft: GmailDraft): DraftSummary {
  const headers = draft.message.payload?.headers ?? []
  return {
    id: draft.id,
    subject: getHeader(headers, 'Subject') || '(no subject)',
    to: parseEmailAddresses(getHeader(headers, 'To')),
    snippet: draft.message.snippet,
    updatedAt: normalizeInternalDate(draft.message.internalDate),
  }
}

function normalizeDraftDetail(draft: GmailDraft): GmailDraftDetail {
  const headers = draft.message.payload?.headers ?? []
  const extracted = draft.message.payload
    ? extractBodyFromPayload(draft.message.payload)
    : { body: '', bodyType: 'text' as const }

  return {
    ...normalizeDraftSummary(draft),
    cc: parseEmailAddresses(getHeader(headers, 'Cc')),
    bcc: parseEmailAddresses(getHeader(headers, 'Bcc')),
    body: extracted.body,
    bodyType: extracted.bodyType,
    from: getHeader(headers, 'From')
      ? parseEmailAddress(getHeader(headers, 'From'))
      : undefined,
    threadId: draft.message.threadId,
    attachments: extractGmailAttachments(draft.message.payload),
    headers: headersToRecord(headers),
  }
}

const REBUILT_HEADERS = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'subject',
  'date',
  'message-id',
  'in-reply-to',
  'references',
  'mime-version',
  'content-type',
  'content-transfer-encoding',
  'content-disposition',
  'return-path',
  'received',
  'delivered-to',
  'authentication-results',
  'dkim-signature',
])

function preservedCustomHeaders(
  headers: Map<string, unknown>,
): Record<string, string | string[]> | undefined {
  const result: Record<string, string | string[]> = {}
  for (const [name, value] of headers) {
    const lower = name.toLowerCase()
    if (
      REBUILT_HEADERS.has(lower)
      || lower.startsWith('arc-')
      || lower.startsWith('x-google-')
      || lower.startsWith('x-gm-')
    ) continue

    const strings = headerStrings(value)
      .map((item) => item.replace(/\r?\n[\t ]*/g, ' '))
      .filter(Boolean)
    if (strings.length === 1) result[name] = strings[0]
    else if (strings.length > 1) result[name] = strings
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function headerStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(headerStrings)
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>
    // MailParser represents address headers (for example Reply-To and Sender)
    // as AddressObject values.
    if (typeof object.text === 'string') return [object.text]
    // Retain semantics for structured extension headers.
    if (typeof object.value === 'string' && isStringRecord(object.params)) {
      const params = Object.entries(object.params)
        .filter(([name]) => /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name))
        .map(([name, item]) => `${name}="${item.replace(/(["\\])/g, '\\$1')}"`)
      return [params.length > 0 ? `${object.value}; ${params.join('; ')}` : object.value]
    }
  }
  return []
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object'
    && value !== null
    && Object.values(value).every((item) => typeof item === 'string')
}
