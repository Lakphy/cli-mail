// History command — Gmail mailbox change tracking

import { resolveAccount } from './resolve.js'
import { output } from '../output/formatter.js'
import { handleError, ProviderError } from '../utils/error.js'
import * as gmailHistory from '../providers/gmail/history.js'

export async function historyList(opts: {
  startHistoryId: string
  labelId?: string
  types?: string[]
  top?: string
  pageToken?: string
  account?: string
}): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider !== 'gmail') {
      throw new ProviderError('History is only available for Gmail accounts. Use Outlook delta queries instead.', account.provider)
    }
    const result = await gmailHistory.listHistory(client, {
      startHistoryId: opts.startHistoryId,
      labelId: opts.labelId,
      historyTypes: opts.types,
      maxResults: opts.top ? parseInt(opts.top) : undefined,
      pageToken: opts.pageToken,
    })
    output({
      historyId: result.historyId,
      nextPageToken: result.nextPageToken || null,
      count: result.history.length,
      history: result.history,
    })
  } catch (error) {
    handleError(error)
  }
}
