// Rule/Filter commands

import { requireCapability, requireProvider, resolveAccount } from './resolve.js'
import { output, outputList, outputSuccess } from '../output/formatter.js'
import { CliMailError, handleError, ProviderError } from '../utils/error.js'
import * as gmailFilters from '../providers/gmail/filters.js'
import * as outlookRules from '../providers/outlook/rules.js'
import { parseJsonObject } from '../utils/input.js'

export async function ruleList(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)

    if (account.provider === 'gmail') {
      const filters = await gmailFilters.listFilters(client)
      outputList(
        filters.map((f) => ({
          id: f.id,
          conditions: f.conditions,
          actions: f.actions,
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'conditions', label: 'Conditions' },
          { key: 'actions', label: 'Actions' },
        ],
      )
    } else {
      const rules = await outlookRules.listRules(client)
      outputList(
        rules.map((r) => ({
          id: r.id,
          name: r.name || '',
          enabled: r.isEnabled ?? false,
          conditions: r.conditions,
          actions: r.actions,
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'Name' },
          { key: 'enabled', label: 'Enabled' },
          { key: 'conditions', label: 'Conditions' },
          { key: 'actions', label: 'Actions' },
        ],
      )
    }
  } catch (error) {
    handleError(error)
  }
}

export async function ruleGet(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const rule = account.provider === 'gmail'
      ? await gmailFilters.getFilter(client, id)
      : await outlookRules.getRule(client, id)
    output(rule)
  } catch (error) {
    handleError(error)
  }
}

export async function ruleCreate(opts: { json: string; yes?: boolean; account?: string }): Promise<void> {
  try {
    const ruleJson = parseJsonObject(opts.json, 'Rule definition')
    requirePermanentDeleteConfirmation(ruleJson, opts.yes)
    const { account, client } = resolveAccount(opts.account)
    requirePermanentDeleteCapability(ruleJson, account)

    if (account.provider === 'gmail') {
      const filter = await gmailFilters.createFilter(client, ruleJson)
      outputSuccess(`Filter created (id: ${filter.id})`)
    } else {
      const rule = await outlookRules.createRule(client, ruleJson)
      outputSuccess(`Rule created (id: ${rule.id}, name: ${rule.name})`)
    }
  } catch (error) {
    handleError(error)
  }
}

export async function ruleUpdate(id: string, opts: { json: string; yes?: boolean; account?: string }): Promise<void> {
  try {
    const ruleJson = parseJsonObject(opts.json, 'Rule update')
    requirePermanentDeleteConfirmation(ruleJson, opts.yes)
    const { account, client } = resolveAccount(opts.account)
    requirePermanentDeleteCapability(ruleJson, account)

    if (account.provider === 'gmail') {
      // Gmail filters can't be updated, only deleted and recreated
      throw new ProviderError('Gmail filters cannot be updated. Delete and recreate instead.', 'gmail')
    } else {
      const rule = await outlookRules.updateRule(client, id, ruleJson)
      outputSuccess(`Rule updated (id: ${rule.id})`)
    }
  } catch (error) {
    handleError(error)
  }
}

function requestsPermanentDelete(rule: Record<string, unknown>): boolean {
  const actions = rule.actions
  return actions !== null
    && typeof actions === 'object'
    && !Array.isArray(actions)
    && (actions as Record<string, unknown>).permanentDelete === true
}

function requirePermanentDeleteConfirmation(rule: Record<string, unknown>, confirmed?: boolean): void {
  if (requestsPermanentDelete(rule) && !confirmed) {
    throw new CliMailError(
      'Rules with actions.permanentDelete=true require explicit --yes confirmation',
      'CONFIRMATION_REQUIRED',
    )
  }
}

function requirePermanentDeleteCapability(
  rule: Record<string, unknown>,
  account: Parameters<typeof requireCapability>[0],
): void {
  if (!requestsPermanentDelete(rule)) return
  requireProvider(account, 'outlook', 'Permanent-delete rules are only supported by Outlook')
  requireCapability(
    account,
    'mail.permanentDelete',
    'This account is not authorized to create permanent-delete rules',
  )
}

export async function ruleDelete(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      await gmailFilters.deleteFilter(client, id)
    } else {
      await outlookRules.deleteRule(client, id)
    }
    outputSuccess(`Rule/Filter deleted: ${id}`)
  } catch (error) {
    handleError(error)
  }
}
