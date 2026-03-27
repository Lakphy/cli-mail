// Gmail filter operations

import type { HttpClient } from '../../utils/http.js'
import type { RuleInfo } from '../types.js'

interface GmailFilter {
  id: string
  criteria?: {
    from?: string
    to?: string
    subject?: string
    query?: string
    negatedQuery?: string
    hasAttachment?: boolean
    excludeChats?: boolean
    size?: number
    sizeComparison?: string
  }
  action?: {
    addLabelIds?: string[]
    removeLabelIds?: string[]
    forward?: string
  }
}

interface GmailFilterList {
  filter?: GmailFilter[]
}

export async function listFilters(client: HttpClient): Promise<RuleInfo[]> {
  const list = await client.get<GmailFilterList>('/settings/filters')
  return (list.filter || []).map(normalizeFilter)
}

export async function getFilter(client: HttpClient, id: string): Promise<RuleInfo> {
  const filter = await client.get<GmailFilter>(`/settings/filters/${id}`)
  return normalizeFilter(filter)
}

export async function createFilter(
  client: HttpClient,
  filterJson: unknown,
): Promise<RuleInfo> {
  const filter = await client.post<GmailFilter>('/settings/filters', filterJson)
  return normalizeFilter(filter)
}

export async function deleteFilter(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.delete(`/settings/filters/${id}`)
}

function normalizeFilter(filter: GmailFilter): RuleInfo {
  return {
    id: filter.id,
    conditions: filter.criteria,
    actions: filter.action,
  }
}
