// Outlook message operations via Microsoft Graph API

import type { HttpClient } from '../../utils/http.js'
import type {
  MessageSummary,
  MessageDetail,
  SendMessageOptions,
  ListOptions,
} from '../types.js'
import { basename } from 'node:path'
import { addAttachment, MAX_ATTACHMENT_SIZE } from './attachments.js'
import {
  buildGraphMessage,
  fromGraphAddress,
  fromGraphAddresses,
  normalizeMessageSummary,
  toGraphAddress,
  type GraphMessage,
  type GraphMessageList,
} from './graph.js'
import { pageMetadata, validateGraphNextLink, type OutlookPageMetadata } from './pagination.js'
import { ApiError, ProviderError } from '../../utils/error.js'

export interface OutlookMessagePage extends OutlookPageMetadata {
  messages: MessageSummary[]
}

export interface OutlookMessageMutationResult {
  /** Immutable message ID returned by Graph. */
  id: string
  permanentlyDeleted?: boolean
}

export const attachmentLimits = {
  maxFileBytes: MAX_ATTACHMENT_SIZE,
  assertTotalSize(_totalBytes: number): void {
    // Microsoft Graph applies the 150 MiB limit per attachment, not per message.
  },
}

// --- Operations ---

export async function listMessages(
  client: HttpClient,
  options: ListOptions = {},
): Promise<OutlookMessagePage> {
  if (options.query && options.filter) {
    throw new TypeError('Outlook KQL search (--query) and OData filter (--filter) are mutually exclusive')
  }

  const path = options.folder
    ? `/mailFolders/${encodeURIComponent(options.folder)}/messages`
    : '/messages'
  const isSearch = !!options.query

  let list: GraphMessageList
  if (options.pageToken) {
    const nextLink = validateGraphNextLink(options.pageToken, path)
    try {
      list = await client.get<GraphMessageList>(nextLink)
    } catch (error) {
      throw attachSearchSortSuggestion(error, isSearch)
    }
  } else {
    const query: Record<string, string | number | boolean | undefined> = {
      '$top': options.top ?? 20,
      '$select': 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,importance,categories,parentFolderId',
    }

    // Microsoft Graph API does not support $orderby with $search. When
    // searching, sort the page client-side instead.
    if (!isSearch) {
      query['$orderby'] = options.orderBy || 'receivedDateTime desc'
    }

    if (options.skip !== undefined) {
      query['$skip'] = options.skip
    }
    if (options.query) {
      query['$search'] = formatKqlSearch(options.query)
    }
    if (options.filter) {
      query['$filter'] = options.filter
    }

    try {
      list = await client.get<GraphMessageList>(path, query)
    } catch (error) {
      throw attachSearchSortSuggestion(error, isSearch)
    }
  }

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
    ...pageMetadata(list['@odata.nextLink']),
  }
}

export function listMessagesSince(
  client: HttpClient,
  sinceDate: Date,
  top: number,
  pageToken?: string,
): Promise<OutlookMessagePage> {
  return listMessages(client, {
    top,
    filter: `receivedDateTime ge ${sinceDate.toISOString()}`,
    pageToken,
  })
}

export async function getMessage(
  client: HttpClient,
  id: string,
): Promise<MessageDetail> {
  const msg = await client.get<GraphMessage>(`/messages/${encodeURIComponent(id)}`, {
    '$select': 'id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,bodyPreview,body,isRead,hasAttachments,importance,conversationId,internetMessageId,flag,categories,parentFolderId,internetMessageHeaders',
  })
  return normalizeMessageDetail(msg)
}

export async function getMessageRaw(
  client: HttpClient,
  id: string,
): Promise<Buffer> {
  const response = await client.getRaw(`/messages/${encodeURIComponent(id)}/$value`)
  return Buffer.from(await response.arrayBuffer())
}

export async function sendMessage(
  client: HttpClient,
  options: SendMessageOptions,
): Promise<void> {
  const message = buildGraphMessage(options)

  if (!options.attachments?.length) {
    await client.post('/sendMail', {
      message,
      saveToSentItems: options.saveToSentItems !== false,
    })
    return
  }

  if (options.saveToSentItems === false) {
    throw new TypeError('Outlook cannot send a draft with attachments without saving it to Sent Items')
  }

  // Graph requires upload sessions for files >= 3 MiB. Creating a draft first
  // gives both small and large attachments one protocol-correct code path.
  const draft = await client.post<GraphMessage>('/messages', message)
  try {
    for (const attachment of options.attachments) {
      await addAttachment(
        client,
        draft.id,
        attachment.path,
        attachment.name || basename(attachment.path),
      )
    }
    await client.post(`/messages/${encodeURIComponent(draft.id)}/send`)
  } catch (sendError) {
    try {
      await client.delete(`/messages/${encodeURIComponent(draft.id)}`)
    } catch (cleanupError) {
      // A missing draft means there is no leftover object to clean up. This
      // can happen when Graph accepted send but the client lost the response.
      if (cleanupError instanceof ApiError && cleanupError.statusCode === 404) {
        throw sendError
      }
      throw new ProviderError(
        'Outlook send failed and the temporary draft could not be removed',
        'outlook',
        {
          draftId: draft.id,
          sendError: safeErrorDetails(sendError),
          cleanupError: safeErrorDetails(cleanupError),
        },
      )
    }
    throw sendError
  }
}

function safeErrorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) }
  const coded = error as Error & { code?: unknown; statusCode?: unknown }
  return {
    name: error.name,
    message: error.message,
    ...(typeof coded.code === 'string' ? { code: coded.code } : {}),
    ...(typeof coded.statusCode === 'number' ? { statusCode: coded.statusCode } : {}),
  }
}

export async function replyToMessage(
  client: HttpClient,
  messageId: string,
  body: string,
  replyAll = false,
): Promise<void> {
  const endpoint = replyAll
    ? `/messages/${encodeURIComponent(messageId)}/replyAll`
    : `/messages/${encodeURIComponent(messageId)}/reply`

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
  await client.post(`/messages/${encodeURIComponent(messageId)}/forward`, {
    comment: body ?? '',
    toRecipients: to.map(toGraphAddress),
  })
}

export async function deleteMessage(
  client: HttpClient,
  id: string,
  permanent = false,
  outlookUserId?: string,
): Promise<OutlookMessageMutationResult> {
  if (permanent) {
    const userId = outlookUserId || await getOutlookUserId(client)
    const path = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}/permanentDelete`
    await client.post(path)
    return { id, permanentlyDeleted: true }
  }

  // Move to DeletedItems and surface Graph's response ID. With ImmutableId it
  // remains stable, but returning it also protects callers during migrations.
  const result = await client.post<GraphMessage>(`/messages/${encodeURIComponent(id)}/move`, {
    destinationId: 'DeletedItems',
  })
  return { id: result.id }
}

export async function moveMessage(
  client: HttpClient,
  id: string,
  destinationFolderId: string,
): Promise<OutlookMessageMutationResult> {
  const result = await client.post<GraphMessage>(`/messages/${encodeURIComponent(id)}/move`, {
    destinationId: destinationFolderId,
  })
  return { id: result.id }
}

export function trashMessage(
  client: HttpClient,
  id: string,
): Promise<OutlookMessageMutationResult> {
  return moveMessage(client, id, 'deleteditems')
}

export function untrashMessage(
  client: HttpClient,
  id: string,
): Promise<OutlookMessageMutationResult> {
  return moveMessage(client, id, 'Inbox')
}

export async function copyMessage(
  client: HttpClient,
  id: string,
  destinationFolderId: string,
): Promise<{ id: string }> {
  const result = await client.post<GraphMessage>(`/messages/${encodeURIComponent(id)}/copy`, {
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
    await client.patch(`/messages/${encodeURIComponent(id)}`, updates)
  }
}

export async function searchMessages(
  client: HttpClient,
  query: string,
  top = 20,
  pageToken?: string,
): Promise<OutlookMessagePage> {
  return listMessages(client, { query, top, pageToken })
}

function formatKqlSearch(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new TypeError('Outlook KQL search query cannot be empty')
  }
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed
    : `"${trimmed}"`
}

const SEARCH_SORT_SUGGESTION =
  'Search and sorting cannot be combined for this provider. Remove the sort option and retry.'

function attachSearchSortSuggestion(error: unknown, isSearch: boolean): unknown {
  if (!(error instanceof ApiError) || error.suggestion) return error

  const graphError = `${error.message}\n${JSON.stringify(error.response ?? '')}`.toLowerCase()
  if (graphError.includes('orderbywithsearch')
    || (isSearch && (graphError.includes('$orderby') || graphError.includes('orderby')))) {
    error.suggestion = SEARCH_SORT_SUGGESTION
  }
  return error
}

const outlookUserIds = new WeakMap<HttpClient, Promise<string>>()

async function getOutlookUserId(client: HttpClient): Promise<string> {
  let pending = outlookUserIds.get(client)
  if (!pending) {
    pending = client.get<{ id?: string }>('', { '$select': 'id' }).then((profile) => {
      if (!profile.id) {
        throw new TypeError('Microsoft Graph profile response did not contain a user ID')
      }
      return profile.id
    })
    outlookUserIds.set(client, pending)
  }

  try {
    return await pending
  } catch (error) {
    outlookUserIds.delete(client)
    throw error
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
