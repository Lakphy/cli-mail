// Settings commands

import { resolveAccount } from './resolve.js'
import { output, outputList, outputSuccess } from '../output/formatter.js'
import { handleError, ProviderError } from '../utils/error.js'
import * as gmailSettings from '../providers/gmail/settings.js'
import * as outlookSettings from '../providers/outlook/settings.js'

export async function settingsGet(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const settings = await gmailSettings.getSettings(client)
      output(settings)
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
    const settingsJson = JSON.parse(opts.json)

    if (account.provider === 'gmail') {
      await gmailSettings.updateSettings(client, settingsJson)
      outputSuccess('Settings updated')
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
    const { account, client } = resolveAccount(opts.account)

    if (account.provider === 'gmail') {
      await gmailSettings.setVacation(client, {
        enableAutoReply: opts.enabled,
        responseBodyPlainText: opts.message,
        startTime: opts.start ? String(new Date(opts.start).getTime()) : undefined,
        endTime: opts.end ? String(new Date(opts.end).getTime()) : undefined,
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

export async function autoReplyGet(opts: { account?: string }): Promise<void> {
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

export async function autoReplySet(opts: { json: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const settingsJson = JSON.parse(opts.json)

    if (account.provider === 'gmail') {
      await gmailSettings.setVacation(client, settingsJson)
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

export async function forwardingSet(opts: { json: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const settingsJson = JSON.parse(opts.json)

    if (account.provider === 'gmail') {
      await gmailSettings.setAutoForwarding(client, settingsJson)
      outputSuccess('Forwarding settings updated')
    } else {
      output({ message: 'Outlook forwarding must be configured via message rules. Use: cli-mail rule create' })
    }
  } catch (error) {
    handleError(error)
  }
}

// Mail tips (Outlook-specific)
export async function mailTipsGet(opts: { addresses: string[]; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'outlook') {
      const tips = await outlookSettings.getMailTips(client, opts.addresses)
      output(tips)
    } else {
      output({ message: 'Mail tips are only available for Outlook accounts' })
    }
  } catch (error) {
    handleError(error)
  }
}

// Focused Inbox (Outlook-specific)
export async function focusedInboxList(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider !== 'outlook') {
      throw new ProviderError('Focused Inbox is only available for Outlook accounts', account.provider)
    }
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
    if (account.provider !== 'outlook') {
      throw new ProviderError('Focused Inbox is only available for Outlook accounts', account.provider)
    }
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
    if (account.provider !== 'outlook') {
      throw new ProviderError('Focused Inbox is only available for Outlook accounts', account.provider)
    }
    await outlookSettings.deleteFocusedInboxOverride(client, id)
    outputSuccess(`Focused Inbox override deleted: ${id}`)
  } catch (error) {
    handleError(error)
  }
}
