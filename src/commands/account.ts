// Account management commands

import { createInterface } from 'node:readline'
import {
  loadConfig,
  addAccount,
  removeAccount,
  setDefaultAccount,
  renameAccount,
  getAccount,
} from '../config/store.js'
import type { Provider, AccountConfig } from '../config/types.js'
import { gmailAuthFlow } from '../providers/gmail/auth.js'
import { outlookAuthFlow } from '../providers/outlook/auth.js'
import { output, outputList, outputSuccess, getGlobalFormat } from '../output/formatter.js'
import { handleError, ConfigError } from '../utils/error.js'

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export async function accountAdd(provider: string, alias?: string): Promise<void> {
  try {
    const validProvider = validateProvider(provider)

    const clientId = await prompt('Client ID: ')
    const clientSecret = await prompt('Client Secret: ')

    if (!clientId || !clientSecret) {
      throw new ConfigError('Client ID and Client Secret are required')
    }

    let tokens
    let email: string

    if (validProvider === 'gmail') {
      const result = await gmailAuthFlow(clientId, clientSecret)
      tokens = result.tokens
      email = result.email
    } else {
      const result = await outlookAuthFlow(clientId, clientSecret)
      tokens = result.tokens
      email = result.email
    }

    const accountAlias = alias || email

    const account: AccountConfig = {
      alias: accountAlias,
      provider: validProvider,
      email,
      client_id: clientId,
      client_secret: clientSecret,
      tokens,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    addAccount(account)
    outputSuccess(`Account added: ${accountAlias} (${email}) [${validProvider}]`)
  } catch (error) {
    handleError(error)
  }
}

export function accountRemove(alias: string): void {
  try {
    removeAccount(alias)
    outputSuccess(`Account removed: ${alias}`)
  } catch (error) {
    handleError(error)
  }
}

export function accountList(): void {
  try {
    const config = loadConfig()
    if (config.accounts.length === 0) {
      output({ message: 'No accounts configured. Run: cli-mail account add <provider>' })
      return
    }

    const isJson = getGlobalFormat() === 'json'

    outputList(
      config.accounts.map((a) => ({
        alias: a.alias,
        provider: a.provider,
        email: a.email,
        default: isJson
          ? (a.alias === config.default_account)
          : (a.alias === config.default_account ? '✓' : ''),
        created: a.created_at,
      })),
      [
        { key: 'alias', label: 'Alias' },
        { key: 'provider', label: 'Provider' },
        { key: 'email', label: 'Email' },
        { key: 'default', label: 'Default' },
        { key: 'created', label: 'Created' },
      ],
    )
  } catch (error) {
    handleError(error)
  }
}

export function accountSwitch(alias: string): void {
  try {
    setDefaultAccount(alias)
    outputSuccess(`Default account set to: ${alias}`)
  } catch (error) {
    handleError(error)
  }
}

export function accountInfo(alias?: string): void {
  try {
    const account = getAccount(alias)
    output({
      alias: account.alias,
      provider: account.provider,
      email: account.email,
      created_at: account.created_at,
      updated_at: account.updated_at,
      token_expires_at: account.tokens.expires_at
        ? new Date(account.tokens.expires_at).toISOString()
        : 'unknown',
      scopes: account.tokens.scope,
    })
  } catch (error) {
    handleError(error)
  }
}

export function accountRename(oldAlias: string, newAlias: string): void {
  try {
    renameAccount(oldAlias, newAlias)
    outputSuccess(`Account renamed: ${oldAlias} → ${newAlias}`)
  } catch (error) {
    handleError(error)
  }
}

export async function accountValidate(alias?: string): Promise<void> {
  try {
    const config = loadConfig()
    const accountsToCheck = alias
      ? [getAccount(alias)]
      : config.accounts

    if (accountsToCheck.length === 0) {
      output({ message: 'No accounts configured.' })
      return
    }

    const results: Array<Record<string, unknown>> = []

    for (const account of accountsToCheck) {
      const result: Record<string, unknown> = {
        alias: account.alias,
        email: account.email,
        provider: account.provider,
      }

      // Check token expiration
      if (account.tokens.expires_at) {
        const expiresAt = new Date(account.tokens.expires_at)
        const now = new Date()
        result.token_valid = expiresAt > now
        result.token_expires_at = expiresAt.toISOString()
        if (expiresAt <= now) {
          result.issue = 'Token expired. Run: cli-mail account add ' + account.provider
        }
      } else {
        result.token_valid = false
        result.issue = 'No token expiration info'
      }

      // Check alias uniqueness
      const dupes = config.accounts.filter((a) => a.alias === account.alias)
      result.alias_unique = dupes.length === 1

      results.push(result)
    }

    // Check default_account reference
    const defaultValid = config.default_account
      ? config.accounts.some((a) => a.alias === config.default_account)
      : false

    const isJson = getGlobalFormat() === 'json'
    if (isJson) {
      output({
        default_account: config.default_account,
        default_account_valid: defaultValid,
        accounts: results,
      })
    } else {
      if (!defaultValid && config.default_account) {
        outputSuccess(`⚠ Default account "${config.default_account}" not found in accounts list`)
      }
      outputList(
        results.map((r) => ({
          ...r,
          token_valid: r.token_valid ? '✓' : '✗',
          alias_unique: r.alias_unique ? '✓' : '✗',
        })),
        [
          { key: 'alias', label: 'Alias' },
          { key: 'email', label: 'Email' },
          { key: 'provider', label: 'Provider' },
          { key: 'token_valid', label: 'Token' },
          { key: 'alias_unique', label: 'Unique' },
          { key: 'issue', label: 'Issue' },
        ],
      )
    }
  } catch (error) {
    handleError(error)
  }
}

function validateProvider(provider: string): Provider {
  if (provider !== 'gmail' && provider !== 'outlook') {
    throw new ConfigError(`Invalid provider: ${provider}. Must be "gmail" or "outlook"`)
  }
  return provider
}
