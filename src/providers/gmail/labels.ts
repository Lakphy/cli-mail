// Gmail label operations (labels serve as folders in Gmail)

import type { HttpClient } from '../../utils/http.js'
import type { FolderInfo } from '../types.js'

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

export async function listLabels(client: HttpClient): Promise<FolderInfo[]> {
  const list = await client.get<GmailLabelList>('/labels')
  return (list.labels || []).map(normalizeLabel)
}

export async function getLabel(client: HttpClient, id: string): Promise<FolderInfo> {
  const label = await client.get<GmailLabel>(`/labels/${id}`)
  return normalizeLabel(label)
}

export async function createLabel(
  client: HttpClient,
  name: string,
): Promise<FolderInfo> {
  const label = await client.post<GmailLabel>('/labels', {
    name,
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show',
  })
  return normalizeLabel(label)
}

export async function updateLabel(
  client: HttpClient,
  id: string,
  name: string,
): Promise<FolderInfo> {
  const label = await client.patch<GmailLabel>(`/labels/${id}`, { name })
  return normalizeLabel(label)
}

export async function deleteLabel(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.delete(`/labels/${id}`)
}

function normalizeLabel(label: GmailLabel): FolderInfo {
  return {
    id: label.id,
    name: label.name,
    messageCount: label.messagesTotal,
    unreadCount: label.messagesUnread,
  }
}
