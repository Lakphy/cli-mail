// Forwarding address commands (Gmail-specific)

import { resolveAccount } from './resolve.js'
import { outputList, outputSuccess } from '../output/formatter.js'
import { handleError, ProviderError } from '../utils/error.js'
import * as gmailSettings from '../providers/gmail/settings.js'

function ensureGmail(provider: string): void {
  if (provider !== 'gmail') {
    throw new ProviderError('Forwarding addresses are only available for Gmail accounts.', provider)
  }
}

export async function fwdAddrList(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    ensureGmail(account.provider)
    const addrs = await gmailSettings.listForwardingAddresses(client)
    outputList(
      addrs.map((a) => ({
        email: a.forwardingEmail,
        status: a.verificationStatus || 'unknown',
      })),
      [
        { key: 'email', label: 'Forwarding Email' },
        { key: 'status', label: 'Verification Status' },
      ],
    )
  } catch (error) {
    handleError(error)
  }
}

export async function fwdAddrAdd(opts: { email: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    ensureGmail(account.provider)
    await gmailSettings.createForwardingAddress(client, opts.email)
    outputSuccess(`Forwarding address added: ${opts.email} (verification email sent)`)
  } catch (error) {
    handleError(error)
  }
}

export async function fwdAddrRemove(email: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    ensureGmail(account.provider)
    await gmailSettings.deleteForwardingAddress(client, email)
    outputSuccess(`Forwarding address removed: ${email}`)
  } catch (error) {
    handleError(error)
  }
}
