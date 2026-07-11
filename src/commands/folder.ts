// Folder/Label commands

import { requireProvider, resolveAccount } from './resolve.js'
import { output, outputList, outputSuccess } from '../output/formatter.js'
import { ConfigError, handleError } from '../utils/error.js'
import * as gmailLabels from '../providers/gmail/labels.js'
import * as gmailMessages from '../providers/gmail/messages.js'
import * as outlookFolders from '../providers/outlook/folders.js'
import { decodePageToken, encodePageToken } from '../utils/page-token.js'
import { messageListColumns, messageRows, outputPageResult } from './shared.js'

export async function folderList(opts: { parent?: string; top?: string; pageToken?: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)

    if (account.provider === 'gmail') {
      if (opts.pageToken) throw new ConfigError('Gmail labels are not paginated; remove --page-token')
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
      const operation = `folder.list:${opts.parent ?? ''}`
      const pageToken = decodePageToken(opts.pageToken, account, operation)
      const result = await outlookFolders.listFoldersPage(client, {
        parentId: opts.parent,
        top: opts.top ? parseInt(opts.top, 10) : 100,
        pageToken,
      })
      outputList(
        result.folders.map((f) => ({
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
        { meta: { nextToken: encodePageToken(account, operation, result.nextPageToken) } },
      )
    }
  } catch (error) {
    handleError(error)
  }
}

export async function folderGet(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const folder = account.provider === 'gmail'
      ? await gmailLabels.getLabel(client, id)
      : await outlookFolders.getFolder(client, id)
    output(folder)
  } catch (error) {
    handleError(error)
  }
}

export async function folderCreate(opts: { name: string; parent?: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const label = await gmailLabels.createLabel(client, opts.name, opts.parent)
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

export async function folderMessages(id: string, opts: { top?: string; pageToken?: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const top = opts.top ? parseInt(opts.top, 10) : 20
    const operation = `folder.messages:${id}`
    const pageToken = decodePageToken(opts.pageToken, account, operation)

    const result = account.provider === 'gmail'
      ? await gmailMessages.listMessages(client, { folder: id, top, pageToken })
      : await outlookFolders.listFolderMessages(client, id, { top, pageToken })
    outputPageResult(messageRows(result.messages), messageListColumns, {
      meta: { nextToken: encodePageToken(account, operation, result.nextPageToken) },
      errors: 'errors' in result ? result.errors : undefined,
      failCode: 'MESSAGE_PAGE_FAILED',
      failMessage: 'Failed to fetch every message in this folder page',
      itemCode: 'MESSAGE_FETCH_FAILED',
    })
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
    requireProvider(
      account,
      'outlook',
      'Folder move is only supported for Outlook. Gmail labels have no hierarchy.',
    )
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
    requireProvider(
      account,
      'outlook',
      'Folder copy is only supported for Outlook. Gmail labels have no hierarchy.',
    )
    const result = await outlookFolders.copyFolder(client, id, opts.toFolder)
    outputSuccess(`Folder copied (new id: ${result.id})`)
  } catch (error) {
    handleError(error)
  }
}
