import {
  createClientForAccount,
  requireCapability,
  requireProvider,
  resolveAccount,
} from './resolve.js'
import { output, outputList, outputPartial, outputSuccess, outputRaw } from '../output/formatter.js'
import {
  CliMailError,
  ConfigError,
  errorMessage,
  handleError,
  ProviderError,
} from '../utils/error.js'
import * as gmailMessages from '../providers/gmail/messages.js'
import * as gmailSettings from '../providers/gmail/settings.js'
import * as outlookMessages from '../providers/outlook/messages.js'
import { loadConfig, getAccountsByTag } from '../config/store.js'
import pLimit from 'p-limit'
import type { AccountConfig } from '../config/types.js'
import type { MessageSummary } from '../providers/types.js'
import { decodePageToken, decodePageTokenState, encodePageToken, type PageTokenContext } from '../utils/page-token.js'
import { getRegularFileSize, readRegularFile } from '../utils/files.js'
import {
  messageListColumns,
  messageRows,
  messageSearchColumns,
  outputPageResult,
} from './shared.js'

const MAX_BODY_FILE_BYTES = 10 * 1024 * 1024
const MAX_RAW_MESSAGE_BYTES = 35 * 1024 * 1024

interface MessageListOpts {
  folder?: string
  query?: string
  top?: string
  skip?: string
  pageToken?: string
  account?: string
}

export async function messageList(opts: MessageListOpts): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const pageToken = decodePageToken(opts.pageToken, account, 'message.list')
    const options = {
      folder: opts.folder,
      query: opts.query,
      top: opts.top ? parseInt(opts.top, 10) : 20,
      skip: opts.skip ? parseInt(opts.skip, 10) : undefined,
      pageToken,
    }

    const result = account.provider === 'gmail'
      ? await gmailMessages.listMessages(client, options)
      : await outlookMessages.listMessages(client, options)
    outputMessagePage(account, 'message.list', result)
  } catch (error) {
    handleError(error)
  }
}

export async function messageGet(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const message = account.provider === 'gmail'
      ? await gmailMessages.getMessage(client, id)
      : await outlookMessages.getMessage(client, id)
    output(message)
  } catch (error) {
    handleError(error)
  }
}

export async function messageRaw(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const raw = account.provider === 'gmail'
      ? await gmailMessages.getMessageRaw(client, id)
      : await outlookMessages.getMessageRaw(client, id)
    outputRaw(raw)
  } catch (error) {
    handleError(error)
  }
}

interface MessageSendOpts {
  to: string[]
  subject: string
  body?: string
  bodyFile?: string
  cc?: string[]
  bcc?: string[]
  attach?: string[]
  bodyType?: string
  importance?: string
  account?: string
}

export async function messageSend(opts: MessageSendOpts): Promise<void> {
  try {
    if (opts.body !== undefined && opts.bodyFile !== undefined) {
      throw new ConfigError('Use either --body or --body-file, not both')
    }
    const { account, client } = resolveAccount(opts.account)

    let body = opts.body || ''
    if (opts.bodyFile) {
      body = readUtf8BodyFile(opts.bodyFile)
    }

    const attachmentPolicy = account.provider === 'gmail'
      ? gmailMessages.attachmentLimits
      : outlookMessages.attachmentLimits
    const attachmentBytes = (opts.attach ?? []).reduce(
      (total, path) => total + getRegularFileSize(
        path,
        'Attachment',
        attachmentPolicy.maxFileBytes,
      ),
      0,
    )
    attachmentPolicy.assertTotalSize(attachmentBytes)

    const sendOpts = {
      to: opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      subject: opts.subject,
      body,
      bodyType: (opts.bodyType as 'text' | 'html') || 'text',
      attachments: opts.attach?.map((p) => ({ name: '', path: p })),
      importance: (opts.importance as 'low' | 'normal' | 'high') || 'normal',
    }

    if (account.provider === 'gmail') {
      const result = await gmailMessages.sendMessage(client, sendOpts)
      outputSuccess(`Message sent (id: ${result.id})`)
    } else {
      await outlookMessages.sendMessage(client, sendOpts)
      outputSuccess('Message sent')
    }
  } catch (error) {
    handleError(error)
  }
}

export async function messageReply(
  id: string,
  opts: { body: string; replyAll?: boolean; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const [aliases, original] = await Promise.all([
        gmailSettings.getSendAsAliases(client),
        gmailMessages.getMessage(client, id),
      ])
      const result = await gmailMessages.replyToMessage(
        client,
        id,
        opts.body,
        opts.replyAll,
        { email: account.email, aliases },
        original,
      )
      outputSuccess(`Reply sent (id: ${result.id})`, { id: result.id, threadId: result.threadId })
    } else {
      await outlookMessages.replyToMessage(client, id, opts.body, opts.replyAll)
      outputSuccess('Reply sent')
    }
  } catch (error) {
    handleError(error)
  }
}

