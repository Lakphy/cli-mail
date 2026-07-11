// Send-as alias commands (Gmail-specific)

import { requireProvider, resolveAccount } from './resolve.js'
import { output, outputList } from '../output/formatter.js'
import { handleError } from '../utils/error.js'
import * as gmailSettings from '../providers/gmail/settings.js'

export async function sendAsList(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'gmail', 'Send-as aliases are only available for Gmail accounts.')
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
    requireProvider(account, 'gmail', 'Send-as aliases are only available for Gmail accounts.')
    const alias = await gmailSettings.getSendAs(client, email)
    output(alias)
  } catch (error) {
    handleError(error)
  }
}
