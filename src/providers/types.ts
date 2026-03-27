// Shared provider interfaces and types

import type { HttpClient } from '../utils/http.js'
import type { AccountConfig, Provider } from '../config/types.js'

// --- Unified types used across providers ---

export interface EmailAddress {
  name?: string
  address: string
}

export interface MessageSummary {
  id: string
  subject: string
  from: EmailAddress
  to: EmailAddress[]
  date: string
  snippet?: string
  isRead: boolean
  hasAttachments: boolean
  folder?: string
  labels?: string[]
}

export interface MessageDetail extends MessageSummary {
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  body: string
  bodyType: 'text' | 'html'
  threadId?: string
  conversationId?: string
  internetMessageId?: string
  importance?: string
  categories?: string[]
  flag?: { status: string }
  attachments?: AttachmentSummary[]
  headers?: Record<string, string>
}

export interface DraftSummary {
  id: string
  subject: string
  to: EmailAddress[]
  snippet?: string
  updatedAt?: string
}

export interface DraftDetail extends DraftSummary {
  body: string
  bodyType: 'text' | 'html'
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  from?: EmailAddress
}

export interface FolderInfo {
  id: string
  name: string
  parentId?: string
  messageCount?: number
  unreadCount?: number
  childFolderCount?: number
}

export interface AttachmentSummary {
  id: string
  name: string
  contentType: string
  size: number
  isInline?: boolean
}

export interface AttachmentDetail extends AttachmentSummary {
  content?: string // base64 encoded
}

export interface RuleInfo {
  id: string
  name?: string
  isEnabled?: boolean
  conditions?: unknown
  actions?: unknown
}

export interface MailboxSettings {
  automaticReplies?: {
    status: string
    internalReplyMessage?: string
    externalReplyMessage?: string
    startDateTime?: string
    endDateTime?: string
  }
  language?: string
  timeZone?: string
  [key: string]: unknown
}

export interface SendMessageOptions {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body: string
  bodyType?: 'text' | 'html'
  attachments?: Array<{ name: string; path: string }>
  importance?: 'low' | 'normal' | 'high'
  saveToSentItems?: boolean
}

export interface ListOptions {
  top?: number
  skip?: number
  query?: string
  folder?: string
  orderBy?: string
}

export interface ReplyOptions {
  messageId: string
  body: string
  replyAll?: boolean
}

export interface ForwardOptions {
  messageId: string
  to: string[]
  body?: string
}

// --- Provider context used by all providers ---

export interface ProviderContext {
  account: AccountConfig
  client: HttpClient
  provider: Provider
}
