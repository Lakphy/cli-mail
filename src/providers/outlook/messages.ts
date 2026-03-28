// Outlook message operations via Microsoft Graph API

import type { HttpClient } from '../../utils/http.js'
import type {
  MessageSummary,
  MessageDetail,
  SendMessageOptions,
  ListOptions,
  EmailAddress,
} from '../types.js'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

// --- Microsoft Graph API response types ---

interface GraphEmailAddress {
  emailAddress: {
    name?: string
    address: string
  }
}

interface GraphMessage {
  id: string
  subject?: string
  from?: GraphEmailAddress
  toRecipients?: GraphEmailAddress[]
  ccRecipients?: GraphEmailAddress[]
  bccRecipients?: GraphEmailAddress[]
  receivedDateTime?: string
  sentDateTime?: string
  bodyPreview?: string
  body?: { contentType: string; content: string }
  isRead?: boolean
  hasAttachments?: boolean
  importance?: string
  conversationId?: string
  internetMessageId?: string
  flag?: { flagStatus: string }
  categories?: string[]
  parentFolderId?: string
  internetMessageHeaders?: Array<{ name: string; value: string }>
}

interface GraphMessageList {
  value: GraphMessage[]
  '@odata.nextLink'?: string
  '@odata.count'?: number
}

// --- Operations ---

export async function listMessages(
  client: HttpClient,
  options: ListOptions = {},
): Promise<{ messages: MessageSummary[]; nextLink?: string }> {
  const query: Record<string, string | number | boolean | undefined> = {
    '$top': options.top || 20,
    '$select': 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,importance,categories,parentFolderId',
  }

  // Microsoft Graph API does not support $orderby with $search
  // When searching, we sort client-side instead
  const isSearch = !!options.query
  if (!isSearch) {
    query['$orderby'] = options.orderBy || 'receivedDateTime desc'
  }

  if (options.skip) {
    query['$skip'] = options.skip
  }
  if (options.query) {
    query['$search'] = `"${options.query}"`
  }
  if (options.filter) {
    query['$filter'] = options.filter
  }

  const path = options.folder
    ? `/mailFolders/${options.folder}/messages`
    : '/messages'

  const list = await client.get<GraphMessageList>(path, query)

  let messages = (list.value || []).map(normalizeMessageSummary)

  // Client-side sort by date descending when search is used (since $orderby is not supported)
  if (isSearch) {
    messages = messages.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0
      const dateB = b.date ? new Date(b.date).getTime() : 0
      return dateB - dateA
    })
  }

  return {
    messages,
    nextLink: list['@odata.nextLink'],
  }
}

export async function getMessage(
  client: HttpClient,
  id: string,
): Promise<MessageDetail> {
  const msg = await client.get<GraphMessage>(`/messages/${id}`, {
    '$select': 'id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,bodyPreview,body,isRead,hasAttachments,importance,conversationId,internetMessageId,flag,categories,parentFolderId,internetMessageHeaders',
  })
  return normalizeMessageDetail(msg)
}

export async function getMessageRaw(
  client: HttpClient,
  id: string,
): Promise<string> {
  const response = await client.getRaw(`/messages/${id}/$value`)
  return response.text()
}

