// Outlook mail folder operations via Microsoft Graph API

import type { HttpClient } from '../../utils/http.js'
import type { FolderInfo, MessageSummary } from '../types.js'
import {
  normalizeMessageSummary,
  type GraphMessageList,
} from './graph.js'
import { pageMetadata, validateGraphNextLink, type OutlookPageMetadata } from './pagination.js'

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

export interface OutlookFolderPage extends OutlookPageMetadata {
  folders: FolderInfo[]
}

export interface OutlookFolderListOptions {
  parentId?: string
  top?: number
  pageToken?: string
}

export interface OutlookFolderMessagePage extends OutlookPageMetadata {
  messages: MessageSummary[]
}

export interface OutlookFolderMessageListOptions {
  top?: number
  pageToken?: string
}

export async function listFoldersPage(
  client: HttpClient,
  options: OutlookFolderListOptions = {},
): Promise<OutlookFolderPage> {
  const path = options.parentId
    ? `/mailFolders/${encodeURIComponent(options.parentId)}/childFolders`
    : '/mailFolders'

  const list = options.pageToken
    ? await client.get<GraphFolderList>(validateGraphNextLink(options.pageToken, path))
    : await client.get<GraphFolderList>(path, {
        '$top': options.top ?? 100,
        '$select': 'id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount',
      })

  return {
    folders: (list.value || []).map(normalizeFolder),
    ...pageMetadata(list['@odata.nextLink']),
  }
}

export async function getFolder(
  client: HttpClient,
  id: string,
): Promise<FolderInfo> {
  const folder = await client.get<GraphFolder>(`/mailFolders/${encodeURIComponent(id)}`)
  return normalizeFolder(folder)
}

export async function createFolder(
  client: HttpClient,
  name: string,
  parentId?: string,
): Promise<FolderInfo> {
  const path = parentId
    ? `/mailFolders/${encodeURIComponent(parentId)}/childFolders`
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
  const folder = await client.patch<GraphFolder>(`/mailFolders/${encodeURIComponent(id)}`, {
    displayName: name,
  })
  return normalizeFolder(folder)
}

export async function deleteFolder(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.delete(`/mailFolders/${encodeURIComponent(id)}`)
}

export async function moveFolder(
  client: HttpClient,
  id: string,
  destinationId: string,
): Promise<FolderInfo> {
  const folder = await client.post<GraphFolder>(`/mailFolders/${encodeURIComponent(id)}/move`, {
    destinationId,
  })
  return normalizeFolder(folder)
}

export async function copyFolder(
  client: HttpClient,
  id: string,
  destinationId: string,
): Promise<FolderInfo> {
  const folder = await client.post<GraphFolder>(`/mailFolders/${encodeURIComponent(id)}/copy`, {
    destinationId,
  })
  return normalizeFolder(folder)
}

export async function listFolderMessages(
  client: HttpClient,
  folderId: string,
  options: OutlookFolderMessageListOptions = {},
): Promise<OutlookFolderMessagePage> {
  const path = `/mailFolders/${encodeURIComponent(folderId)}/messages`

  const list = options.pageToken
    ? await client.get<GraphMessageList>(validateGraphNextLink(options.pageToken, path))
    : await client.get<GraphMessageList>(path, {
        '$top': options.top ?? 20,
        '$select': 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,categories,parentFolderId',
        '$orderby': 'receivedDateTime desc',
      })

  return {
    messages: (list.value || []).map(normalizeMessageSummary),
    ...pageMetadata(list['@odata.nextLink']),
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
