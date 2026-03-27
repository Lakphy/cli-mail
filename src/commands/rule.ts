// Rule/Filter commands

import { resolveAccount } from './resolve.js'
import { output, outputList, outputSuccess } from '../output/formatter.js'
import { handleError, ProviderError } from '../utils/error.js'
import * as gmailFilters from '../providers/gmail/filters.js'
import * as outlookRules from '../providers/outlook/rules.js'

export async function ruleList(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)

    if (account.provider === 'gmail') {
      const filters = await gmailFilters.listFilters(client)
      outputList(
        filters.map((f) => ({
          id: f.id,
          conditions: JSON.stringify(f.conditions),
          actions: JSON.stringify(f.actions),
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
          enabled: r.isEnabled ? 'yes' : 'no',
          conditions: JSON.stringify(r.conditions),
          actions: JSON.stringify(r.actions),
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
    if (account.provider === 'gmail') {
      const filter = await gmailFilters.getFilter(client, id)
      output(filter)
    } else {
      const rule = await outlookRules.getRule(client, id)
      output(rule)
    }
  } catch (error) {
    handleError(error)
  }
}

export async function ruleCreate(opts: { json: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const ruleJson = JSON.parse(opts.json)

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

export async function ruleUpdate(id: string, opts: { json: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const ruleJson = JSON.parse(opts.json)

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
