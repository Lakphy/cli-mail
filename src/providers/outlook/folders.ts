// Outlook mail folder operations via Microsoft Graph API

import type { HttpClient } from '../../utils/http.js'
import type { FolderInfo, MessageSummary, EmailAddress } from '../types.js'

interface GraphFolder {
  id: string
  displayName: string
  parentFolderId?: string
  childFolderCount?: number
  totalItemCount?: number
  unreadItemCount?: number
  isHidden?: boolean
}

interface GraphFolderList {
  value: GraphFolder[]
  '@odata.nextLink'?: string
}

interface GraphEmailAddress {
  emailAddress: { name?: string; address: string }
}

interface GraphMessage {
  id: string
  subject?: string
  from?: GraphEmailAddress
  toRecipients?: GraphEmailAddress[]
  receivedDateTime?: string
  bodyPreview?: string
  isRead?: boolean
  hasAttachments?: boolean
  categories?: string[]
  parentFolderId?: string
}

interface GraphMessageList {
  value: GraphMessage[]
  '@odata.nextLink'?: string
}

export async function listFolders(
  client: HttpClient,
  parentId?: string,
): Promise<FolderInfo[]> {
  const path = parentId
    ? `/mailFolders/${parentId}/childFolders`
    : '/mailFolders'

  const list = await client.get<GraphFolderList>(path, {
    '$top': 100,
    '$select': 'id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount',
  })

  return (list.value || []).map(normalizeFolder)
}

export async function getFolder(
  client: HttpClient,
  id: string,
): Promise<FolderInfo> {
  const folder = await client.get<GraphFolder>(`/mailFolders/${id}`)
  return normalizeFolder(folder)
}

export async function createFolder(
  client: HttpClient,
  name: string,
  parentId?: string,
): Promise<FolderInfo> {
  const path = parentId
    ? `/mailFolders/${parentId}/childFolders`
    : '/mailFolders'

  const folder = await client.post<GraphFolder>(path, {
    displayName: name,
  })
  return normalizeFolder(folder)
}

export async function updateFolder(
  client: HttpClient,
  id: string,
  name: string,
): Promise<FolderInfo> {
  const folder = await client.patch<GraphFolder>(`/mailFolders/${id}`, {
    displayName: name,
  })
  return normalizeFolder(folder)
}

export async function deleteFolder(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.delete(`/mailFolders/${id}`)
}

export async function moveFolder(
  client: HttpClient,
  id: string,
  destinationId: string,
): Promise<FolderInfo> {
  const folder = await client.post<GraphFolder>(`/mailFolders/${id}/move`, {
    destinationId,
  })
  return normalizeFolder(folder)
}

export async function copyFolder(
  client: HttpClient,
  id: string,
  destinationId: string,
): Promise<FolderInfo> {
  const folder = await client.post<GraphFolder>(`/mailFolders/${id}/copy`, {
    destinationId,
  })
  return normalizeFolder(folder)
}

export async function listFolderMessages(
  client: HttpClient,
  folderId: string,
  top = 20,
): Promise<{ messages: MessageSummary[]; nextLink?: string }> {
  const list = await client.get<GraphMessageList>(
    `/mailFolders/${folderId}/messages`,
    {
      '$top': top,
      '$select': 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,categories,parentFolderId',
      '$orderby': 'receivedDateTime desc',
    },
  )

  return {
    messages: (list.value || []).map(normalizeMessage),
    nextLink: list['@odata.nextLink'],
  }
}

// --- Helpers ---

function normalizeFolder(folder: GraphFolder): FolderInfo {
  return {
    id: folder.id,
    name: folder.displayName,
    parentId: folder.parentFolderId,
    messageCount: folder.totalItemCount,
    unreadCount: folder.unreadItemCount,
    childFolderCount: folder.childFolderCount,
  }
}

function fromGraphAddress(addr?: GraphEmailAddress): EmailAddress {
  if (!addr) return { address: '' }
  return { name: addr.emailAddress.name, address: addr.emailAddress.address }
}

function fromGraphAddresses(addrs?: GraphEmailAddress[]): EmailAddress[] {
  return (addrs || []).map(fromGraphAddress)
}

function normalizeMessage(msg: GraphMessage): MessageSummary {
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
