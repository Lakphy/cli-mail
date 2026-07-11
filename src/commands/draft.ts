// Draft commands

import { resolveAccount } from './resolve.js'
import { output, outputSuccess } from '../output/formatter.js'
import { ConfigError, handleError } from '../utils/error.js'
import * as gmailDrafts from '../providers/gmail/drafts.js'
import * as outlookDrafts from '../providers/outlook/drafts.js'
import {
  decodePageTokenState,
  encodePageToken,
  resolvePageTokenOption,
} from '../utils/page-token.js'
import { outputPageResult } from './shared.js'

export async function draftList(opts: { top?: string; pageToken?: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const pageState = decodePageTokenState(opts.pageToken, account, 'draft.list')
    const topValue = resolvePageTokenOption(pageState, 'top', opts.top) ?? '20'
    const top = parseInt(topValue, 10)

    const result = account.provider === 'gmail'
      ? await gmailDrafts.listDrafts(client, { top, pageToken: pageState?.cursor })
      : await outlookDrafts.listDrafts(client, { top, pageToken: pageState?.cursor })
    const items = result.drafts.map((draft) => ({
      id: draft.id,
      subject: draft.subject,
      to: draft.to.map((address) => address.address).join(', '),
      snippet: draft.snippet,
    }))
    const meta = { nextToken: encodePageToken(
      account,
      'draft.list',
      result.nextPageToken,
      { top: topValue },
    ) }
    const columns = [
      { key: 'id', label: 'ID' },
      { key: 'subject', label: 'Subject' },
      { key: 'to', label: 'To' },
      { key: 'snippet', label: 'Snippet' },
    ]
    const errors = 'errors' in result ? result.errors : undefined
    outputPageResult(items, columns, {
      meta,
      errors,
      failCode: 'DRAFT_PAGE_FAILED',
      failMessage: 'Failed to fetch every draft in this page',
      itemCode: 'DRAFT_FETCH_FAILED',
    })
  } catch (error) {
    handleError(error)
  }
}

export async function draftGet(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const draft = account.provider === 'gmail'
      ? await gmailDrafts.getDraft(client, id)
      : await outlookDrafts.getDraft(client, id)
    output(draft)
  } catch (error) {
    handleError(error)
  }
}

interface DraftCreateOpts {
  to: string[]
  subject: string
  body?: string
  cc?: string[]
  bcc?: string[]
  bodyType?: string
  account?: string
}

export async function draftCreate(opts: DraftCreateOpts): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const createOpts = {
      to: opts.to,
      subject: opts.subject,
      body: opts.body || '',
      cc: opts.cc,
      bcc: opts.bcc,
      bodyType: (opts.bodyType as 'text' | 'html') || 'text',
    }

    const result = account.provider === 'gmail'
      ? await gmailDrafts.createDraft(client, createOpts)
      : await outlookDrafts.createDraft(client, createOpts)
    outputSuccess(`Draft created (id: ${result.id})`)
  } catch (error) {
    handleError(error)
  }
}

interface DraftUpdateOpts {
  to?: string[]
  subject?: string
  body?: string
  cc?: string[]
  bcc?: string[]
  bodyType?: string
  account?: string
}

export async function draftUpdate(id: string, opts: DraftUpdateOpts): Promise<void> {
  try {
    if (opts.to === undefined
      && opts.subject === undefined
      && opts.body === undefined
      && opts.cc === undefined
      && opts.bcc === undefined
      && opts.bodyType === undefined) {
      throw new ConfigError('Provide at least one draft field to update')
    }
    if (opts.bodyType !== undefined && opts.body === undefined) {
      throw new ConfigError('--body-type requires --body when updating a draft')
    }
    const { account, client } = resolveAccount(opts.account)
    const updateOpts = {
      to: opts.to,
      subject: opts.subject,
      body: opts.body,
      cc: opts.cc,
      bcc: opts.bcc,
      bodyType: opts.bodyType as 'text' | 'html' | undefined,
    }

    const result = account.provider === 'gmail'
      ? await gmailDrafts.updateDraft(client, id, updateOpts)
      : await outlookDrafts.updateDraft(client, id, updateOpts)
    outputSuccess(`Draft updated (id: ${result.id})`)
  } catch (error) {
    handleError(error)
  }
}

export async function draftSend(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const result = await gmailDrafts.sendDraft(client, id)
      outputSuccess(`Draft sent (id: ${result.id})`)
    } else {
      await outlookDrafts.sendDraft(client, id)
      outputSuccess('Draft sent')
    }
  } catch (error) {
    handleError(error)
  }
}

export async function draftDelete(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      await gmailDrafts.deleteDraft(client, id)
    } else {
      await outlookDrafts.deleteDraft(client, id)
    }
    outputSuccess(`Draft deleted: ${id}`)
  } catch (error) {
    handleError(error)
  }
}
