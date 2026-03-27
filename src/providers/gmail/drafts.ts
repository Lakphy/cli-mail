// Gmail draft operations

import type { HttpClient } from '../../utils/http.js'
import type { DraftSummary, DraftDetail, EmailAddress } from '../types.js'
import { buildMimeMessage, toBase64Url, extractTextFromPayload, getHeader, type GmailPayload } from '../../utils/mime.js'

interface GmailDraft {
  id: string
  message: {
    id: string
    threadId: string
    labelIds?: string[]
    snippet?: string
    payload?: GmailPayload
    internalDate?: string
    raw?: string
  }
}

interface GmailDraftList {
  drafts?: Array<{ id: string; message: { id: string; threadId: string } }>
  nextPageToken?: string
  resultSizeEstimate?: number
}

export async function listDrafts(
  client: HttpClient,
  top = 20,
): Promise<{ drafts: DraftSummary[]; nextPageToken?: string }> {
  const list = await client.get<GmailDraftList>('/drafts', { maxResults: top })

  if (!list.drafts || list.drafts.length === 0) {
    return { drafts: [] }
  }

  const drafts = await Promise.all(
    list.drafts.map((d) => client.get<GmailDraft>(`/drafts/${d.id}`, { format: 'metadata', metadataHeaders: 'To,Subject,Date' })),
  )

  return {
    drafts: drafts.map(normalizeDraftSummary),
    nextPageToken: list.nextPageToken,
  }
}

export async function getDraft(
  client: HttpClient,
  id: string,
): Promise<DraftDetail> {
  const draft = await client.get<GmailDraft>(`/drafts/${id}`, { format: 'full' })
  return normalizeDraftDetail(draft)
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
  const mime = buildMimeMessage({
    to: options.to,
    cc: options.cc,
    bcc: options.bcc,
    subject: options.subject,
    body: options.body,
    contentType: options.bodyType === 'html' ? 'text/html' : 'text/plain',
  })

  const raw = toBase64Url(mime)
  const result = await client.post<GmailDraft>('/drafts', {
    message: { raw },
  })
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
  // Get current draft to merge
  const current = await getDraft(client, id)

  const mime = buildMimeMessage({
    to: options.to || current.to.map((a) => a.address),
    cc: options.cc || current.cc?.map((a) => a.address),
    bcc: options.bcc || current.bcc?.map((a) => a.address),
    subject: options.subject || current.subject,
    body: options.body || current.body,
    contentType: (options.bodyType || current.bodyType) === 'html' ? 'text/html' : 'text/plain',
  })

  const raw = toBase64Url(mime)
  const result = await client.put<GmailDraft>(`/drafts/${id}`, {
    message: { raw },
  })
  return { id: result.id }
}

export async function sendDraft(
  client: HttpClient,
  id: string,
): Promise<{ id: string; threadId: string }> {
  const result = await client.post<{ id: string; threadId: string }>('/drafts/send', { id })
  return result
}

export async function deleteDraft(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.delete(`/drafts/${id}`)
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

function normalizeDraftSummary(draft: GmailDraft): DraftSummary {
  const headers = draft.message.payload?.headers || []
  return {
    id: draft.id,
    subject: getHeader(headers, 'Subject') || '(no subject)',
    to: parseEmailAddresses(getHeader(headers, 'To')),
    snippet: draft.message.snippet,
  }
}

function normalizeDraftDetail(draft: GmailDraft): DraftDetail {
  const headers = draft.message.payload?.headers || []
  const body = draft.message.payload ? extractTextFromPayload(draft.message.payload) : ''

  return {
    id: draft.id,
    subject: getHeader(headers, 'Subject') || '(no subject)',
    to: parseEmailAddresses(getHeader(headers, 'To')),
    cc: parseEmailAddresses(getHeader(headers, 'Cc')),
    bcc: parseEmailAddresses(getHeader(headers, 'Bcc')),
    snippet: draft.message.snippet,
    body,
    bodyType: 'text',
    from: getHeader(headers, 'From') ? parseEmailAddress(getHeader(headers, 'From')) : undefined,
  }
}
