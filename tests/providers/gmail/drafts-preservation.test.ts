import { describe, expect, test, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import { updateDraft } from '../../../src/providers/gmail/drafts'
import {
  base64UrlToBuffer,
  buildMimeMessage,
  formatEmailAddress,
  parseMimeMessage,
} from '../../../src/utils/mime'

describe('Gmail draft MIME preservation', () => {
  test('subject-only update preserves HTML, attachments, reply headers, and threadId', async () => {
    const original = await buildMimeMessage({
      from: 'Sender <sender@example.com>',
      to: [formatEmailAddress({
        name: 'Recipient "Alias" \\ Team',
        address: 'recipient@example.com',
      })],
      subject: 'Original subject',
      body: '<p>Hello <strong>HTML</strong></p>',
      contentType: 'text/html',
      messageId: '<draft-message@example.com>',
      inReplyTo: '<parent@example.com>',
      references: ['<root@example.com>', '<parent@example.com>'],
      headers: {
        'X-Custom-Trace': 'keep-me',
        'Reply-To': 'replies@example.com',
      },
      attachments: [{
        filename: '报价单.pdf',
        content: Buffer.from([0, 1, 2, 0xff]),
        contentType: 'application/pdf',
      }],
    })
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({
      id: 'draft1',
      message: {
        id: 'message1',
        threadId: 'thread1',
        raw: original.toString('base64url'),
      },
    })
    ;(client.put as Mock).mockResolvedValue({ id: 'draft1' })

    await updateDraft(client, 'draft1', { subject: 'Updated subject' })

    const request = (client.put as Mock).mock.calls[0][1] as {
      message: { raw: string; threadId: string }
    }
    const rebuilt = await parseMimeMessage(base64UrlToBuffer(request.message.raw))
    expect(request.message.threadId).toBe('thread1')
    expect(rebuilt.subject).toBe('Updated subject')
    expect(rebuilt.html).toContain('<strong>HTML</strong>')
    expect(rebuilt.messageId).toBe('<draft-message@example.com>')
    expect(rebuilt.inReplyTo).toBe('<parent@example.com>')
    expect(rebuilt.references).toEqual(['<root@example.com>', '<parent@example.com>'])
    expect(rebuilt.headers.get('x-custom-trace')).toBe('keep-me')
    expect(rebuilt.replyTo?.value[0]?.address).toBe('replies@example.com')
    expect(rebuilt.to?.value[0]).toMatchObject({
      name: 'Recipient "Alias" \\ Team',
      address: 'recipient@example.com',
    })
    expect(rebuilt.attachments).toHaveLength(1)
    expect(rebuilt.attachments[0]).toMatchObject({
      filename: '报价单.pdf',
      contentType: 'application/pdf',
    })
    expect(rebuilt.attachments[0].content).toEqual(Buffer.from([0, 1, 2, 0xff]))
  })

  test('body-only update keeps an HTML-only draft as HTML', async () => {
    const original = await buildMimeMessage({
      to: ['recipient@example.com'],
      subject: 'HTML draft',
      body: '<p>Old HTML</p>',
      contentType: 'text/html',
    })
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({
      id: 'draft-html',
      message: {
        id: 'message-html',
        threadId: 'thread-html',
        raw: original.toString('base64url'),
      },
    })
    ;(client.put as Mock).mockResolvedValue({ id: 'draft-html' })

    await updateDraft(client, 'draft-html', { body: '<p>New HTML</p>' })

    const request = (client.put as Mock).mock.calls[0][1] as {
      message: { raw: string; threadId: string }
    }
    const rebuilt = await parseMimeMessage(base64UrlToBuffer(request.message.raw))
    expect(rebuilt.html).toContain('<p>New HTML</p>')
    expect(rebuilt.text).toBeFalsy()
  })

  test('rejects CRLF injection in a replacement recipient', async () => {
    const original = await buildMimeMessage({
      to: ['recipient@example.com'],
      subject: 'Draft',
      body: 'body',
    })
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({
      id: 'draft-injection',
      message: {
        id: 'message-injection',
        threadId: 'thread-injection',
        raw: original.toString('base64url'),
      },
    })

    await expect(updateDraft(client, 'draft-injection', {
      to: ['victim@example.com\r\nBcc: attacker@example.com'],
    })).rejects.toMatchObject({ code: 'INVALID_HEADER_VALUE' })
    expect(client.put).not.toHaveBeenCalled()
  })
})
