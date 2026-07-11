import { describe, expect, test, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import { forwardMessage } from '../../../src/providers/gmail/messages'
import {
  base64UrlToBuffer,
  buildMimeMessage,
  parseMimeMessage,
} from '../../../src/utils/mime'

describe('Gmail forward MIME safety', () => {
  test('rebuilds a forward without Bcc or provider-internal headers', async () => {
    const original = await buildMimeMessage({
      from: 'Sender <sender@example.com>',
      to: ['recipient@example.com'],
      cc: ['copy@example.com'],
      bcc: ['secret@example.com'],
      subject: 'Original',
      body: 'Original body',
      headers: { 'X-Google-Internal-Trace': 'do-not-forward' },
      attachments: [{ filename: 'note.txt', content: Buffer.from('attachment') }],
    })
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({ raw: original.toString('base64url') })
    ;(client.post as Mock).mockResolvedValue({ id: 'forwarded', threadId: 'new-thread' })

    await forwardMessage(client, 'original-id', ['new@example.com'], 'FYI')

    const request = (client.post as Mock).mock.calls[0][1] as { raw: string }
    const forwarded = await parseMimeMessage(base64UrlToBuffer(request.raw))
    expect(forwarded.bcc).toBeUndefined()
    expect(forwarded.headers.has('x-google-internal-trace')).toBe(false)
    expect(forwarded.text).toContain('FYI')
    expect(forwarded.text).toContain('Original body')
    expect(forwarded.text).not.toContain('secret@example.com')
    expect(forwarded.text).not.toContain('do-not-forward')
    expect(forwarded.attachments[0]?.content.toString()).toBe('attachment')
  })

  test('preserves an HTML-only body as HTML', async () => {
    const original = await buildMimeMessage({
      from: 'sender@example.com',
      to: ['recipient@example.com'],
      subject: 'HTML original',
      body: '<section><strong>Rich content</strong></section>',
      contentType: 'text/html',
    })
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({ raw: original.toString('base64url') })
    ;(client.post as Mock).mockResolvedValue({ id: 'forwarded', threadId: 'new-thread' })

    await forwardMessage(client, 'original-id', ['new@example.com'], 'Please review')

    const request = (client.post as Mock).mock.calls[0][1] as { raw: string }
    const forwarded = await parseMimeMessage(base64UrlToBuffer(request.raw))
    expect(forwarded.html).toContain('<strong>Rich content</strong>')
    expect(forwarded.html).toContain('Please review')
  })
})
