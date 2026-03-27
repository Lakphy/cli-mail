import { resolveAccount } from './resolve.js'
import { output, outputList, outputSuccess, outputRaw } from '../output/formatter.js'
import { handleError, ProviderError } from '../utils/error.js'
import * as gmailMessages from '../providers/gmail/messages.js'
import * as outlookMessages from '../providers/outlook/messages.js'
import { readFileSync } from 'node:fs'

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
    const options = {
      folder: opts.folder,
      query: opts.query,
      top: opts.top ? parseInt(opts.top, 10) : 20,
      skip: opts.skip ? parseInt(opts.skip, 10) : undefined,
    }

    if (account.provider === 'gmail') {
      const result = await gmailMessages.listMessages(client, options)
      outputList(
        result.messages.map((m) => ({
          id: m.id,
          from: m.from.address,
          subject: m.subject,
          date: m.date,
          read: m.isRead ? 'yes' : 'no',
          attachments: m.hasAttachments ? 'yes' : 'no',
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'from', label: 'From' },
          { key: 'subject', label: 'Subject' },
          { key: 'date', label: 'Date' },
          { key: 'read', label: 'Read' },
          { key: 'attachments', label: 'Attachments' },
        ],
      )
    } else {
      const result = await outlookMessages.listMessages(client, options)
      outputList(
        result.messages.map((m) => ({
          id: m.id,
          from: m.from.address,
          subject: m.subject,
          date: m.date,
          read: m.isRead ? 'yes' : 'no',
          attachments: m.hasAttachments ? 'yes' : 'no',
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'from', label: 'From' },
          { key: 'subject', label: 'Subject' },
          { key: 'date', label: 'Date' },
          { key: 'read', label: 'Read' },
          { key: 'attachments', label: 'Attachments' },
        ],
      )
    }
  } catch (error) {
    handleError(error)
  }
}

export async function messageGet(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const msg = await gmailMessages.getMessage(client, id)
      output(msg)
    } else {
      const msg = await outlookMessages.getMessage(client, id)
      output(msg)
    }
  } catch (error) {
    handleError(error)
  }
}

export async function messageRaw(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const raw = await gmailMessages.getMessageRaw(client, id)
      outputRaw(raw)
    } else {
      const raw = await outlookMessages.getMessageRaw(client, id)
      outputRaw(raw)
    }
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
    const { account, client } = resolveAccount(opts.account)

    let body = opts.body || ''
    if (opts.bodyFile) {
      body = readFileSync(opts.bodyFile, 'utf-8')
    }
    if (!body) {
      body = ''
    }

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
      const result = await gmailMessages.replyToMessage(client, id, opts.body, opts.replyAll)
      outputSuccess(`Reply sent (id: ${result.id})`)
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
    if (account.provider === 'gmail') {
      await gmailMessages.deleteMessage(client, id, opts.permanent)
    } else {
      await outlookMessages.deleteMessage(client, id, opts.permanent)
    }
    outputSuccess(`Message deleted: ${id}`)
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
    if (account.provider === 'gmail') {
      // Gmail: add target label, remove INBOX
      await gmailMessages.moveMessage(client, id, [opts.toFolder], ['INBOX'])
    } else {
      await outlookMessages.moveMessage(client, id, opts.toFolder)
    }
    outputSuccess(`Message moved to: ${opts.toFolder}`)
  } catch (error) {
    handleError(error)
  }
}

export async function messageMark(
  id: string,
  opts: { read?: boolean; unread?: boolean; flagged?: boolean; unflagged?: boolean; account?: string },
): Promise<void> {
  try {
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
  opts: { query: string; top?: string; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const top = opts.top ? parseInt(opts.top, 10) : 20

    if (account.provider === 'gmail') {
      const result = await gmailMessages.searchMessages(client, opts.query, top)
      outputList(
        result.messages.map((m) => ({
          id: m.id,
          from: m.from.address,
          subject: m.subject,
          date: m.date,
          snippet: m.snippet,
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'from', label: 'From' },
          { key: 'subject', label: 'Subject' },
          { key: 'date', label: 'Date' },
          { key: 'snippet', label: 'Snippet' },
        ],
      )
    } else {
      const result = await outlookMessages.searchMessages(client, opts.query, top)
      outputList(
        result.messages.map((m) => ({
          id: m.id,
          from: m.from.address,
          subject: m.subject,
          date: m.date,
          snippet: m.snippet,
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'from', label: 'From' },
          { key: 'subject', label: 'Subject' },
          { key: 'date', label: 'Date' },
          { key: 'snippet', label: 'Snippet' },
        ],
      )
    }
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
      // Outlook: move back to Inbox from DeletedItems
      await outlookMessages.moveMessage(client, id, 'Inbox')
      outputSuccess(`Message restored to Inbox: ${id}`)
    }
  } catch (error) {
    handleError(error)
  }
}

export async function messageBatchDelete(
  opts: { ids: string[]; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      await gmailMessages.batchDeleteMessages(client, opts.ids)
      outputSuccess(`Batch deleted ${opts.ids.length} messages`)
    } else {
      // Outlook: delete one by one
      for (const id of opts.ids) {
        await outlookMessages.deleteMessage(client, id, false)
      }
      outputSuccess(`Deleted ${opts.ids.length} messages`)
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
    if (account.provider !== 'gmail') {
      throw new ProviderError('Message import is only supported for Gmail accounts', account.provider)
    }
    const rawMime = readFileSync(opts.file, 'utf-8')
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
    if (account.provider !== 'outlook') {
      throw new ProviderError('Message copy is only supported for Outlook accounts. Gmail uses labels instead.', account.provider)
    }
    const result = await outlookMessages.copyMessage(client, id, opts.toFolder)
    outputSuccess(`Message copied (new id: ${result.id})`)
  } catch (error) {
    handleError(error)
  }
}