export async function messageForward(
  id: string,
  opts: { to: string[]; body?: string; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const result = await gmailMessages.forwardMessage(client, id, opts.to, opts.body)
      outputSuccess(`Message forwarded (id: ${result.id})`)
    } else {
      await outlookMessages.forwardMessage(client, id, opts.to, opts.body)
      outputSuccess('Message forwarded')
    }
  } catch (error) {
    handleError(error)
  }
}

export async function messageDelete(
  id: string,
  opts: { permanent?: boolean; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (opts.permanent) requireCapability(account, 'mail.permanentDelete')
    if (account.provider === 'gmail') {
      await gmailMessages.deleteMessage(client, id, opts.permanent)
      outputSuccess(
        opts.permanent ? `Message permanently deleted: ${id}` : `Message moved to trash: ${id}`,
        { id, permanent: opts.permanent === true },
      )
    } else {
      const result = await outlookMessages.deleteMessage(client, id, opts.permanent)
      outputSuccess(
        opts.permanent ? `Message permanently deleted: ${id}` : `Message moved to Deleted Items: ${result.id}`,
        { id: result.id, permanent: result.permanentlyDeleted === true },
      )
    }
  } catch (error) {
    handleError(error)
  }
}

export async function messageMove(
  id: string,
  opts: { toFolder: string; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    let movedId = id
    if (account.provider === 'gmail') {
      // Gmail: add target label, remove INBOX
      await gmailMessages.moveMessage(client, id, opts.toFolder)
    } else {
      const result = await outlookMessages.moveMessage(client, id, opts.toFolder)
      movedId = result.id
    }
    outputSuccess(`Message moved to: ${opts.toFolder}`, {
      id: movedId,
      folderId: opts.toFolder,
    })
  } catch (error) {
    handleError(error)
  }
}

export async function messageMark(
  id: string,
  opts: { read?: boolean; unread?: boolean; flagged?: boolean; unflagged?: boolean; account?: string },
): Promise<void> {
  try {
    if (opts.read && opts.unread) throw new ConfigError('--read and --unread are mutually exclusive')
    if (opts.flagged && opts.unflagged) {
      throw new ConfigError('--flagged and --unflagged are mutually exclusive')
    }
    if (!opts.read && !opts.unread && !opts.flagged && !opts.unflagged) {
      throw new ConfigError('Select at least one mark operation')
    }
    const { account, client } = resolveAccount(opts.account)
    const markOpts = {
      read: opts.read ? true : opts.unread ? false : undefined,
      flagged: opts.flagged ? true : opts.unflagged ? false : undefined,
    }

    if (account.provider === 'gmail') {
      await gmailMessages.markMessage(client, id, markOpts)
    } else {
      await outlookMessages.markMessage(client, id, markOpts)
    }
    outputSuccess(`Message updated: ${id}`)
  } catch (error) {
    handleError(error)
  }
}

export async function messageSearch(
  opts: { query: string; top?: string; pageToken?: string; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const top = opts.top ? parseInt(opts.top, 10) : 20
    const pageToken = decodePageToken(opts.pageToken, account, 'message.search')

    const result = account.provider === 'gmail'
      ? await gmailMessages.searchMessages(client, opts.query, top, pageToken)
      : await outlookMessages.searchMessages(client, opts.query, top, pageToken)
    outputMessagePage(account, 'message.search', result, true)
  } catch (error) {
    handleError(error)
  }
}

export async function messageUntrash(
  id: string,
  opts: { account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      await gmailMessages.untrashMessage(client, id)
      outputSuccess(`Message untrashed: ${id}`)
    } else {
      await outlookMessages.untrashMessage(client, id)
      outputSuccess(`Message restored to Inbox: ${id}`)
    }
  } catch (error) {
    handleError(error)
  }
}

export async function messageBatchDelete(
  opts: { ids: string[]; permanent?: boolean; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (opts.permanent) requireCapability(account, 'mail.permanentDelete')
    if (account.provider === 'gmail') {
      await gmailMessages.batchDeleteMessages(client, opts.ids, opts.permanent)
      outputSuccess(
        opts.permanent
          ? `Permanently deleted ${opts.ids.length} messages`
          : `Moved ${opts.ids.length} messages to trash`,
        { ids: opts.ids, permanent: opts.permanent === true },
      )
    } else {
      const limit = pLimit(4)
      const results = await Promise.allSettled(
        opts.ids.map((id) => limit(() => outlookMessages.deleteMessage(client, id, opts.permanent))),
      )
      const deleted = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
      const errors = results.flatMap((result, index) => result.status === 'rejected'
        ? [{ code: 'DELETE_FAILED', message: errorMessage(result.reason), item: { id: opts.ids[index] } }]
        : [])
      if (errors.length > 0) {
        if (deleted.length === 0) {
          throw new CliMailError('All message deletions failed', 'BATCH_DELETE_FAILED', undefined, errors)
        }
        outputPartial({ deleted, permanent: opts.permanent === true }, errors)
        return
      }
      outputSuccess(
        opts.permanent
          ? `Permanently deleted ${deleted.length} messages`
          : `Moved ${deleted.length} messages to Deleted Items`,
        { deleted, permanent: opts.permanent === true },
      )
    }
  } catch (error) {
    handleError(error)
  }
}

