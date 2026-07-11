// Settings commands

import { requireProvider, resolveAccount } from './resolve.js'
import { output, outputList, outputPartial, outputSuccess } from '../output/formatter.js'
import { ConfigError, handleError } from '../utils/error.js'
import * as gmailSettings from '../providers/gmail/settings.js'
import * as outlookSettings from '../providers/outlook/settings.js'
import { parseJsonObject } from '../utils/input.js'

export async function settingsGet(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const result = await gmailSettings.getSettings(client)
      if (result.errors.length > 0) {
        outputPartial(result.settings, result.errors.map((error) => ({
          code: error.code,
          message: error.message,
          item: { section: error.section },
          ...(error.statusCode !== undefined ? { details: { statusCode: error.statusCode } } : {}),
        })))
      } else {
        output(result.settings)
      }
    } else {
      const settings = await outlookSettings.getSettings(client)
      output(settings)
    }
  } catch (error) {
    handleError(error)
  }
}

export async function settingsUpdate(opts: { json: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const settingsJson = parseJsonObject(opts.json, 'Settings')

    if (account.provider === 'gmail') {
      const result = await gmailSettings.updateSettings(client, settingsJson)
      if (result.errors.length > 0) {
        outputPartial(
          { updated: result.updated },
          result.errors.map((error) => ({
            code: error.code,
            message: error.message,
            item: { section: error.section },
            ...(error.statusCode !== undefined ? { details: { statusCode: error.statusCode } } : {}),
          })),
        )
      } else {
        outputSuccess('Settings updated')
      }
    } else {
      const result = await outlookSettings.updateSettings(client, settingsJson)
      output(result)
    }
  } catch (error) {
    handleError(error)
  }
}

export async function vacationGet(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const vacation = await gmailSettings.getVacation(client)
      output(vacation)
    } else {
      const autoReply = await outlookSettings.getAutoReply(client)
      output(autoReply)
    }
  } catch (error) {
    handleError(error)
  }
}

export async function vacationSet(opts: {
  enabled: boolean
  message?: string
  start?: string
  end?: string
  account?: string
}): Promise<void> {
  try {
    const start = parseOptionalDate(opts.start, '--start')
    const end = parseOptionalDate(opts.end, '--end')
    if (start && end && end <= start) throw new ConfigError('--end must be later than --start')
    const { account, client } = resolveAccount(opts.account)

    if (account.provider === 'gmail') {
      await gmailSettings.setVacation(client, {
        enabled: opts.enabled,
        message: opts.message,
        start,
        end,
      })
    } else {
      await outlookSettings.setAutoReply(client, {
        enabled: opts.enabled,
        internalMessage: opts.message,
        externalMessage: opts.message,
        startDateTime: opts.start,
        endDateTime: opts.end,
      })
    }
    outputSuccess('Vacation/Auto-reply settings updated')
  } catch (error) {
    handleError(error)
  }
}

function parseOptionalDate(value: string | undefined, option: string): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new ConfigError(`${option} must be a valid ISO 8601 date`)
  return date
}

export const autoReplyGet = vacationGet

export async function autoReplySet(opts: { json: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const settingsJson = parseJsonObject(opts.json, 'Auto-reply settings')

    if (account.provider === 'gmail') {
      await gmailSettings.updateSettings(client, { vacation: settingsJson })
    } else {
      await outlookSettings.setAutoReply(client, settingsJson)
    }
    outputSuccess('Auto-reply settings updated')
  } catch (error) {
    handleError(error)
  }
}

export async function forwardingGet(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const forwarding = await gmailSettings.getAutoForwarding(client)
      output(forwarding)
    } else {
      const settings = await outlookSettings.getSettings(client)
      output({ message: 'Outlook forwarding is managed via rules', settings })
    }
  } catch (error) {
    handleError(error)
  }
}

// Mail tips (Outlook-specific)
export async function mailTipsGet(opts: { addresses: string[]; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'outlook', 'Mail tips are only available for Outlook accounts')
    const tips = await outlookSettings.getMailTips(client, opts.addresses)
    output(tips)
  } catch (error) {
    handleError(error)
  }
}

// Focused Inbox (Outlook-specific)
export async function focusedInboxList(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'outlook', 'Focused Inbox is only available for Outlook accounts')
    const overrides = await outlookSettings.listFocusedInboxOverrides(client)
    outputList(
      overrides.map((o) => ({
        id: o.id,
        email: o.senderEmailAddress.address,
        classify: o.classifyAs,
      })),
      [
        { key: 'id', label: 'ID' },
        { key: 'email', label: 'Sender Email' },
        { key: 'classify', label: 'Classify As' },
      ],
    )
  } catch (error) {
    handleError(error)
  }
}

export async function focusedInboxAdd(opts: {
  email: string
  classify: string
  account?: string
}): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'outlook', 'Focused Inbox is only available for Outlook accounts')
    const classify = opts.classify === 'focused' ? 'focused' : 'other'
    const override = await outlookSettings.createFocusedInboxOverride(client, opts.email, classify)
    outputSuccess(`Focused Inbox override created: ${override.senderEmailAddress.address} → ${override.classifyAs} (id: ${override.id})`)
  } catch (error) {
    handleError(error)
  }
}

export async function focusedInboxDelete(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'outlook', 'Focused Inbox is only available for Outlook accounts')
    await outlookSettings.deleteFocusedInboxOverride(client, id)
    outputSuccess(`Focused Inbox override deleted: ${id}`)
  } catch (error) {
    handleError(error)
  }
}
