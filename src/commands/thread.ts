// Thread commands (Gmail-specific, with graceful handling for Outlook)

import { requireCapability, requireProvider, resolveAccount } from './resolve.js'
import { output, outputSuccess } from '../output/formatter.js'
import { handleError } from '../utils/error.js'
import * as gmailThreads from '../providers/gmail/threads.js'
import { decodePageToken, encodePageToken } from '../utils/page-token.js'
import { outputPageResult } from './shared.js'

const THREAD_PROVIDER_EXPLANATION = 'Thread operations are only supported for Gmail accounts. Outlook uses conversationId on messages instead.'

export async function threadList(opts: { query?: string; top?: string; pageToken?: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'gmail', THREAD_PROVIDER_EXPLANATION)

    const pageToken = decodePageToken(opts.pageToken, account, 'thread.list')
    const result = await gmailThreads.listThreads(client, {
      query: opts.query,
      top: opts.top ? parseInt(opts.top, 10) : 20,
      pageToken,
    })

    const items = result.threads.map((t) => ({
        id: t.id,
        subject: t.subject,
        messages: t.messageCount,
        lastDate: t.lastDate,
        snippet: t.snippet,
      }))
    const columns = [
        { key: 'id', label: 'ID' },
        { key: 'subject', label: 'Subject' },
        { key: 'messages', label: 'Messages' },
        { key: 'lastDate', label: 'Last Date' },
        { key: 'snippet', label: 'Snippet' },
      ]
    const meta = { nextToken: encodePageToken(account, 'thread.list', result.nextPageToken) }
    outputPageResult(items, columns, {
      meta,
      errors: result.errors,
      failCode: 'THREAD_PAGE_FAILED',
      failMessage: 'Failed to fetch every thread in this page',
      itemCode: 'THREAD_FETCH_FAILED',
    })
  } catch (error) {
    handleError(error)
  }
}

export async function threadGet(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'gmail', THREAD_PROVIDER_EXPLANATION)

    const thread = await gmailThreads.getThread(client, id)
    output(thread)
  } catch (error) {
    handleError(error)
  }
}

export async function threadModify(
  id: string,
  opts: { addLabels?: string[]; removeLabels?: string[]; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'gmail', THREAD_PROVIDER_EXPLANATION)

    await gmailThreads.modifyThread(client, id, opts.addLabels, opts.removeLabels)
    outputSuccess(`Thread modified: ${id}`)
  } catch (error) {
    handleError(error)
  }
}

export async function threadTrash(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'gmail', THREAD_PROVIDER_EXPLANATION)

    await gmailThreads.trashThread(client, id)
    outputSuccess(`Thread trashed: ${id}`)
  } catch (error) {
    handleError(error)
  }
}

export async function threadUntrash(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'gmail', THREAD_PROVIDER_EXPLANATION)

    await gmailThreads.untrashThread(client, id)
    outputSuccess(`Thread untrashed: ${id}`)
  } catch (error) {
    handleError(error)
  }
}

export async function threadDelete(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'gmail', THREAD_PROVIDER_EXPLANATION)
    requireCapability(
      account,
      'mail.permanentDelete',
      'Permanent thread deletion requires Gmail full access. Reauthorize with --full-access.',
    )

    await gmailThreads.deleteThread(client, id)
    outputSuccess(`Thread deleted: ${id}`)
  } catch (error) {
    handleError(error)
  }
}
