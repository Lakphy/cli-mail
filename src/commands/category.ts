// Category commands (Outlook-specific, with graceful handling for Gmail)

import { resolveAccount } from './resolve.js'
import { outputList, outputSuccess } from '../output/formatter.js'
import { handleError, ProviderError } from '../utils/error.js'
import * as outlookCategories from '../providers/outlook/categories.js'

function requireOutlook(provider: string): void {
  if (provider !== 'outlook') {
    throw new ProviderError(
      'Category operations are only supported for Outlook accounts. Gmail uses labels instead — use: cli-mail folder',
      provider,
    )
  }
}

export async function categoryList(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireOutlook(account.provider)

    const categories = await outlookCategories.listCategories(client)
    outputList(
      categories.map((c) => ({
        id: c.id,
        name: c.displayName,
        color: c.color || '',
      })),
      [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name' },
        { key: 'color', label: 'Color' },
      ],
    )
  } catch (error) {
    handleError(error)
  }
}

export async function categoryCreate(opts: { name: string; color?: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireOutlook(account.provider)

    const category = await outlookCategories.createCategory(client, opts.name, opts.color)
    outputSuccess(`Category created: ${category.displayName} (id: ${category.id})`)
  } catch (error) {
    handleError(error)
  }
}

export async function categoryUpdate(id: string, opts: { name?: string; color?: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireOutlook(account.provider)

    const category = await outlookCategories.updateCategory(client, id, opts.name, opts.color)
    outputSuccess(`Category updated: ${category.displayName}`)
  } catch (error) {
    handleError(error)
  }
}

export async function categoryDelete(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireOutlook(account.provider)

    await outlookCategories.deleteCategory(client, id)
    outputSuccess(`Category deleted: ${id}`)
  } catch (error) {
    handleError(error)
  }
}
