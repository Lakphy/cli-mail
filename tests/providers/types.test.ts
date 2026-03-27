import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// Provider Types Tests
// ==========================================================

import type {
  EmailAddress, MessageSummary, MessageDetail, DraftSummary,
  DraftDetail, FolderInfo, AttachmentSummary, AttachmentDetail,
  RuleInfo, MailboxSettings, SendMessageOptions, ListOptions,
} from '../../src/providers/types'

describe('Provider Types', () => {
  test('EmailAddress has required address field', () => {
    const addr: EmailAddress = { address: 'test@example.com' }
    expect(addr.address).toBe('test@example.com')
    expect(addr.name).toBeUndefined()
  })

  test('EmailAddress can have optional name', () => {
    const addr: EmailAddress = { name: 'Test User', address: 'test@example.com' }
    expect(addr.name).toBe('Test User')
  })

  test('SendMessageOptions structure', () => {
    const opts: SendMessageOptions = {
      to: ['a@b.com'],
      subject: 'Hi',
      body: 'Hello',
      bodyType: 'text',
      importance: 'high',
    }
    expect(opts.to).toHaveLength(1)
    expect(opts.importance).toBe('high')
  })

  test('ListOptions defaults', () => {
    const opts: ListOptions = {}
    expect(opts.top).toBeUndefined()
    expect(opts.query).toBeUndefined()
  })

  test('MessageDetail extends MessageSummary', () => {
    const detail: MessageDetail = {
      id: 'msg1', subject: 'Test', from: { address: 'a@b.com' },
      to: [{ address: 'c@d.com' }], date: '2024-01-01', isRead: true,
      hasAttachments: false, body: 'Hello', bodyType: 'text',
    }
    expect(detail.body).toBe('Hello')
    expect(detail.id).toBe('msg1')
  })

  test('FolderInfo structure', () => {
    const folder: FolderInfo = {
      id: 'f1', name: 'Inbox', messageCount: 42, unreadCount: 5,
    }
    expect(folder.name).toBe('Inbox')
    expect(folder.messageCount).toBe(42)
  })

  test('AttachmentDetail extends AttachmentSummary', () => {
    const att: AttachmentDetail = {
      id: 'a1', name: 'file.pdf', contentType: 'application/pdf',
      size: 1024, content: 'base64data',
    }
    expect(att.content).toBe('base64data')
  })

  test('MailboxSettings structure', () => {
    const settings: MailboxSettings = {
      automaticReplies: {
        status: 'enabled',
        internalReplyMessage: 'OOO',
        externalReplyMessage: 'OOO external',
      },
      language: 'en',
      timeZone: 'UTC',
    }
    expect(settings.automaticReplies?.status).toBe('enabled')
  })
})
