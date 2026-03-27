// Thread commands (Gmail-specific, with graceful handling for Outlook)

import { resolveAccount } from './resolve.js'
import { output, outputList, outputSuccess } from '../output/formatter.js'
import { handleError, ProviderError } from '../utils/error.js'
import * as gmailThreads from '../providers/gmail/threads.js'

function requireGmail(provider: string): void {
  if (provider !== 'gmail') {
    throw new ProviderError(
      'Thread operations are only supported for Gmail accounts. Outlook uses conversationId on messages instead.',
      provider,
    )
  }
}

export async function threadList(opts: { query?: string; top?: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireGmail(account.provider)

    const result = await gmailThreads.listThreads(client, {
      query: opts.query,
      top: opts.top ? parseInt(opts.top, 10) : 20,
    })

    outputList(
      result.threads.map((t) => ({
        id: t.id,
        subject: t.subject,
        messages: t.messageCount,
        lastDate: t.lastDate,
        snippet: t.snippet,
      })),
      [
        { key: 'id', label: 'ID' },
        { key: 'subject', label: 'Subject' },
        { key: 'messages', label: 'Messages' },
        { key: 'lastDate', label: 'Last Date' },
        { key: 'snippet', label: 'Snippet' },
      ],
    )
  } catch (error) {
    handleError(error)
  }
}

export async function threadGet(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireGmail(account.provider)

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
    requireGmail(account.provider)

    await gmailThreads.modifyThread(client, id, opts.addLabels, opts.removeLabels)
    outputSuccess(`Thread modified: ${id}`)
  } catch (error) {
    handleError(error)
  }
}

export async function threadTrash(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireGmail(account.provider)

    await gmailThreads.trashThread(client, id)
    outputSuccess(`Thread trashed: ${id}`)
  } catch (error) {
    handleError(error)
  }
}

export async function threadUntrash(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireGmail(account.provider)

    await gmailThreads.untrashThread(client, id)
    outputSuccess(`Thread untrashed: ${id}`)
  } catch (error) {
    handleError(error)
  }
}

export async function threadDelete(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireGmail(account.provider)

    await gmailThreads.deleteThread(client, id)
    outputSuccess(`Thread deleted: ${id}`)
  } catch (error) {
    handleError(error)
  }
}
