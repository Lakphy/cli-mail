// Delegate commands (Gmail-specific)

import { resolveAccount } from './resolve.js'
import { outputList, outputSuccess } from '../output/formatter.js'
import { handleError, ProviderError } from '../utils/error.js'
import * as gmailSettings from '../providers/gmail/settings.js'

function ensureGmail(provider: string): void {
  if (provider !== 'gmail') {
    throw new ProviderError('Delegates are only available for Gmail accounts.', provider)
  }
}

export async function delegateList(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    ensureGmail(account.provider)
    const delegates = await gmailSettings.listDelegates(client)
    outputList(
      delegates.map((d) => ({
        email: d.delegateEmail,
        status: d.verificationStatus || 'unknown',
      })),
      [
        { key: 'email', label: 'Delegate Email' },
        { key: 'status', label: 'Status' },
      ],
    )
  } catch (error) {
    handleError(error)
  }
}

export async function delegateAdd(opts: { email: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    ensureGmail(account.provider)
    await gmailSettings.addDelegate(client, opts.email)
    outputSuccess(`Delegate added: ${opts.email}`)
  } catch (error) {
    handleError(error)
  }
}

export async function delegateRemove(email: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    ensureGmail(account.provider)
    await gmailSettings.removeDelegate(client, email)
    outputSuccess(`Delegate removed: ${email}`)
  } catch (error) {
    handleError(error)
  }
}
