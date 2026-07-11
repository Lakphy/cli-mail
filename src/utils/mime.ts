// Standards-aware MIME message building and parsing utilities.

import { getRegularFileSize } from './files.js'
import addressparser from 'nodemailer/lib/addressparser/index.js'
import type MailComposerConstructor from 'nodemailer/lib/mail-composer/index.js'
import type { AddressObject, ParsedMail } from 'mailparser'
import { basename } from 'node:path'
import { CliMailError } from './error.js'

let mailComposerModulePromise:
  Promise<typeof MailComposerConstructor> | undefined
let mailParserModulePromise: Promise<typeof import('mailparser')> | undefined

function loadMailComposer(): Promise<typeof MailComposerConstructor> {
  return mailComposerModulePromise
    ??= import('nodemailer/lib/mail-composer/index.js').then(
      ({ default: MailComposer }) => MailComposer,
    )
}

function loadMailParser(): Promise<typeof import('mailparser')> {
  return mailParserModulePromise ??= import('mailparser')
}

export interface GmailPayload {
  mimeType?: string
  body?: { data?: string; size?: number; attachmentId?: string }
  parts?: GmailPayload[]
  headers?: Array<{ name: string; value: string }>
  filename?: string
}

export interface ParsedEmailAddress {
  name?: string
  address: string
}

export interface MimeAttachment {
  filename?: string
  path?: string
  content?: Buffer
  contentType?: string
  contentDisposition?: 'attachment' | 'inline'
  cid?: string
}

export interface BuildMimeMessageOptions {
  from?: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body: string
  contentType?: 'text/plain' | 'text/html'
  /** Preserve both alternatives when rebuilding an existing message. */
  textBody?: string
  htmlBody?: string
  inReplyTo?: string
  references?: string | string[]
  messageId?: string
  date?: Date
  headers?: Record<string, string | string[]>
  attachments?: MimeAttachment[]
}

/**
 * Build a complete RFC-compliant MIME message.
 *
 * MailComposer handles encoded words, address quoting, header folding,
 * multipart boundaries, RFC 2231 filenames, and transfer encodings. Header
 * values supplied by users are still rejected if they contain CR/LF so a
 * caller can never smuggle in a second header.
 */
export async function buildMimeMessage(
  options: BuildMimeMessageOptions,
): Promise<Buffer> {
  validateHeaderValues(options)

  const contentType = options.contentType ?? 'text/plain'
  const text = options.textBody
    ?? (contentType === 'text/plain' ? options.body : undefined)
  const html = options.htmlBody
    ?? (contentType === 'text/html' ? options.body : undefined)

  const attachments = options.attachments?.map((attachment) => {
    if (attachment.path) {
      getRegularFileSize(attachment.path, 'MIME attachment', 25 * 1024 * 1024)
    }
    const filename = attachment.filename
      || (attachment.path ? basename(attachment.path) : undefined)
    if (filename) assertSafeHeaderValue(filename, 'attachment filename')
    if (attachment.contentType) {
      assertSafeHeaderValue(attachment.contentType, 'attachment content type')
    }
    if (attachment.cid) assertSafeHeaderValue(attachment.cid, 'attachment cid')
    return {
      filename,
      path: attachment.path,
      content: attachment.content,
      contentType: attachment.contentType,
      contentDisposition: attachment.contentDisposition,
      cid: attachment.cid,
    }
  })

  const MailComposer = await loadMailComposer()
  const composer = new MailComposer({
    from: options.from,
    to: options.to,
    cc: options.cc,
    bcc: options.bcc,
    subject: options.subject,
    text,
    html,
    inReplyTo: options.inReplyTo,
    references: options.references,
    messageId: options.messageId,
    date: options.date,
    headers: options.headers,
    attachments,
  })

  const message = composer.compile()
  // Gmail API receives only the composed message, not Nodemailer's SMTP
  // envelope, so Bcc must remain in the raw MIME for Gmail to deliver it.
  message.keepBcc = true
  return message.build()
}

/** Parse an RFC 5322 message without converting its bytes through UTF-8. */
export async function parseMimeMessage(
  input: string | Buffer,
): Promise<ParsedMail> {
  // Do not synthesize a text alternative from HTML: draft reconstruction must
  // distinguish an original alternative from a parser-generated convenience.
  const { simpleParser } = await loadMailParser()
  return simpleParser(input, { skipHtmlToText: true })
}

