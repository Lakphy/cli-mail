// History command — Gmail mailbox change tracking

import { requireProvider, resolveAccount } from './resolve.js'
import { output } from '../output/formatter.js'
import { ConfigError, handleError } from '../utils/error.js'
import * as gmailHistory from '../providers/gmail/history.js'
import {
  createPageTokenContext,
  decodePageTokenState,
  encodePageToken,
  resolvePageTokenOption,
} from '../utils/page-token.js'

export async function historyList(opts: {
  startHistoryId?: string
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
    const operation = 'history.list'
    const pageState = decodePageTokenState(opts.pageToken, account, operation)
    const startHistoryId = resolvePageTokenOption(
      pageState,
      'startHistoryId',
      opts.startHistoryId,
      '--start-history-id',
    )
    if (!startHistoryId) {
      throw new ConfigError('--start-history-id is required on the first page')
    }
    const labelId = resolvePageTokenOption(pageState, 'label', opts.labelId, '--label-id')
    const requestedTypes = opts.types ? JSON.stringify([...opts.types].sort()) : undefined
    const encodedTypes = resolvePageTokenOption(pageState, 'types', requestedTypes, '--types')
    const historyTypes = encodedTypes ? parseHistoryTypes(encodedTypes) : undefined
    const topValue = resolvePageTokenOption(pageState, 'top', opts.top)
    const result = await gmailHistory.listHistory(client, {
      startHistoryId,
      labelId,
      historyTypes,
      maxResults: topValue ? parseInt(topValue, 10) : undefined,
      pageToken: pageState?.cursor,
    })
    output({
      historyId: result.historyId,
      count: result.history.length,
      history: result.history,
    }, {
      meta: { nextToken: encodePageToken(
        account,
        operation,
        result.nextPageToken,
        createPageTokenContext({
          startHistoryId,
          label: labelId,
          types: encodedTypes,
          top: topValue,
        }),
      ) },
    })
  } catch (error) {
    handleError(error)
  }
}

function parseHistoryTypes(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed
  } catch {
    // Invalid token context is reported as a configuration error below.
  }
  throw new ConfigError('Invalid history type context in page token')
}
