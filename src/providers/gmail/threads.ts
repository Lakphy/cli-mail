// Gmail thread operations

import type { HttpClient } from '../../utils/http.js'
import type { MessageSummary, EmailAddress } from '../types.js'
import { getHeader, type GmailPayload } from '../../utils/mime.js'

interface GmailThread {
  id: string
  historyId?: string
  messages?: GmailThreadMessage[]
  snippet?: string
}

interface GmailThreadMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  payload?: GmailPayload
  internalDate?: string
}

interface GmailThreadList {
  threads?: Array<{ id: string; snippet?: string; historyId?: string }>
  nextPageToken?: string
  resultSizeEstimate?: number
}

export interface ThreadSummary {
  id: string
  snippet: string
  messageCount: number
  subject: string
  lastDate: string
}

export interface ThreadDetail {
  id: string
  messages: MessageSummary[]
}

export async function listThreads(
  client: HttpClient,
  options: { query?: string; top?: number; labelIds?: string } = {},
): Promise<{ threads: ThreadSummary[]; nextPageToken?: string }> {
  const query: Record<string, string | number | boolean | undefined> = {
    maxResults: options.top || 20,
  }
  if (options.query) query.q = options.query
  if (options.labelIds) query.labelIds = options.labelIds

  const list = await client.get<GmailThreadList>('/threads', query)

  if (!list.threads || list.threads.length === 0) {
    return { threads: [], nextPageToken: list.nextPageToken }
  }

  // Fetch each thread metadata
  const threads = await Promise.all(
    list.threads.map((t) => client.get<GmailThread>(`/threads/${t.id}`, { format: 'metadata', metadataHeaders: 'Subject,Date' })),
  )

  return {
    threads: threads.map(normalizeThreadSummary),
    nextPageToken: list.nextPageToken,
  }
}

export async function getThread(
  client: HttpClient,
  id: string,
): Promise<ThreadDetail> {
  const thread = await client.get<GmailThread>(`/threads/${id}`, { format: 'full' })
  return {
    id: thread.id,
    messages: (thread.messages || []).map(normalizeThreadMessage),
  }
}

export async function modifyThread(
  client: HttpClient,
  id: string,
  addLabels?: string[],
  removeLabels?: string[],
): Promise<void> {
  await client.post(`/threads/${id}/modify`, {
    addLabelIds: addLabels || [],
    removeLabelIds: removeLabels || [],
  })
}

export async function trashThread(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.post(`/threads/${id}/trash`)
}

export async function untrashThread(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.post(`/threads/${id}/untrash`)
}

export async function deleteThread(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.delete(`/threads/${id}`)
}

// --- Helpers ---

function parseEmailAddress(raw: string): EmailAddress {
  const match = raw.match(/^(.+?)\s*<(.+?)>$/)
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ''), address: match[2] }
  }
  return { address: raw.trim() }
}

function parseEmailAddresses(raw: string): EmailAddress[] {
  if (!raw) return []
  return raw.split(',').map((addr) => parseEmailAddress(addr.trim()))
}

function normalizeThreadSummary(thread: GmailThread): ThreadSummary {
  const messages = thread.messages || []
  const lastMsg = messages[messages.length - 1]
  const headers = lastMsg?.payload?.headers || []

  return {
    id: thread.id,
    snippet: thread.snippet || '',
    messageCount: messages.length,
    subject: getHeader(headers, 'Subject') || '(no subject)',
    lastDate: getHeader(headers, 'Date') || '',
  }
}

function normalizeThreadMessage(msg: GmailThreadMessage): MessageSummary {
  const headers = msg.payload?.headers || []
  return {
    id: msg.id,
    subject: getHeader(headers, 'Subject') || '(no subject)',
    from: parseEmailAddress(getHeader(headers, 'From')),
    to: parseEmailAddresses(getHeader(headers, 'To')),
    date: getHeader(headers, 'Date') || new Date(parseInt(msg.internalDate || '0')).toISOString(),
    snippet: msg.snippet,
    isRead: !(msg.labelIds || []).includes('UNREAD'),
    hasAttachments: false,
    labels: msg.labelIds,
  }
}