export async function messageImport(
  opts: { file: string; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'gmail', 'Message import is only supported for Gmail accounts')
    const rawMime = readRegularFile(opts.file, 'Raw MIME file', MAX_RAW_MESSAGE_BYTES)
    const result = await gmailMessages.importMessage(client, rawMime)
    outputSuccess(`Message imported (id: ${result.id})`)
  } catch (error) {
    handleError(error)
  }
}

export async function messageCopy(
  id: string,
  opts: { toFolder: string; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(
      account,
      'outlook',
      'Message copy is only supported for Outlook accounts. Gmail uses labels instead.',
    )
    const result = await outlookMessages.copyMessage(client, id, opts.toFolder)
    outputSuccess(`Message copied (new id: ${result.id})`)
  } catch (error) {
    handleError(error)
  }
}

export async function messageTrash(
  id: string,
  opts: { account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      await gmailMessages.trashMessage(client, id)
      outputSuccess(`Message moved to trash: ${id}`)
    } else {
      await outlookMessages.trashMessage(client, id)
      outputSuccess(`Message moved to Deleted Items: ${id}`)
    }
  } catch (error) {
    handleError(error)
  }
}

export async function messageBatchModify(
  opts: { ids: string[]; addLabels?: string[]; removeLabels?: string[]; account?: string },
): Promise<void> {
  try {
    if (!opts.addLabels?.length && !opts.removeLabels?.length) {
      throw new ConfigError('Provide --add-labels or --remove-labels')
    }
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'gmail', 'Batch modify is only supported for Gmail accounts.')
    await gmailMessages.batchModifyMessages(client, opts.ids, opts.addLabels, opts.removeLabels)
    outputSuccess(`Batch modified ${opts.ids.length} messages`)
  } catch (error) {
    handleError(error)
  }
}

export async function messageInsert(
  opts: { file: string; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'gmail', 'Message insert is only supported for Gmail accounts.')
    const rawMime = readRegularFile(opts.file, 'Raw MIME file', MAX_RAW_MESSAGE_BYTES)
    const result = await gmailMessages.insertMessage(client, rawMime)
    outputSuccess(`Message inserted (id: ${result.id})`)
  } catch (error) {
    handleError(error)
  }
}

// ==================== Recent / Since ====================

export async function messageRecent(
  opts: { hours?: string; since?: string; top?: string; pageToken?: string; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const top = opts.top ? parseInt(opts.top, 10) : 20
    const pageState = decodePageTokenState(opts.pageToken, account, 'message.recent')
    const pageToken = pageState?.cursor

    const sinceDate = resolveSinceDate(opts, {
      contextSince: pageState?.context?.since,
      rejectConflictingOptions: true,
      invalidSince: (value) => new ProviderError(
        `Invalid date format: ${value}. Use ISO 8601 format.`,
        account.provider,
      ),
    })
    const result = account.provider === 'gmail'
      ? await gmailMessages.listMessagesSince(client, sinceDate, top, pageToken)
      : await outlookMessages.listMessagesSince(client, sinceDate, top, pageToken)
    outputMessagePage(account, 'message.recent', result, false, { since: sinceDate.toISOString() })
  } catch (error) {
    handleError(error)
  }
}

// ==================== Cross-account Aggregation ====================

