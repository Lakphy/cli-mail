// Send-as alias commands (Gmail-specific)

import { resolveAccount } from './resolve.js'
import { output, outputList, outputSuccess } from '../output/formatter.js'
import { handleError, ProviderError } from '../utils/error.js'
import * as gmailSettings from '../providers/gmail/settings.js'

function ensureGmail(provider: string): void {
  if (provider !== 'gmail') {
    throw new ProviderError('Send-as aliases are only available for Gmail accounts.', provider)
  }
}

export async function sendAsList(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    ensureGmail(account.provider)
    const aliases = await gmailSettings.listSendAs(client)
    outputList(
      aliases.map((a) => ({
        email: a.sendAsEmail,
        displayName: a.displayName || '',
        isPrimary: a.isPrimary ? 'yes' : 'no',
        isDefault: a.isDefault ? 'yes' : 'no',
        replyTo: a.replyToAddress || '',
        verification: a.verificationStatus || '',
      })),
      [
        { key: 'email', label: 'Email' },
        { key: 'displayName', label: 'Display Name' },
        { key: 'isPrimary', label: 'Primary' },
        { key: 'isDefault', label: 'Default' },
        { key: 'replyTo', label: 'Reply-To' },
        { key: 'verification', label: 'Status' },
      ],
    )
  } catch (error) {
    handleError(error)
  }
}

export async function sendAsGet(email: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    ensureGmail(account.provider)
    const alias = await gmailSettings.getSendAs(client, email)
    output(alias)
  } catch (error) {
    handleError(error)
  }
}

export async function sendAsCreate(opts: {
  email: string
  displayName?: string
  replyTo?: string
  account?: string
}): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    ensureGmail(account.provider)
    const alias = await gmailSettings.createSendAs(client, {
      sendAsEmail: opts.email,
      displayName: opts.displayName,
      replyToAddress: opts.replyTo,
    })
    outputSuccess(`Send-as alias created: ${alias.sendAsEmail}`)
  } catch (error) {
    handleError(error)
  }
}

export async function sendAsDelete(email: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    ensureGmail(account.provider)
    await gmailSettings.deleteSendAs(client, email)
    outputSuccess(`Send-as alias deleted: ${email}`)
  } catch (error) {
    handleError(error)
  }
}
