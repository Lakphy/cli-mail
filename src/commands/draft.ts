// Draft commands

import { resolveAccount } from './resolve.js'
import { output, outputList, outputSuccess } from '../output/formatter.js'
import { handleError } from '../utils/error.js'
import * as gmailDrafts from '../providers/gmail/drafts.js'
import * as outlookDrafts from '../providers/outlook/drafts.js'

export async function draftList(opts: { top?: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    const top = opts.top ? parseInt(opts.top, 10) : 20

    if (account.provider === 'gmail') {
      const result = await gmailDrafts.listDrafts(client, top)
      outputList(
        result.drafts.map((d) => ({
          id: d.id,
          subject: d.subject,
          to: d.to.map((a) => a.address).join(', '),
          snippet: d.snippet,
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'subject', label: 'Subject' },
          { key: 'to', label: 'To' },
          { key: 'snippet', label: 'Snippet' },
        ],
      )
    } else {
      const result = await outlookDrafts.listDrafts(client, top)
      outputList(
        result.drafts.map((d) => ({
          id: d.id,
          subject: d.subject,
          to: d.to.map((a) => a.address).join(', '),
          snippet: d.snippet,
        })),
        [
          { key: 'id', label: 'ID' },
          { key: 'subject', label: 'Subject' },
          { key: 'to', label: 'To' },
          { key: 'snippet', label: 'Snippet' },
        ],
      )
    }
  } catch (error) {
    handleError(error)
  }
}

export async function draftGet(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    if (account.provider === 'gmail') {
      const draft = await gmailDrafts.getDraft(client, id)
      output(draft)
    } else {
      const draft = await outlookDrafts.getDraft(client, id)
      output(draft)
    }
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

    if (account.provider === 'gmail') {
      const result = await gmailDrafts.createDraft(client, createOpts)
      outputSuccess(`Draft created (id: ${result.id})`)
    } else {
      const result = await outlookDrafts.createDraft(client, createOpts)
      outputSuccess(`Draft created (id: ${result.id})`)
    }
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
    const { account, client } = resolveAccount(opts.account)
    const updateOpts = {
      to: opts.to,
      subject: opts.subject,
      body: opts.body,
      cc: opts.cc,
      bcc: opts.bcc,
      bodyType: opts.bodyType as 'text' | 'html' | undefined,
    }

    if (account.provider === 'gmail') {
      const result = await gmailDrafts.updateDraft(client, id, updateOpts)
      outputSuccess(`Draft updated (id: ${result.id})`)
    } else {
      const result = await outlookDrafts.updateDraft(client, id, updateOpts)
      outputSuccess(`Draft updated (id: ${result.id})`)
    }
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
