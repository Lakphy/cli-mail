import { describe, test, expect } from 'vitest'

// ==========================================================
// MIME Utilities Tests
// ==========================================================

import {
  buildMimeMessage,
  toBase64Url,
  base64UrlToBuffer,
  extractBodyFromPayload,
  formatEmailAddress,
  getHeader,
  parseEmailAddresses,
  parseMimeMessage,
  assertDraftMimeIsMutable,
} from '../../src/utils/mime'

describe('MIME Utilities', () => {
  describe('toBase64Url / base64UrlToBuffer', () => {
    test('roundtrip ASCII string', () => {
      const input = 'Hello, World!'
      const encoded = toBase64Url(input)
      expect(encoded).not.toContain('+')
      expect(encoded).not.toContain('/')
      expect(encoded).not.toContain('=')
      expect(base64UrlToBuffer(encoded).toString('utf8')).toBe(input)
    })

    test('roundtrip UTF-8 string', () => {
      const input = '你好世界 🌍'
      expect(base64UrlToBuffer(toBase64Url(input)).toString('utf8')).toBe(input)
    })

    test('roundtrip empty string', () => {
      expect(base64UrlToBuffer(toBase64Url('')).toString('utf8')).toBe('')
    })

    test('handles special base64 chars (+/=)', () => {
      // String that produces + and / in standard base64
      const input = '>>>???'
      const encoded = toBase64Url(input)
      expect(encoded).not.toContain('+')
      expect(encoded).not.toContain('/')
      expect(base64UrlToBuffer(encoded).toString('utf8')).toBe(input)
    })
  })

  describe('binary base64url conversion', () => {
    test('roundtrip binary data', () => {
      const input = Buffer.from([0, 1, 2, 255, 254, 253])
      const encoded = toBase64Url(input)
      expect(base64UrlToBuffer(encoded)).toEqual(input)
    })

    test('handles empty buffer', () => {
      const input = Buffer.alloc(0)
      expect(base64UrlToBuffer(toBase64Url(input))).toEqual(input)
    })

    test('handles large buffer', () => {
      const input = Buffer.alloc(10000, 0xAB)
      expect(base64UrlToBuffer(toBase64Url(input))).toEqual(input)
    })
  })

  describe('buildMimeMessage', () => {
    test('builds simple text message with required headers', async () => {
      const mime = (await buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Test Subject',
        body: 'Hello Alice',
      })).toString()
      expect(mime).toContain('To: alice@example.com')
      expect(mime).toContain('Subject: Test Subject')
      expect(mime).toContain('MIME-Version: 1.0')
      expect(mime).toContain('Content-Type: text/plain; charset=utf-8')
      expect(mime).toMatch(/Content-Transfer-Encoding: (?:7bit|quoted-printable|base64)/)
      expect(mime).toContain('Date: ')
    })

    test('builds message with CC and BCC', async () => {
      const mime = (await buildMimeMessage({
        to: ['alice@example.com', 'bob@example.com'],
        cc: ['charlie@example.com'],
        bcc: ['dave@example.com'],
        subject: 'Multi-recipient',
        body: 'Hello everyone',
      })).toString()
      expect(mime).toContain('To: alice@example.com, bob@example.com')
      expect(mime).toContain('Cc: charlie@example.com')
      expect(mime).toContain('Bcc: dave@example.com')
    })

    test('omits CC/BCC when empty', async () => {
      const mime = (await buildMimeMessage({
        to: ['alice@example.com'],
        cc: [],
        bcc: [],
        subject: 'Test',
        body: 'body',
      })).toString()
      expect(mime).not.toContain('Cc:')
      expect(mime).not.toContain('Bcc:')
    })

    test('builds HTML message', async () => {
      const mime = (await buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'HTML',
        body: '<h1>Hello</h1>',
        contentType: 'text/html',
      })).toString()
      expect(mime).toContain('Content-Type: text/html; charset=utf-8')
    })

    test('encodes non-ASCII subject with RFC 2047', async () => {
      const mime = (await buildMimeMessage({
        to: ['alice@example.com'],
        subject: '日本語の件名',
        body: 'test',
      })).toString()
      expect(mime).toContain('=?UTF-8?B?')
    })

    test('does not encode ASCII-only subject', async () => {
      const mime = (await buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Plain ASCII Subject',
        body: 'test',
      })).toString()
      expect(mime).toContain('Subject: Plain ASCII Subject')
      expect(mime).not.toContain('=?UTF-8?B?')
    })

    test('includes In-Reply-To and References headers', async () => {
      const mime = (await buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Re: Test',
        body: 'reply',
        inReplyTo: '<msg123@example.com>',
        references: '<msg123@example.com>',
      })).toString()
      expect(mime).toContain('In-Reply-To: <msg123@example.com>')
      expect(mime).toContain('References: <msg123@example.com>')
    })

    test('includes From header when specified', async () => {
      const mime = (await buildMimeMessage({
        from: 'sender@example.com',
        to: ['alice@example.com'],
        subject: 'Test',
        body: 'test',
      })).toString()
      expect(mime).toContain('From: sender@example.com')
    })

    test('body round-trips through a MIME parser', async () => {
      const body = 'This is the message body content'
      const mime = await buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Test',
        body,
      })
      const parsed = await parseMimeMessage(mime)
      expect(parsed.text?.trim()).toBe(body)
    })

    test('uses CRLF line endings', async () => {
      const mime = (await buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Test',
        body: 'test',
      })).toString()
      expect(mime).toContain('\r\n')
    })

    test.each(['subject', 'to', 'attachment filename'])(
      'rejects CR/LF injection through %s',
      async (field) => {
        const options = {
          to: [field === 'to' ? 'alice@example.com\r\nBcc: attacker@example.com' : 'alice@example.com'],
          subject: field === 'subject' ? 'hello\r\nBcc: attacker@example.com' : 'hello',
          body: 'safe',
          attachments: field === 'attachment filename'
            ? [{ filename: 'safe.txt\r\nX-Evil: yes', content: Buffer.from('x') }]
            : undefined,
        }
        await expect(buildMimeMessage(options)).rejects.toMatchObject({
          code: 'INVALID_HEADER_VALUE',
        })
      },
    )

    test('encodes a Unicode attachment filename safely', async () => {
      const mime = await buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'file',
        body: 'attached',
        attachments: [{ filename: '报价单 2026.pdf', content: Buffer.from('pdf') }],
      })
      const parsed = await parseMimeMessage(mime)
      expect(parsed.attachments[0]?.filename).toBe('报价单 2026.pdf')
      expect(parsed.attachments[0]?.content).toEqual(Buffer.from('pdf'))
    })
  })

  describe('extractBodyFromPayload', () => {
    test('extracts text from simple body', () => {
      const payload = {
        mimeType: 'text/plain',
        body: { data: toBase64Url('Hello, plain text!') },
      }
      expect(extractBodyFromPayload(payload).body).toBe('Hello, plain text!')
    })

    test('prefers text/plain in multipart', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: toBase64Url('Plain text') } },
          { mimeType: 'text/html', body: { data: toBase64Url('<p>HTML</p>') } },
        ],
      }
      expect(extractBodyFromPayload(payload).body).toBe('Plain text')
    })

    test('prefers plain text even when an alternative lists HTML first', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/html', body: { data: toBase64Url('<p>HTML</p>') } },
          { mimeType: 'text/plain', body: { data: toBase64Url('Plain text') } },
        ],
      }
      expect(extractBodyFromPayload(payload)).toEqual({
        body: 'Plain text',
        bodyType: 'text',
      })
    })

    test('falls back to text/html', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/html', body: { data: toBase64Url('<p>HTML only</p>') } },
        ],
      }
      expect(extractBodyFromPayload(payload).body).toBe('<p>HTML only</p>')
    })

    test('returns empty for empty payload', () => {
      expect(extractBodyFromPayload({}).body).toBe('')
    })

    test('handles deeply nested multipart', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [{
          mimeType: 'multipart/alternative',
          parts: [{
            mimeType: 'text/plain',
            body: { data: toBase64Url('Nested plain text') },
          }],
        }],
      }
      expect(extractBodyFromPayload(payload).body).toBe('Nested plain text')
    })

    test('handles parts without body data', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: {} },
          { mimeType: 'text/html', body: { data: toBase64Url('found it') } },
        ],
      }
      expect(extractBodyFromPayload(payload).body).toBe('found it')
    })

    test('handles attachment parts without body data', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'application/pdf', filename: 'doc.pdf', body: { attachmentId: 'att1' } },
          { mimeType: 'text/plain', body: { data: toBase64Url('Body text') } },
        ],
      }
      expect(extractBodyFromPayload(payload).body).toBe('Body text')
    })

    test('multipart/mixed uses the first eligible body in document order', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/html', body: { data: toBase64Url('<p>First</p>') } },
          { mimeType: 'text/plain', body: { data: toBase64Url('Second') } },
        ],
      }
      expect(extractBodyFromPayload(payload)).toEqual({
        body: '<p>First</p>',
        bodyType: 'html',
      })
    })

    test('excludes an attachment container and its entire subtree', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            filename: 'attached.eml',
            parts: [{
              mimeType: 'text/plain',
              body: { data: toBase64Url('Attached message body') },
            }],
          },
          { mimeType: 'text/plain', body: { data: toBase64Url('Outer body') } },
        ],
      }
      expect(extractBodyFromPayload(payload).body).toBe('Outer body')
    })

    test('excludes Content-Disposition attachment subtrees without filenames', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            headers: [{ name: 'Content-Disposition', value: 'ATTACHMENT; size=20' }],
            parts: [{
              mimeType: 'text/plain',
              body: { data: toBase64Url('Attached body') },
            }],
          },
          { mimeType: 'text/plain', body: { data: toBase64Url('Outer body') } },
        ],
      }
      expect(extractBodyFromPayload(payload).body).toBe('Outer body')
    })

    test('never treats an encapsulated RFC 822 message as the outer body', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'message/rfc822',
            parts: [{
              mimeType: 'text/plain',
              body: { data: toBase64Url('Nested message') },
            }],
          },
          { mimeType: 'text/plain', body: { data: toBase64Url('Outer body') } },
        ],
      }
      expect(extractBodyFromPayload(payload).body).toBe('Outer body')
    })

    test('returns the body type matching the selected plain alternative', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: toBase64Url('Plain') } },
          { mimeType: 'text/html', body: { data: toBase64Url('<p>HTML</p>') } },
        ],
      }
      expect(extractBodyFromPayload(payload)).toEqual({ body: 'Plain', bodyType: 'text' })
    })

    test('decodes the declared charset', () => {
      const latin1 = Buffer.from([0x4f, 0x6c, 0xe1])
      const payload = {
        mimeType: 'text/plain',
        headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }],
        body: { data: toBase64Url(latin1) },
      }
      expect(extractBodyFromPayload(payload).body).toBe('Olá')
    })
  })

  describe('parseEmailAddresses', () => {
    test('handles quoted commas and multiple recipients', () => {
      expect(parseEmailAddresses('"Doe, Jane" <jane@example.com>, john@example.com')).toEqual([
        { name: 'Doe, Jane', address: 'jane@example.com' },
        { address: 'john@example.com' },
      ])
    })
  })

  describe('formatEmailAddress', () => {
    test('quotes display names and escapes quotes and backslashes', () => {
      expect(formatEmailAddress({
        name: 'Doe "Jane" \\ Team',
        address: 'jane@example.com',
      })).toBe(String.raw`"Doe \"Jane\" \\ Team" <jane@example.com>`)
    })

    test('leaves an address without a display name unquoted', () => {
      expect(formatEmailAddress({ address: 'jane@example.com' }))
        .toBe('jane@example.com')
    })

    test.each([
      {
        address: { name: 'Jane\r\nBcc: attacker@example.com', address: 'jane@example.com' },
        field: 'display name',
      },
      {
        address: { address: 'jane@example.com\nBcc: attacker@example.com' },
        field: 'address',
      },
    ])('rejects CR/LF injection through the email $field', ({ address }) => {
      expect(() => formatEmailAddress(address)).toThrowError(expect.objectContaining({
        code: 'INVALID_HEADER_VALUE',
      }))
    })
  })

  describe('assertDraftMimeIsMutable', () => {
    test('detects a protected MIME type after a header longer than 64 KiB', () => {
      const raw = [
        `X-Padding: ${'a'.repeat(70 * 1024)}`,
        'Content-Type: application/pkcs7-mime; smime-type=enveloped-data',
        '',
        'encrypted',
      ].join('\r\n')
      expect(() => assertDraftMimeIsMutable(raw)).toThrowError(expect.objectContaining({
        code: 'UNSAFE_DRAFT_MUTATION',
      }))
    })

    test('detects signed MIME nested inside multipart/mixed', () => {
      const raw = [
        'Content-Type: multipart/mixed; boundary="outer"',
        '',
        '--outer',
        'Content-Type: text/plain',
        '',
        'safe body',
        '--outer',
        'Content-Type: multipart/signed; boundary="signed"',
        '',
        '--signed',
        'Content-Type: text/plain',
        '',
        'signed body',
        '--signed',
        'Content-Type: application/pgp-signature',
        '',
        'signature',
        '--signed--',
        '--outer--',
      ].join('\r\n')
      expect(() => assertDraftMimeIsMutable(raw)).toThrowError(expect.objectContaining({
        code: 'UNSAFE_DRAFT_MUTATION',
      }))
    })

    test('detects inline PGP encryption', () => {
      const raw = [
        'Content-Type: text/plain; charset=utf-8',
        '',
        '-----BEGIN PGP MESSAGE-----',
        'encrypted',
      ].join('\r\n')
      expect(() => assertDraftMimeIsMutable(raw)).toThrowError(expect.objectContaining({
        code: 'UNSAFE_DRAFT_MUTATION',
      }))
    })

    test('does not mistake MIME-like text in a plain body for a nested entity', () => {
      const raw = [
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Documentation example:',
        'Content-Type: multipart/signed',
      ].join('\r\n')
      expect(() => assertDraftMimeIsMutable(raw)).not.toThrow()
    })

    test('refuses malformed multipart that cannot be inspected safely', () => {
      const raw = [
        'Content-Type: multipart/mixed; boundary="missing"',
        '',
        'no matching delimiters',
      ].join('\r\n')
      expect(() => assertDraftMimeIsMutable(raw)).toThrowError(expect.objectContaining({
        code: 'UNSAFE_DRAFT_MUTATION',
      }))
    })
  })

  describe('getHeader', () => {
    const headers = [
      { name: 'From', value: 'sender@example.com' },
      { name: 'Subject', value: 'Test Subject' },
      { name: 'Content-Type', value: 'text/plain' },
    ]

    test('finds header case-insensitively', () => {
      expect(getHeader(headers, 'from')).toBe('sender@example.com')
      expect(getHeader(headers, 'FROM')).toBe('sender@example.com')
      expect(getHeader(headers, 'From')).toBe('sender@example.com')
    })

    test('returns empty for missing header', () => {
      expect(getHeader(headers, 'X-Custom')).toBe('')
    })

    test('returns empty for undefined headers', () => {
      expect(getHeader(undefined, 'From')).toBe('')
    })

    test('returns empty for empty array', () => {
      expect(getHeader([], 'From')).toBe('')
    })
  })
})