/**
 * Refuse mutations that would invalidate a cryptographic signature or destroy
 * an encrypted MIME envelope.
 */
export function assertDraftMimeIsMutable(raw: string | Buffer): void {
  const source = Buffer.isBuffer(raw) ? raw.toString('latin1') : raw
  inspectMutableMimeEntity(source, 0)
}

const PROTECTED_MIME_TYPES = new Set([
  'multipart/signed',
  'multipart/encrypted',
  'application/pkcs7-mime',
  'application/x-pkcs7-mime',
  'application/pkcs7-signature',
  'application/x-pkcs7-signature',
  'application/pgp-encrypted',
  'application/pgp-signature',
])

function inspectMutableMimeEntity(entity: string, depth: number): void {
  if (depth > 32) throwUnsafeDraftMutation('MIME nesting is too deep to edit safely.')

  const { headers, body } = splitMimeEntity(entity)
  const unfolded = headers.replace(/\r?\n[\t ]+/g, ' ')
  const contentType = mimeHeaderValue(unfolded, 'Content-Type') ?? 'text/plain'
  const mimeType = contentType.split(';', 1)[0].trim().toLowerCase()
  const disposition = mimeHeaderValue(unfolded, 'Content-Disposition') ?? ''

  if (
    PROTECTED_MIME_TYPES.has(mimeType)
    || /(?:name|filename)\s*=\s*(?:"[^"]*\.(?:p7m|p7s)"|[^;\s]*\.(?:p7m|p7s))/i
      .test(`${contentType};${disposition}`)
  ) {
    throwUnsafeDraftMutation('Signed or encrypted drafts cannot be safely edited.')
  }

  if (/^-----BEGIN PGP (?:MESSAGE|SIGNED MESSAGE)-----/m.test(body)) {
    throwUnsafeDraftMutation('Inline PGP drafts cannot be safely edited.')
  }

  if (!mimeType.startsWith('multipart/')) return
  const boundary = mimeBoundary(contentType)
  if (!boundary || boundary.length > 200) {
    throwUnsafeDraftMutation('Malformed multipart drafts cannot be safely edited.')
  }

  const delimiter = new RegExp(
    `(?:^|\\r?\\n)--${escapeRegExp(boundary)}(--)?[\\t ]*(?:\\r?\\n|$)`,
    'g',
  )
  let partStart: number | undefined
  let foundBoundary = false
  for (let match = delimiter.exec(body); match; match = delimiter.exec(body)) {
    foundBoundary = true
    if (partStart !== undefined) {
      inspectMutableMimeEntity(body.slice(partStart, match.index), depth + 1)
    }
    if (match[1] === '--') {
      partStart = undefined
      break
    }
    partStart = delimiter.lastIndex
  }
  if (!foundBoundary) {
    throwUnsafeDraftMutation('Malformed multipart drafts cannot be safely edited.')
  }
  if (partStart !== undefined) {
    inspectMutableMimeEntity(body.slice(partStart), depth + 1)
  }
}

function splitMimeEntity(entity: string): { headers: string; body: string } {
  const crlf = entity.indexOf('\r\n\r\n')
  const lf = entity.indexOf('\n\n')
  const candidates = [crlf, lf].filter((index) => index >= 0)
  if (candidates.length === 0) return { headers: entity, body: '' }
  const index = Math.min(...candidates)
  const separatorLength = index === crlf ? 4 : 2
  return {
    headers: entity.slice(0, index),
    body: entity.slice(index + separatorLength),
  }
}

function mimeHeaderValue(headers: string, name: string): string | undefined {
  const match = new RegExp(`^${escapeRegExp(name)}[\\t ]*:[\\t ]*([^\\r\\n]*)`, 'im')
    .exec(headers)
  return match?.[1]
}

function mimeBoundary(contentType: string): string | undefined {
  const match = /boundary\s*=\s*(?:"((?:\\.|[^"])*)"|([^;\s]+))/i.exec(contentType)
  return (match?.[1]?.replace(/\\(.)/g, '$1') ?? match?.[2])?.trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function throwUnsafeDraftMutation(message: string): never {
  throw new CliMailError(message, 'UNSAFE_DRAFT_MUTATION')
}

/** Reject CR/LF in any value that will become a MIME header. */
export function assertSafeHeaderValue(value: string, field = 'header'): void {
  if (/[\r\n]/.test(value)) {
    throw new CliMailError(
      `${field} must not contain CR or LF characters.`,
      'INVALID_HEADER_VALUE',
    )
  }
}

