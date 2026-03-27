import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// MIME Utilities Tests
// ==========================================================

import {
  buildMimeMessage,
  toBase64Url,
  fromBase64Url,
  bufferToBase64Url,
  base64UrlToBuffer,
  extractTextFromPayload,
  getHeader,
} from '../../src/utils/mime'

describe('MIME Utilities', () => {
  describe('toBase64Url / fromBase64Url', () => {
    test('roundtrip ASCII string', () => {
      const input = 'Hello, World!'
      const encoded = toBase64Url(input)
      expect(encoded).not.toContain('+')
      expect(encoded).not.toContain('/')
      expect(encoded).not.toContain('=')
      expect(fromBase64Url(encoded)).toBe(input)
    })

    test('roundtrip UTF-8 string', () => {
      const input = '你好世界 🌍'
      expect(fromBase64Url(toBase64Url(input))).toBe(input)
    })

    test('roundtrip empty string', () => {
      expect(fromBase64Url(toBase64Url(''))).toBe('')
    })

    test('handles special base64 chars (+/=)', () => {
      // String that produces + and / in standard base64
      const input = '>>>???'
      const encoded = toBase64Url(input)
      expect(encoded).not.toContain('+')
      expect(encoded).not.toContain('/')
      expect(fromBase64Url(encoded)).toBe(input)
    })
  })

  describe('bufferToBase64Url / base64UrlToBuffer', () => {
    test('roundtrip binary data', () => {
      const input = Buffer.from([0, 1, 2, 255, 254, 253])
      const encoded = bufferToBase64Url(input)
      expect(base64UrlToBuffer(encoded)).toEqual(input)
    })

    test('handles empty buffer', () => {
      const input = Buffer.alloc(0)
      expect(base64UrlToBuffer(bufferToBase64Url(input))).toEqual(input)
    })

    test('handles large buffer', () => {
      const input = Buffer.alloc(10000, 0xAB)
      expect(base64UrlToBuffer(bufferToBase64Url(input))).toEqual(input)
    })
  })

  describe('buildMimeMessage', () => {
    test('builds simple text message with required headers', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Test Subject',
        body: 'Hello Alice',
      })
      expect(mime).toContain('To: alice@example.com')
      expect(mime).toContain('Subject: Test Subject')
      expect(mime).toContain('MIME-Version: 1.0')
      expect(mime).toContain('Content-Type: text/plain; charset=utf-8')
      expect(mime).toContain('Content-Transfer-Encoding: base64')
      expect(mime).toContain('Date: ')
    })

    test('builds message with CC and BCC', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com', 'bob@example.com'],
        cc: ['charlie@example.com'],
        bcc: ['dave@example.com'],
        subject: 'Multi-recipient',
        body: 'Hello everyone',
      })
      expect(mime).toContain('To: alice@example.com, bob@example.com')
      expect(mime).toContain('Cc: charlie@example.com')
      expect(mime).toContain('Bcc: dave@example.com')
    })

    test('omits CC/BCC when empty', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        cc: [],
        bcc: [],
        subject: 'Test',
        body: 'body',
      })
      expect(mime).not.toContain('Cc:')
      expect(mime).not.toContain('Bcc:')
    })

    test('builds HTML message', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'HTML',
        body: '<h1>Hello</h1>',
        contentType: 'text/html',
      })
      expect(mime).toContain('Content-Type: text/html; charset=utf-8')
    })

    test('encodes non-ASCII subject with RFC 2047', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: '日本語の件名',
        body: 'test',
      })
      expect(mime).toContain('=?UTF-8?B?')
    })

    test('does not encode ASCII-only subject', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Plain ASCII Subject',
        body: 'test',
      })
      expect(mime).toContain('Subject: Plain ASCII Subject')
      expect(mime).not.toContain('=?UTF-8?B?')
    })

    test('includes In-Reply-To and References headers', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Re: Test',
        body: 'reply',
        inReplyTo: '<msg123@example.com>',
        references: '<msg123@example.com>',
      })
      expect(mime).toContain('In-Reply-To: <msg123@example.com>')
      expect(mime).toContain('References: <msg123@example.com>')
    })

    test('includes From header when specified', () => {
      const mime = buildMimeMessage({
        from: 'sender@example.com',
        to: ['alice@example.com'],
        subject: 'Test',
        body: 'test',
      })
      expect(mime).toContain('From: sender@example.com')
    })

    test('body is base64 encoded in the message', () => {
      const body = 'This is the message body content'
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Test',
        body,
      })
      const bodyBase64 = Buffer.from(body, 'utf-8').toString('base64')
      expect(mime).toContain(bodyBase64)
    })

    test('uses CRLF line endings', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Test',
        body: 'test',
      })
      expect(mime).toContain('\r\n')
    })
  })

  describe('extractTextFromPayload', () => {
    test('extracts text from simple body', () => {
      const payload = {
        mimeType: 'text/plain',
        body: { data: toBase64Url('Hello, plain text!') },
      }
      expect(extractTextFromPayload(payload)).toBe('Hello, plain text!')
    })

    test('prefers text/plain in multipart', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: toBase64Url('Plain text') } },
          { mimeType: 'text/html', body: { data: toBase64Url('<p>HTML</p>') } },
        ],
      }
      expect(extractTextFromPayload(payload)).toBe('Plain text')
    })

    test('falls back to text/html', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/html', body: { data: toBase64Url('<p>HTML only</p>') } },
        ],
      }
      expect(extractTextFromPayload(payload)).toBe('<p>HTML only</p>')
    })

    test('returns empty for empty payload', () => {
      expect(extractTextFromPayload({})).toBe('')
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
      expect(extractTextFromPayload(payload)).toBe('Nested plain text')
    })

    test('handles parts without body data', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: {} },
          { mimeType: 'text/html', body: { data: toBase64Url('found it') } },
        ],
      }
      expect(extractTextFromPayload(payload)).toBe('found it')
    })

    test('handles attachment parts without body data', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'application/pdf', filename: 'doc.pdf', body: { attachmentId: 'att1' } },
          { mimeType: 'text/plain', body: { data: toBase64Url('Body text') } },
        ],
      }
      expect(extractTextFromPayload(payload)).toBe('Body text')
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