export async function sendMessage(
  client: HttpClient,
  options: SendMessageOptions,
): Promise<void> {
  const message: Record<string, unknown> = {
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

  if (options.attachments && options.attachments.length > 0) {
    message.attachments = options.attachments.map((a) => {
      const content = readFileSync(a.path)
      return {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.name || basename(a.path),
        contentBytes: content.toString('base64'),
      }
    })
  }

  await client.post('/sendMail', {
    message,
    saveToSentItems: options.saveToSentItems !== false,
  })
}

export async function createMessage(
  client: HttpClient,
  options: {
    subject: string
    body: string
    bodyType?: 'text' | 'html'
    to: string[]
    cc?: string[]
    bcc?: string[]
    importance?: string
  },
): Promise<{ id: string }> {
  const message: Record<string, unknown> = {
    subject: options.subject,
    body: {
      contentType: options.bodyType === 'html' ? 'HTML' : 'Text',
      content: options.body,
    },
    toRecipients: options.to.map(toGraphAddress),
  }

  if (options.cc?.length) message.ccRecipients = options.cc.map(toGraphAddress)
  if (options.bcc?.length) message.bccRecipients = options.bcc.map(toGraphAddress)
  if (options.importance) message.importance = options.importance

  const result = await client.post<GraphMessage>('/messages', message)
  return { id: result.id }
}

export async function replyToMessage(
  client: HttpClient,
  messageId: string,
  body: string,
  replyAll = false,
): Promise<void> {
  const endpoint = replyAll
    ? `/messages/${messageId}/replyAll`
    : `/messages/${messageId}/reply`

  await client.post(endpoint, {
    comment: body,
  })
}

export async function forwardMessage(
  client: HttpClient,
  messageId: string,
  to: string[],
  body?: string,
): Promise<void> {
  await client.post(`/messages/${messageId}/forward`, {
    comment: body || '',
    toRecipients: to.map(toGraphAddress),
  })
}

export async function deleteMessage(
  client: HttpClient,
  id: string,
  permanent = false,
): Promise<void> {
  if (permanent) {
    await client.delete(`/messages/${id}`)
  } else {
    // Move to DeletedItems
    await client.post(`/messages/${id}/move`, {
      destinationId: 'DeletedItems',
    })
  }
}

export async function moveMessage(
  client: HttpClient,
  id: string,
  destinationFolderId: string,
): Promise<void> {
  await client.post(`/messages/${id}/move`, {
    destinationId: destinationFolderId,
  })
}

export async function copyMessage(
  client: HttpClient,
  id: string,
  destinationFolderId: string,
): Promise<{ id: string }> {
  const result = await client.post<GraphMessage>(`/messages/${id}/copy`, {
    destinationId: destinationFolderId,
  })
  return { id: result.id }
}

export async function markMessage(
  client: HttpClient,
  id: string,
  options: { read?: boolean; flagged?: boolean; importance?: string },
): Promise<void> {
  const updates: Record<string, unknown> = {}

  if (options.read !== undefined) {
    updates.isRead = options.read
  }
  if (options.flagged !== undefined) {
    updates.flag = { flagStatus: options.flagged ? 'flagged' : 'notFlagged' }
  }
  if (options.importance) {
    updates.importance = options.importance
  }

  if (Object.keys(updates).length > 0) {
    await client.patch(`/messages/${id}`, updates)
  }
}

export async function searchMessages(
  client: HttpClient,
  query: string,
  top = 20,
): Promise<{ messages: MessageSummary[]; nextLink?: string }> {
  return listMessages(client, { query, top })
}

// --- Helpers ---

function toGraphAddress(addr: string): GraphEmailAddress {
  return { emailAddress: { address: addr } }
}

function fromGraphAddress(addr?: GraphEmailAddress): EmailAddress {
  if (!addr) return { address: '' }
  return {
    name: addr.emailAddress.name,
    address: addr.emailAddress.address,
  }
}

function fromGraphAddresses(addrs?: GraphEmailAddress[]): EmailAddress[] {
  return (addrs || []).map(fromGraphAddress)
}

function normalizeMessageSummary(msg: GraphMessage): MessageSummary {
  return {
    id: msg.id,
    subject: msg.subject || '(no subject)',
    from: fromGraphAddress(msg.from),
    to: fromGraphAddresses(msg.toRecipients),
    date: msg.receivedDateTime || '',
    snippet: msg.bodyPreview,
    isRead: msg.isRead ?? false,
    hasAttachments: msg.hasAttachments ?? false,
    labels: msg.categories,
    folder: msg.parentFolderId,
  }
}

function normalizeMessageDetail(msg: GraphMessage): MessageDetail {
  const headers: Record<string, string> = {}
  if (msg.internetMessageHeaders) {
    for (const h of msg.internetMessageHeaders) {
      headers[h.name] = h.value
    }
  }

  return {
    id: msg.id,
    subject: msg.subject || '(no subject)',
    from: fromGraphAddress(msg.from),
    to: fromGraphAddresses(msg.toRecipients),
    cc: fromGraphAddresses(msg.ccRecipients),
    bcc: fromGraphAddresses(msg.bccRecipients),
    date: msg.receivedDateTime || msg.sentDateTime || '',
    snippet: msg.bodyPreview,
    isRead: msg.isRead ?? false,
    hasAttachments: msg.hasAttachments ?? false,
    body: msg.body?.content || '',
    bodyType: msg.body?.contentType?.toLowerCase() === 'html' ? 'html' : 'text',
    conversationId: msg.conversationId,
    internetMessageId: msg.internetMessageId,
    importance: msg.importance,
    categories: msg.categories,
    flag: msg.flag ? { status: msg.flag.flagStatus } : undefined,
    folder: msg.parentFolderId,
    headers,
  }
}
