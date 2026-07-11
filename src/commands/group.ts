// Group management commands — view accounts organized by tags

import { listTags, getAccountsByTag, loadConfig } from '../config/store.js'
import { output, outputList } from '../output/formatter.js'
import { handleError } from '../utils/error.js'

export function groupList(): void {
  try {
    const tags = listTags()

    if (tags.length === 0) {
      output({ message: 'No accounts configured. Run: cli-mail account add <provider>' })
      return
    }

    outputList(
      tags.map((t) => ({
        tag: t.tag,
        accounts: t.count,
      })),
      [
        { key: 'tag', label: 'Tag' },
        { key: 'accounts', label: 'Accounts' },
      ],
    )
  } catch (error) {
    handleError(error)
  }
}

export function groupShow(tag: string): void {
  try {
    const config = loadConfig()
    const accounts = getAccountsByTag(tag, config)

    if (accounts.length === 0) {
      output({ message: `No accounts found with tag: ${tag}` })
      return
    }

    outputList(
      accounts.map((a) => ({
        alias: a.alias,
        provider: a.provider,
        email: a.email,
        default: a.id === config.defaultAccountId,
      })),
      [
        { key: 'alias', label: 'Alias' },
        { key: 'provider', label: 'Provider' },
        { key: 'email', label: 'Email' },
        { key: 'default', label: 'Default' },
      ],
    )
  } catch (error) {
    handleError(error)
  }
}
