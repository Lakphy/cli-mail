// Outlook message rule operations via Microsoft Graph API

import type { HttpClient } from '../../utils/http.js'
import type { RuleInfo } from '../types.js'

interface GraphMessageRule {
  id: string
  displayName?: string
  isEnabled?: boolean
  sequence?: number
  conditions?: Record<string, unknown>
  actions?: Record<string, unknown>
  exceptions?: Record<string, unknown>
}

interface GraphMessageRuleList {
  value: GraphMessageRule[]
}

export async function listRules(client: HttpClient): Promise<RuleInfo[]> {
  const list = await client.get<GraphMessageRuleList>(
    '/mailFolders/Inbox/messageRules',
  )
  return (list.value || []).map(normalizeRule)
}

export async function getRule(client: HttpClient, id: string): Promise<RuleInfo> {
  const rule = await client.get<GraphMessageRule>(
    `/mailFolders/Inbox/messageRules/${id}`,
  )
  return normalizeRule(rule)
}

export async function createRule(
  client: HttpClient,
  ruleJson: unknown,
): Promise<RuleInfo> {
  const rule = await client.post<GraphMessageRule>(
    '/mailFolders/Inbox/messageRules',
    ruleJson,
  )
  return normalizeRule(rule)
}

export async function updateRule(
  client: HttpClient,
  id: string,
  ruleJson: unknown,
): Promise<RuleInfo> {
  const rule = await client.patch<GraphMessageRule>(
    `/mailFolders/Inbox/messageRules/${id}`,
    ruleJson,
  )
  return normalizeRule(rule)
}

export async function deleteRule(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.delete(`/mailFolders/Inbox/messageRules/${id}`)
}

function normalizeRule(rule: GraphMessageRule): RuleInfo {
  return {
    id: rule.id,
    name: rule.displayName,
    isEnabled: rule.isEnabled,
    conditions: rule.conditions,
    actions: rule.actions,
  }
}
