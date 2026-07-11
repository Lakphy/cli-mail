// History command — Gmail mailbox change tracking

import { requireProvider, resolveAccount } from './resolve.js'
import { output } from '../output/formatter.js'
import { handleError } from '../utils/error.js'
import * as gmailHistory from '../providers/gmail/history.js'
import { decodePageToken, encodePageToken } from '../utils/page-token.js'

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
    requireProvider(
      account,
      'gmail',
      'History is only available for Gmail accounts. Use Outlook delta queries instead.',
    )
    const operation = `history.list:${opts.startHistoryId}`
    const pageToken = decodePageToken(opts.pageToken, account, operation)
    const result = await gmailHistory.listHistory(client, {
      startHistoryId: opts.startHistoryId,
      labelId: opts.labelId,
      historyTypes: opts.types,
      maxResults: opts.top ? parseInt(opts.top) : undefined,
      pageToken,
    })
    output({
      historyId: result.historyId,
      count: result.history.length,
      history: result.history,
    }, {
      meta: { nextToken: encodePageToken(account, operation, result.nextPageToken) },
    })
  } catch (error) {
    handleError(error)
  }
}
