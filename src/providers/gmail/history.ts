// Gmail history operations — tracks mailbox changes since a given historyId

import type { HttpClient } from '../../utils/http.js'

interface HistoryRecord {
  id: string
  messages?: Array<{ id: string; threadId: string }>
  messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>
  messagesDeleted?: Array<{ message: { id: string; threadId: string } }>
  labelsAdded?: Array<{ message: { id: string }; labelIds: string[] }>
  labelsRemoved?: Array<{ message: { id: string }; labelIds: string[] }>
}

interface HistoryListResponse {
  history?: HistoryRecord[]
  nextPageToken?: string
  historyId: string
}

export interface HistoryOptions {
  startHistoryId: string
  labelId?: string
  historyTypes?: string[]
  maxResults?: number
  pageToken?: string
}

export async function listHistory(
  client: HttpClient,
  options: HistoryOptions,
): Promise<{ history: HistoryRecord[]; nextPageToken?: string; historyId: string }> {
  const query: Record<string, string | number | boolean | string[] | undefined> = {
    startHistoryId: options.startHistoryId,
    maxResults: options.maxResults ?? 100,
  }
  if (options.labelId) query.labelId = options.labelId
  if (options.pageToken) query.pageToken = options.pageToken
  if (options.historyTypes) {
    // Gmail API accepts repeated historyTypes params
    query.historyTypes = options.historyTypes
  }

  const result = await client.get<HistoryListResponse>('/history', query)
  return {
    history: result.history || [],
    nextPageToken: result.nextPageToken,
    historyId: result.historyId,
  }
}
