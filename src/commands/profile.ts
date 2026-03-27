// Profile command — show user profile info

import { resolveAccount } from './resolve.js'
import { output } from '../output/formatter.js'
import { handleError } from '../utils/error.js'
import * as gmailProfile from '../providers/gmail/profile.js'

export async function profileGet(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const profile = await gmailProfile.getProfile(client)
      output({
        provider: 'gmail',
        email: profile.emailAddress,
        totalMessages: profile.messagesTotal,
        totalThreads: profile.threadsTotal,
        historyId: profile.historyId,
      })
    } else {
      // Outlook — use /me endpoint (User.Read scope)
      const user = await client.get<{ displayName: string; mail: string; userPrincipalName: string }>('')
      output({
        provider: 'outlook',
        displayName: user.displayName,
        email: user.mail || user.userPrincipalName,
      })
    }
  } catch (error) {
    handleError(error)
  }
}
