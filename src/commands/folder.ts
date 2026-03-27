// Folder/Label commands

import { resolveAccount } from './resolve.js'
import { output, outputList, outputSuccess } from '../output/formatter.js'
import { handleError, ProviderError } from '../utils/error.js'
import * as gmailLabels from '../providers/gmail/labels.js'
import * as gmailMessages from '../providers/gmail/messages.js'
import * as outlookFolders from '../providers/outlook/folders.js'

export async function folderList(opts: { parent?: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)

    if (account.provider === 'gmail') {
      const labels = await gmailLabels.listLabels(client)
      outputList(
        labels.map((l) => ({
          id: l.id,
          name: l.name,
          messages: l.messageCount ?? '',
          unread: l.unreadCount ?? '',
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'Name' },
          { key: 'messages', label: 'Messages' },
          { key: 'unread', label: 'Unread' },
        ],
      )
    } else {
      const folders = await outlookFolders.listFolders(client, opts.parent)
      outputList(
        folders.map((f) => ({
          id: f.id,
          name: f.name,
          messages: f.messageCount ?? '',
          unread: f.unreadCount ?? '',
          children: f.childFolderCount ?? '',
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'Name' },
          { key: 'messages', label: 'Messages' },
          { key: 'unread', label: 'Unread' },
          { key: 'children', label: 'Children' },
        ],
      )
    }
  } catch (error) {
    handleError(error)
  }
}

export async function folderGet(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const label = await gmailLabels.getLabel(client, id)
      output(label)
    } else {
      const folder = await outlookFolders.getFolder(client, id)
      output(folder)
    }
  } catch (error) {
    handleError(error)
  }
}

export async function folderCreate(opts: { name: string; parent?: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      // Gmail labels don't support parent; use "/" in name for nesting
      const name = opts.parent ? `${opts.parent}/${opts.name}` : opts.name
      const label = await gmailLabels.createLabel(client, name)
      outputSuccess(`Label created: ${label.name} (id: ${label.id})`)
    } else {
      const folder = await outlookFolders.createFolder(client, opts.name, opts.parent)
      outputSuccess(`Folder created: ${folder.name} (id: ${folder.id})`)
    }
  } catch (error) {
    handleError(error)
  }
}

export async function folderUpdate(id: string, opts: { name: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const label = await gmailLabels.updateLabel(client, id, opts.name)
      outputSuccess(`Label updated: ${label.name}`)
    } else {
      const folder = await outlookFolders.updateFolder(client, id, opts.name)
      outputSuccess(`Folder updated: ${folder.name}`)
    }
  } catch (error) {
    handleError(error)
  }
}

export async function folderDelete(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      await gmailLabels.deleteLabel(client, id)
    } else {
      await outlookFolders.deleteFolder(client, id)
    }
    outputSuccess(`Folder/Label deleted: ${id}`)
  } catch (error) {
    handleError(error)
  }
}

export async function folderMessages(id: string, opts: { top?: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const top = opts.top ? parseInt(opts.top, 10) : 20

    if (account.provider === 'gmail') {
      // For Gmail, list messages with label filter
      const result = await gmailMessages.listMessages(client, { folder: id, top })
      outputList(
        result.messages.map((m) => ({
          id: m.id,
          from: m.from.address,
          subject: m.subject,
          date: m.date,
          read: m.isRead ? 'yes' : 'no',
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'from', label: 'From' },
          { key: 'subject', label: 'Subject' },
          { key: 'date', label: 'Date' },
          { key: 'read', label: 'Read' },
        ],
      )
    } else {
      const result = await outlookFolders.listFolderMessages(client, id, top)
      outputList(
        result.messages.map((m) => ({
          id: m.id,
          from: m.from.address,
          subject: m.subject,
          date: m.date,
          read: m.isRead ? 'yes' : 'no',
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'from', label: 'From' },
          { key: 'subject', label: 'Subject' },
          { key: 'date', label: 'Date' },
          { key: 'read', label: 'Read' },
        ],
      )
    }
  } catch (error) {
    handleError(error)
  }
}

export async function folderMove(
  id: string,
  opts: { toFolder: string; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider !== 'outlook') {
      throw new ProviderError('Folder move is only supported for Outlook. Gmail labels have no hierarchy.', account.provider)
    }
    const result = await outlookFolders.moveFolder(client, id, opts.toFolder)
    output(result)
  } catch (error) {
    handleError(error)
  }
}

export async function folderCopy(
  id: string,
  opts: { toFolder: string; account?: string },
): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider !== 'outlook') {
      throw new ProviderError('Folder copy is only supported for Outlook. Gmail labels have no hierarchy.', account.provider)
    }
    const result = await outlookFolders.copyFolder(client, id, opts.toFolder)
    outputSuccess(`Folder copied (new id: ${result.id})`)
  } catch (error) {
    handleError(error)
  }
}
