// Outlook draft operations via Microsoft Graph API

import type { HttpClient } from '../../utils/http.js'
import type { DraftSummary, DraftDetail } from '../types.js'
import {
  buildGraphMessage,
  fromGraphAddress,
  fromGraphAddresses,
  toGraphAddress,
  type GraphMessage,
  type GraphMessageList,
} from './graph.js'
import { pageMetadata, validateGraphNextLink, type OutlookPageMetadata } from './pagination.js'

export interface OutlookDraftPage extends OutlookPageMetadata {
  drafts: DraftSummary[]
}

export interface OutlookDraftListOptions {
  top?: number
  pageToken?: string
}

export async function listDrafts(
  client: HttpClient,
  options: OutlookDraftListOptions = {},
): Promise<OutlookDraftPage> {
  const path = '/mailFolders/Drafts/messages'

  const list = options.pageToken
    ? await client.get<GraphMessageList>(validateGraphNextLink(options.pageToken, path))
    : await client.get<GraphMessageList>(path, {
        '$top': options.top ?? 20,
        '$select': 'id,subject,toRecipients,bodyPreview,lastModifiedDateTime',
        '$orderby': 'lastModifiedDateTime desc',
      })

  return {
    drafts: (list.value || []).map(normalizeDraftSummary),
    ...pageMetadata(list['@odata.nextLink']),
  }
}

export async function getDraft(
  client: HttpClient,
  id: string,
): Promise<DraftDetail> {
  const msg = await client.get<GraphMessage>(`/messages/${encodeURIComponent(id)}`, {
    '$select': 'id,subject,from,toRecipients,ccRecipients,bccRecipients,body,bodyPreview,lastModifiedDateTime',
  })
  return normalizeDraftDetail(msg)
}

export async function createDraft(
  client: HttpClient,
  options: {
    to: string[]
    subject: string
    body: string
    cc?: string[]
    bcc?: string[]
    bodyType?: 'text' | 'html'
  },
): Promise<{ id: string }> {
  const result = await client.post<GraphMessage>('/messages', buildGraphMessage(options))
  return { id: result.id }
}

export async function updateDraft(
  client: HttpClient,
  id: string,
  options: {
    to?: string[]
    subject?: string
    body?: string
    cc?: string[]
    bcc?: string[]
    bodyType?: 'text' | 'html'
  },
): Promise<{ id: string }> {
  const updates: Record<string, unknown> = {}

  if (options.subject !== undefined) {
    updates.subject = options.subject
  }
  if (options.body !== undefined || options.bodyType !== undefined) {
    let existingBody: GraphMessage['body']
    if (options.body === undefined || options.bodyType === undefined) {
      const existing = await client.get<GraphMessage>(`/messages/${encodeURIComponent(id)}`, {
        '$select': 'body',
      })
      existingBody = existing.body
    }

    updates.body = {
      contentType: options.bodyType
        ? (options.bodyType === 'html' ? 'HTML' : 'Text')
        : (existingBody?.contentType || 'Text'),
      content: options.body ?? existingBody?.content ?? '',
    }
  }
  if (options.to) {
    updates.toRecipients = options.to.map(toGraphAddress)
  }
  if (options.cc) {
    updates.ccRecipients = options.cc.map(toGraphAddress)
  }
  if (options.bcc) {
    updates.bccRecipients = options.bcc.map(toGraphAddress)
  }

  if (Object.keys(updates).length === 0) {
    throw new TypeError('At least one draft field must be provided')
  }

  const result = await client.patch<GraphMessage | undefined>(`/messages/${encodeURIComponent(id)}`, updates)
  return { id: result?.id || id }
}

export async function sendDraft(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.post(`/messages/${encodeURIComponent(id)}/send`)
}

export async function deleteDraft(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.delete(`/messages/${encodeURIComponent(id)}`)
}

function normalizeDraftSummary(msg: GraphMessage): DraftSummary {
  return {
    id: msg.id,
    subject: msg.subject || '(no subject)',
    to: fromGraphAddresses(msg.toRecipients),
    snippet: msg.bodyPreview,
    updatedAt: msg.lastModifiedDateTime,
  }
}

function normalizeDraftDetail(msg: GraphMessage): DraftDetail {
  return {
    id: msg.id,
    subject: msg.subject || '(no subject)',
    to: fromGraphAddresses(msg.toRecipients),
    cc: fromGraphAddresses(msg.ccRecipients),
    bcc: fromGraphAddresses(msg.bccRecipients),
    snippet: msg.bodyPreview,
    body: msg.body?.content || '',
    bodyType: msg.body?.contentType?.toLowerCase() === 'html' ? 'html' : 'text',
    from: msg.from ? fromGraphAddress(msg.from) : undefined,
    updatedAt: msg.lastModifiedDateTime,
  }
}
