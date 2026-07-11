import type { EmailAddress, MessageSummary, SendMessageOptions } from '../types.js'

export interface GraphEmailAddress {
  emailAddress: {
    name?: string
    address: string
  }
}

export interface GraphMessageBody {
  contentType: string
  content: string
}

export interface GraphMessage {
  id: string
  subject?: string
  from?: GraphEmailAddress
  toRecipients?: GraphEmailAddress[]
  ccRecipients?: GraphEmailAddress[]
  bccRecipients?: GraphEmailAddress[]
  receivedDateTime?: string
  sentDateTime?: string
  lastModifiedDateTime?: string
  bodyPreview?: string
  body?: GraphMessageBody
  isRead?: boolean
  isDraft?: boolean
  hasAttachments?: boolean
  importance?: string
  conversationId?: string
  internetMessageId?: string
  flag?: { flagStatus: string }
  categories?: string[]
  parentFolderId?: string
  internetMessageHeaders?: Array<{ name: string; value: string }>
}

export interface GraphMessageList {
  value: GraphMessage[]
  '@odata.nextLink'?: string
  '@odata.count'?: number
}

type GraphMessageBuildOptions = Pick<
  SendMessageOptions,
  'to' | 'cc' | 'bcc' | 'subject' | 'body' | 'bodyType' | 'importance'
>

export interface GraphMessagePayload {
  subject: string
  body: GraphMessageBody
  toRecipients: GraphEmailAddress[]
  ccRecipients?: GraphEmailAddress[]
  bccRecipients?: GraphEmailAddress[]
  importance: NonNullable<SendMessageOptions['importance']>
}

export function toGraphAddress(address: string): GraphEmailAddress {
  return { emailAddress: { address } }
}

export function fromGraphAddress(address?: GraphEmailAddress): EmailAddress {
  if (!address) return { address: '' }
  return {
    name: address.emailAddress.name,
    address: address.emailAddress.address,
  }
}

export function fromGraphAddresses(addresses?: GraphEmailAddress[]): EmailAddress[] {
  return (addresses || []).map(fromGraphAddress)
}

export function normalizeMessageSummary(message: GraphMessage): MessageSummary {
  return {
    id: message.id,
    subject: message.subject || '(no subject)',
    from: fromGraphAddress(message.from),
    to: fromGraphAddresses(message.toRecipients),
    date: message.receivedDateTime || '',
    snippet: message.bodyPreview,
    isRead: message.isRead ?? false,
    hasAttachments: message.hasAttachments ?? false,
    labels: message.categories,
    folder: message.parentFolderId,
  }
}

export function buildGraphMessage(options: GraphMessageBuildOptions): GraphMessagePayload {
  const message: GraphMessagePayload = {
    subject: options.subject,
    body: {
      contentType: options.bodyType === 'html' ? 'HTML' : 'Text',
      content: options.body,
    },
    toRecipients: options.to.map(toGraphAddress),
    importance: options.importance || 'normal',
  }

  if (options.cc?.length) {
    message.ccRecipients = options.cc.map(toGraphAddress)
  }
  if (options.bcc?.length) {
    message.bccRecipients = options.bcc.map(toGraphAddress)
  }

  return message
}
