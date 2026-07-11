// Forwarding address commands (Gmail-specific)

import { requireProvider, resolveAccount } from './resolve.js'
import { outputList } from '../output/formatter.js'
import { handleError } from '../utils/error.js'
import * as gmailSettings from '../providers/gmail/settings.js'

export async function fwdAddrList(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'gmail', 'Forwarding addresses are only available for Gmail accounts.')
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
