import {
  outputList,
  outputPartial,
  type OutputColumn,
  type OutputMeta,
} from '../output/formatter.js'
import type { MessageSummary } from '../providers/types.js'
import { CliMailError } from '../utils/error.js'

export interface PageItemError {
  id: string
  message: string
}

export interface PageOutputOptions {
  meta?: OutputMeta
  errors?: PageItemError[]
  failCode: string
  failMessage: string
  itemCode: string
}

export const messageListColumns: OutputColumn[] = [
  { key: 'id', label: 'ID' },
  { key: 'from', label: 'From' },
  { key: 'subject', label: 'Subject' },
  { key: 'date', label: 'Date' },
  { key: 'read', label: 'Read' },
  { key: 'attachments', label: 'Attachments' },
]

export const messageSearchColumns: OutputColumn[] = [
  { key: 'id', label: 'ID' },
  { key: 'from', label: 'From' },
  { key: 'subject', label: 'Subject' },
  { key: 'date', label: 'Date' },
  { key: 'snippet', label: 'Snippet' },
]

export function messageRows(
  messages: MessageSummary[],
  options: { includeSnippet?: boolean } = {},
): Array<Record<string, unknown>> {
  return messages.map((message) => ({
    id: message.id,
    from: message.from.address,
    subject: message.subject,
    date: message.date,
    read: message.isRead,
    attachments: message.hasAttachments,
    ...(options.includeSnippet ? { snippet: message.snippet } : {}),
  }))
}

export function outputPageResult(
  items: Array<Record<string, unknown>>,
  columns: OutputColumn[],
  options: PageOutputOptions,
): void {
  if (options.errors?.length) {
    if (items.length === 0) {
      throw new CliMailError(
        options.failMessage,
        options.failCode,
        undefined,
        options.errors,
      )
    }
    outputPartial(
      items,
      options.errors.map((error) => ({
        code: options.itemCode,
        message: error.message,
        item: { id: error.id },
      })),
      { meta: options.meta },
    )
    return
  }

  outputList(items, columns, { meta: options.meta })
}