function validateHeaderValues(options: BuildMimeMessageOptions): void {
  const scalarValues: Array<[string, string | undefined]> = [
    ['From', options.from],
    ['Subject', options.subject],
    ['In-Reply-To', options.inReplyTo],
    [
      'References',
      Array.isArray(options.references)
        ? options.references.join(' ')
        : options.references,
    ],
    ['Message-ID', options.messageId],
  ]

  for (const [field, value] of scalarValues) {
    if (value !== undefined) assertSafeHeaderValue(value, field)
  }
  for (const [field, values] of [
    ['To', options.to],
    ['Cc', options.cc ?? []],
    ['Bcc', options.bcc ?? []],
  ] as const) {
    for (const value of values) assertSafeHeaderValue(value, field)
  }

  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
      throw new CliMailError(`Invalid MIME header name: ${name}`, 'INVALID_HEADER_NAME')
    }
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) assertSafeHeaderValue(item, name)
  }
}

/** Encode text or raw bytes to Gmail's base64url representation. */
export function toBase64Url(input: string | Buffer): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf-8'))
    .toString('base64url')
}

/** Decode Gmail base64url data without a lossy text conversion. */
export function base64UrlToBuffer(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

/**
 * Extract the preferred renderable body and its matching type. Text
 * attachments are ignored. A multipart/alternative prefers text/plain, then
 * text/html, and charset conversion uses Node's WHATWG TextDecoder.
 */
export function extractBodyFromPayload(payload: GmailPayload): {
  body: string
  bodyType: 'text' | 'html'
} {
  const textParts: GmailPayload[] = []
  const htmlParts: GmailPayload[] = []

  function walk(part: GmailPayload): void {
    const isAttachment = Boolean(part.filename)
    if (!isAttachment && part.body?.data) {
      if (part.mimeType?.toLowerCase() === 'text/plain') textParts.push(part)
      if (part.mimeType?.toLowerCase() === 'text/html') htmlParts.push(part)
    }
    for (const child of part.parts ?? []) walk(child)
  }

  walk(payload)
  const selected = textParts[0] ?? htmlParts[0]
  if (!selected?.body?.data) return { body: '', bodyType: 'text' }

  return {
    body: decodeTextPart(selected),
    bodyType: selected.mimeType?.toLowerCase() === 'text/html' ? 'html' : 'text',
  }
}

function decodeTextPart(part: GmailPayload): string {
  const bytes = base64UrlToBuffer(part.body?.data ?? '')
  const contentType = getHeader(part.headers, 'Content-Type')
  const match = /charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i.exec(contentType)
  const charset = (match?.[1] ?? match?.[2] ?? match?.[3] ?? 'utf-8').trim()

  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** Parse a standards-compliant RFC address list, including quoted commas. */
export function parseEmailAddresses(raw: string): ParsedEmailAddress[] {
  if (!raw.trim()) return []
  const parsed = addressparser(raw, { flatten: true })
  const result: ParsedEmailAddress[] = []

  for (const entry of parsed) {
    if ('address' in entry && entry.address) {
      result.push({
        ...(entry.name ? { name: entry.name } : {}),
        address: entry.address,
      })
    }
  }
  return result
}

export function parseEmailAddress(raw: string): ParsedEmailAddress {
  return parseEmailAddresses(raw)[0] ?? { address: raw.trim() }
}

/** Format one mailbox for an RFC 5322 address header. */
export function formatEmailAddress(address: ParsedEmailAddress): string {
  assertSafeHeaderValue(address.address, 'email address')
  if (!address.name) return address.address

  assertSafeHeaderValue(address.name, 'email display name')
  const escapedName = address.name.replace(/(["\\])/g, '\\$1')
  return `"${escapedName}" <${address.address}>`
}

/** Flatten MailParser's single-or-list address representation. */
export function parsedAddressObjectToList(
  value: AddressObject | AddressObject[] | undefined,
): ParsedEmailAddress[] {
  const values = value === undefined ? [] : Array.isArray(value) ? value : [value]
  return values.flatMap((item) => item.value.flatMap((address) => (
    address.address
      ? [{
          ...(address.name ? { name: address.name } : {}),
          address: address.address,
        }]
      : []
  )))
}

/** Extract a header value from a Gmail payload, case-insensitively. */
export function getHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
): string {
  if (!headers) return ''
  const header = headers.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  )
  return header?.value ?? ''
}
