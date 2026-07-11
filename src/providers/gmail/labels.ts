// Gmail label operations (labels serve as folders in Gmail)

import type { HttpClient } from '../../utils/http.js'
import type { FolderInfo } from '../types.js'
import { settledMapWithConcurrency } from './helpers.js'

const DETAIL_CONCURRENCY = 8

interface GmailLabel {
  id: string
  name: string
  messageListVisibility?: string
  labelListVisibility?: string
  type?: string
  messagesTotal?: number
  messagesUnread?: number
  threadsTotal?: number
  threadsUnread?: number
  color?: { textColor?: string; backgroundColor?: string }
}

interface GmailLabelList {
  labels: GmailLabel[]
}

export async function listLabels(
  client: HttpClient,
  options: { includeCounts?: boolean } = {},
): Promise<FolderInfo[]> {
  const list = await client.get<GmailLabelList>('/labels')
  const labels = list.labels ?? []

  // users.labels.list only promises identity/visibility fields. Counts belong
  // to users.labels.get and must never be inferred from the list response.
  if (!options.includeCounts || labels.length === 0) {
    return labels.map((label) => normalizeLabel(label, false))
  }

  const details = await settledMapWithConcurrency(
    labels,
    DETAIL_CONCURRENCY,
    (label) => client.get<GmailLabel>(`/labels/${label.id}`),
  )
  return labels.map((label, index) => {
    const detail = details[index]
    return detail.status === 'fulfilled'
      ? normalizeLabel(detail.value, true)
      : normalizeLabel(label, false)
  })
}

export async function getLabel(client: HttpClient, id: string): Promise<FolderInfo> {
  const label = await client.get<GmailLabel>(`/labels/${id}`)
  return normalizeLabel(label, true)
}

export async function createLabel(
  client: HttpClient,
  name: string,
  parent?: string,
): Promise<FolderInfo> {
  const nestedName = parent ? `${parent}/${name}` : name
  const label = await client.post<GmailLabel>('/labels', {
    name: nestedName,
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show',
  })
  return normalizeLabel(label, true)
}

export async function updateLabel(
  client: HttpClient,
  id: string,
  name: string,
): Promise<FolderInfo> {
  const label = await client.patch<GmailLabel>(`/labels/${id}`, { name })
  return normalizeLabel(label, true)
}

export async function deleteLabel(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.delete(`/labels/${id}`)
}

function normalizeLabel(label: GmailLabel, includeCounts: boolean): FolderInfo {
  return {
    id: label.id,
    name: label.name,
    ...(includeCounts
      ? {
          messageCount: label.messagesTotal,
          unreadCount: label.messagesUnread,
        }
      : {}),
  }
}
