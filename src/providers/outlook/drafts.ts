// Outlook draft operations via Microsoft Graph API

import type { HttpClient } from '../../utils/http.js'
import type { DraftSummary, DraftDetail, EmailAddress } from '../types.js'

interface GraphEmailAddress {
  emailAddress: { name?: string; address: string }
}

interface GraphMessage {
  id: string
  subject?: string
  from?: GraphEmailAddress
  toRecipients?: GraphEmailAddress[]
  ccRecipients?: GraphEmailAddress[]
  bccRecipients?: GraphEmailAddress[]
  body?: { contentType: string; content: string }
  bodyPreview?: string
  lastModifiedDateTime?: string
  isDraft?: boolean
}

interface GraphMessageList {
  value: GraphMessage[]
  '@odata.nextLink'?: string
}

export async function listDrafts(
  client: HttpClient,
  top = 20,
): Promise<{ drafts: DraftSummary[]; nextLink?: string }> {
  const list = await client.get<GraphMessageList>('/mailFolders/Drafts/messages', {
    '$top': top,
    '$select': 'id,subject,toRecipients,bodyPreview,lastModifiedDateTime',
    '$orderby': 'lastModifiedDateTime desc',
  })

  return {
    drafts: (list.value || []).map(normalizeDraftSummary),
    nextLink: list['@odata.nextLink'],
  }
}

export async function getDraft(
  client: HttpClient,
  id: string,
): Promise<DraftDetail> {
  const msg = await client.get<GraphMessage>(`/messages/${id}`, {
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
  const draft: Record<string, unknown> = {
    subject: options.subject,
    body: {
      contentType: options.bodyType === 'html' ? 'HTML' : 'Text',
      content: options.body,
    },
    toRecipients: options.to.map(toGraphAddress),
  }

  if (options.cc?.length) {
    draft.ccRecipients = options.cc.map(toGraphAddress)
  }
  if (options.bcc?.length) {
    draft.bccRecipients = options.bcc.map(toGraphAddress)
  }

  const result = await client.post<GraphMessage>('/messages', draft)
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
  if (options.body !== undefined) {
    updates.body = {
      contentType: (options.bodyType || 'text') === 'html' ? 'HTML' : 'Text',
      content: options.body,
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

  const result = await client.patch<GraphMessage>(`/messages/${id}`, updates)
  return { id: result.id }
}

export async function sendDraft(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.post(`/messages/${id}/send`)
}

export async function deleteDraft(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.delete(`/messages/${id}`)
}

// --- Helpers ---

function toGraphAddress(addr: string): GraphEmailAddress {
  return { emailAddress: { address: addr } }
}

function fromGraphAddress(addr?: GraphEmailAddress): EmailAddress {
  if (!addr) return { address: '' }
  return { name: addr.emailAddress.name, address: addr.emailAddress.address }
}

function fromGraphAddresses(addrs?: GraphEmailAddress[]): EmailAddress[] {
  return (addrs || []).map(fromGraphAddress)
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