export async function messageAll(
  opts: { hours?: string; since?: string; top?: string; tag?: string },
): Promise<void> {
  try {
    const config = loadConfig()

    // Filter accounts by tag if specified
    let accountsToQuery = config.accounts
    if (opts.tag) {
      accountsToQuery = getAccountsByTag(opts.tag, config)
    }

    if (accountsToQuery.length === 0) {
      const tagMsg = opts.tag ? ` with tag "${opts.tag}"` : ''
      output({ message: `No accounts configured${tagMsg}. Run: cli-mail account add <provider>` })
      return
    }

    const top = opts.top ? parseInt(opts.top, 10) : 10 // per-account limit

    const sinceDate = resolveSinceDate(opts, {
      invalidSince: () => new ProviderError('Invalid date format. Use ISO 8601 format.', 'unknown'),
    })

    const limit = pLimit(4)
    const pages = await Promise.all(accountsToQuery.map((accountConfig) => limit(async () => {
      try {
        if (accountConfig.status !== 'active') {
          throw new ConfigError(`Account ${accountConfig.alias} requires reauthentication`)
        }
        const client = createClientForAccount(accountConfig)
        const result = accountConfig.provider === 'gmail'
          ? await gmailMessages.listMessagesSince(client, sinceDate, top)
          : await outlookMessages.listMessagesSince(client, sinceDate, top)
        return {
          succeeded: result.messages.length > 0 || !('errors' in result) || (result.errors?.length ?? 0) === 0,
          messages: result.messages.map((message) => ({
            account_alias: accountConfig.alias,
            account_email: accountConfig.email,
            provider: accountConfig.provider,
            id: message.id,
            from: message.from.address,
            subject: message.subject,
            date: message.date,
            read: message.isRead,
            attachments: message.hasAttachments,
          })),
          errors: 'errors' in result
            ? (result.errors ?? []).map((error) => ({
                code: 'MESSAGE_FETCH_FAILED',
                message: error.message,
                item: { account: accountConfig.alias, id: error.id },
              }))
            : [],
        }
      } catch (error) {
        return {
          succeeded: false,
          messages: [] as Array<Record<string, unknown>>,
          errors: [{
            code: 'ACCOUNT_FETCH_FAILED',
            message: errorMessage(error),
            item: { account: accountConfig.alias },
          }],
        }
      }
    })))
    const allMessages = pages.flatMap((page) => page.messages)
    const errors = pages.flatMap((page) => page.errors)

    if (!pages.some((page) => page.succeeded) && errors.length > 0) {
      throw new CliMailError('Failed to fetch messages from every account', 'ALL_ACCOUNTS_FAILED', undefined, errors)
    }

    // Sort all messages by date descending
    allMessages.sort((a, b) => {
      const dateA = a.date ? new Date(a.date as string).getTime() : 0
      const dateB = b.date ? new Date(b.date as string).getTime() : 0
      return dateB - dateA
    })

    const columns = [
      { key: 'account_alias', label: 'Account' },
      { key: 'provider', label: 'Provider' },
      { key: 'from', label: 'From' },
      { key: 'subject', label: 'Subject' },
      { key: 'date', label: 'Date' },
      { key: 'read', label: 'Read' },
    ]
    if (errors.length > 0) outputPartial(allMessages, errors)
    else outputList(allMessages, columns)
  } catch (error) {
    handleError(error)
  }
}

function outputMessagePage(
  account: Pick<AccountConfig, 'id' | 'provider'>,
  operation: string,
  result: {
    messages: MessageSummary[]
    nextPageToken?: string
    errors?: Array<{ id: string; message: string }>
  },
  search = false,
  tokenContext?: PageTokenContext,
): void {
  const items = messageRows(result.messages, { includeSnippet: search })
  const meta = {
    nextToken: encodePageToken(account, operation, result.nextPageToken, tokenContext),
  }
  outputPageResult(items, search ? messageSearchColumns : messageListColumns, {
    meta,
    errors: result.errors,
    failCode: 'MESSAGE_PAGE_FAILED',
    failMessage: 'Failed to fetch every message in this page',
    itemCode: 'MESSAGE_FETCH_FAILED',
  })
}

function resolveSinceDate(
  opts: { hours?: string; since?: string },
  options: {
    contextSince?: string
    rejectConflictingOptions?: boolean
    invalidSince: (value: string) => Error
  },
): Date {
  if (options.rejectConflictingOptions && opts.since && opts.hours) {
    throw new ConfigError('Use either --since or --hours, not both')
  }
  if (options.contextSince) {
    const contextDate = new Date(options.contextSince)
    if (Number.isNaN(contextDate.getTime())) {
      throw new ConfigError('Invalid time context in page token')
    }
    if (opts.since) {
      const requested = new Date(opts.since)
      if (Number.isNaN(requested.getTime())
        || requested.toISOString() !== contextDate.toISOString()) {
        throw new ConfigError('The supplied --since value does not match this page token')
      }
    }
    return contextDate
  }
  if (opts.since) {
    const requested = new Date(opts.since)
    if (Number.isNaN(requested.getTime())) throw options.invalidSince(opts.since)
    return requested
  }
  const hours = opts.hours ? parseInt(opts.hours, 10) : 24
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

function readUtf8BodyFile(path: string): string {
  const bytes = readRegularFile(path, 'Message body file', MAX_BODY_FILE_BYTES)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new ConfigError(`Message body file must contain valid UTF-8 text: ${path}`)
  }
}
