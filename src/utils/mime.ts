// MIME message building and parsing utilities

/**
 * Build a simple RFC 2822 email message.
 * Gmail API requires base64url-encoded MIME messages for sending.
 */
export function buildMimeMessage(options: {
  from?: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body: string
  contentType?: 'text/plain' | 'text/html'
  inReplyTo?: string
  references?: string
}): string {
  const lines: string[] = []

  if (options.from) {
    lines.push(`From: ${options.from}`)
  }
  lines.push(`To: ${options.to.join(', ')}`)
  if (options.cc?.length) {
    lines.push(`Cc: ${options.cc.join(', ')}`)
  }
  if (options.bcc?.length) {
    lines.push(`Bcc: ${options.bcc.join(', ')}`)
  }
  lines.push(`Subject: ${encodeMimeHeader(options.subject)}`)
  lines.push(`Date: ${new Date().toUTCString()}`)
  lines.push(`MIME-Version: 1.0`)
  lines.push(`Content-Type: ${options.contentType || 'text/plain'}; charset=utf-8`)
  lines.push(`Content-Transfer-Encoding: base64`)

  if (options.inReplyTo) {
    lines.push(`In-Reply-To: ${options.inReplyTo}`)
  }
  if (options.references) {
    lines.push(`References: ${options.references}`)
  }

  lines.push('')

  // Base64 encode the body
  const bodyBase64 = Buffer.from(options.body, 'utf-8').toString('base64')
  // Split into 76-char lines per RFC 2045
  for (let i = 0; i < bodyBase64.length; i += 76) {
    lines.push(bodyBase64.substring(i, i + 76))
  }

  return lines.join('\r\n')
}

/**
 * Encode a MIME header value with UTF-8 if needed (RFC 2047)
 */
function encodeMimeHeader(value: string): string {
  // Check if ASCII-only
  if (/^[\x20-\x7E]*$/.test(value)) {
    return value
  }
  // Use Base64 encoding for non-ASCII
  const encoded = Buffer.from(value, 'utf-8').toString('base64')
  return `=?UTF-8?B?${encoded}?=`
}

/**
 * Encode a string to base64url (Gmail API format)
 */
export function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Encode raw bytes to base64url
 */
export function bufferToBase64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Decode base64url to string
 */
export function fromBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf-8')
}

/**
 * Decode base64url to Buffer
 */
export function base64UrlToBuffer(input: string): Buffer {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64')
}

/**
 * Extract plain text body from Gmail message payload.
 * Handles both simple and multipart messages.
 */
export function extractTextFromPayload(payload: GmailPayload): string {
  // Simple message with body data
  if (payload.body?.data) {
    return fromBase64Url(payload.body.data)
  }

  // Multipart message — look for text/plain first, then text/html
  if (payload.parts) {
    // Try text/plain first
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return fromBase64Url(part.body.data)
      }
    }
    // Fall back to text/html
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return fromBase64Url(part.body.data)
      }
    }
    // Recurse into nested parts
    for (const part of payload.parts) {
      if (part.parts) {
        const text = extractTextFromPayload(part)
        if (text) return text
      }
    }
  }

  return ''
}

export interface GmailPayload {
  mimeType?: string
  body?: { data?: string; size?: number; attachmentId?: string }
  parts?: GmailPayload[]
  headers?: Array<{ name: string; value: string }>
  filename?: string
}

/**
 * Extract header value from Gmail message headers
 */
export function getHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
): string {
  if (!headers) return ''
  const header = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  )
  return header?.value || ''
}
