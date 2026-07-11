// Gmail thread operations

import type { HttpClient } from '../../utils/http.js'
import type { MessageSummary } from '../types.js'
import {
  getHeader,
  type GmailPayload,
} from '../../utils/mime.js'
import {
  normalizeMessageSummary,
  settledMapWithConcurrency,
  settledValuesAndErrors,
  type GmailItemError,
} from './helpers.js'

const DETAIL_CONCURRENCY = 8

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

export interface ThreadListOptions {
  query?: string
  top?: number
  labelIds?: string
  pageToken?: string
}

export interface ThreadListResult {
  threads: ThreadSummary[]
  nextPageToken?: string
  errors?: GmailItemError[]
}

export async function listThreads(
  client: HttpClient,
  options: ThreadListOptions = {},
): Promise<ThreadListResult> {
  const query: Record<string, string | number | boolean | string[] | undefined> = {
    maxResults: options.top ?? 20,
  }
  if (options.query) query.q = options.query
  if (options.labelIds) query.labelIds = options.labelIds
  if (options.pageToken) query.pageToken = options.pageToken

  const list = await client.get<GmailThreadList>('/threads', query)

  if (!list.threads || list.threads.length === 0) {
    return { threads: [], nextPageToken: list.nextPageToken }
  }

  // Fetch each thread metadata
  const settled = await settledMapWithConcurrency(
    list.threads,
    DETAIL_CONCURRENCY,
    (thread) => client.get<GmailThread>(`/threads/${thread.id}`, {
      format: 'metadata',
      metadataHeaders: ['Subject', 'Date'],
    }),
  )
  const { values, errors } = settledValuesAndErrors(
    list.threads.map((thread) => thread.id),
    settled,
  )

  return {
    threads: values.map(normalizeThreadSummary),
    nextPageToken: list.nextPageToken,
    ...(errors.length > 0 ? { errors } : {}),
  }
}

export async function getThread(
  client: HttpClient,
  id: string,
): Promise<ThreadDetail> {
  const thread = await client.get<GmailThread>(`/threads/${id}`, { format: 'full' })
  return {
    id: thread.id,
    messages: (thread.messages || []).map(normalizeMessageSummary),
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
