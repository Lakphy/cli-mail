// Category commands (Outlook-specific, with graceful handling for Gmail)

import { requireProvider, resolveAccount } from './resolve.js'
import { outputList, outputSuccess } from '../output/formatter.js'
import { handleError } from '../utils/error.js'
import * as outlookCategories from '../providers/outlook/categories.js'

const CATEGORY_PROVIDER_EXPLANATION = 'Category operations are only supported for Outlook accounts. Gmail uses labels instead — use: cli-mail folder'

export async function categoryList(opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'outlook', CATEGORY_PROVIDER_EXPLANATION)

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
    requireProvider(account, 'outlook', CATEGORY_PROVIDER_EXPLANATION)

    const category = await outlookCategories.createCategory(client, opts.name, opts.color)
    outputSuccess(`Category created: ${category.displayName} (id: ${category.id})`)
  } catch (error) {
    handleError(error)
  }
}

export async function categoryUpdate(id: string, opts: { name?: string; color?: string; account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'outlook', CATEGORY_PROVIDER_EXPLANATION)

    const category = await outlookCategories.updateCategory(client, id, opts.name, opts.color)
    outputSuccess(`Category updated: ${category.displayName}`)
  } catch (error) {
    handleError(error)
  }
}

export async function categoryDelete(id: string, opts: { account?: string }): Promise<void> {
  try {
    const { account, client } = resolveAccount(opts.account)
    requireProvider(account, 'outlook', CATEGORY_PROVIDER_EXPLANATION)

    await outlookCategories.deleteCategory(client, id)
    outputSuccess(`Category deleted: ${id}`)
  } catch (error) {
    handleError(error)
  }
}
