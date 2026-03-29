// Config file management (~/.cli-mail/)

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { AccountConfig, AppConfig } from './types.js'
import { DEFAULT_CONFIG } from './types.js'
import { ConfigError } from '../utils/error.js'

const DEFAULT_CONFIG_DIR = join(homedir(), '.cli-mail')
const DEFAULT_CONFIG_FILE = join(DEFAULT_CONFIG_DIR, 'accounts.json')

let CONFIG_DIR = DEFAULT_CONFIG_DIR
let CONFIG_FILE = DEFAULT_CONFIG_FILE

/** Set a custom config file path (also updates CONFIG_DIR to its parent) */
export function setConfigPath(filePath: string): void {
  CONFIG_FILE = filePath
  CONFIG_DIR = dirname(filePath)
}

/** Get the current config file path */
export function getConfigPath(): string {
  return CONFIG_FILE
}

/** Reset config path to default (~/.cli-mail/accounts.json) */
export function resetConfigPath(): void {
  CONFIG_DIR = DEFAULT_CONFIG_DIR
  CONFIG_FILE = DEFAULT_CONFIG_FILE
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  }
}

export function loadConfig(): AppConfig {
  ensureConfigDir()
  if (!existsSync(CONFIG_FILE)) {
    saveConfig(DEFAULT_CONFIG)
    return { ...DEFAULT_CONFIG }
  }

  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8')
    return JSON.parse(raw) as AppConfig
  } catch {
    throw new ConfigError(`Failed to parse config file: ${CONFIG_FILE}`)
  }
}

export function saveConfig(config: AppConfig): void {
  ensureConfigDir()
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
  chmodSync(CONFIG_FILE, 0o600)
}

export function getAccount(alias?: string): AccountConfig {
  const config = loadConfig()

  if (alias) {
    const account = config.accounts.find((a) => a.alias === alias)
    if (!account) {
      throw new ConfigError(`Account not found: ${alias}`)
    }
    return account
  }

  if (!config.default_account) {
    throw new ConfigError(
      'No default account set. Run: cli-mail account add <provider>',
    )
  }

  const account = config.accounts.find(
    (a) => a.alias === config.default_account,
  )
  if (!account) {
    throw new ConfigError(
      `Default account "${config.default_account}" not found. Run: cli-mail account list`,
    )
  }
  return account
}

export function addAccount(account: AccountConfig): void {
  const config = loadConfig()
  const existing = config.accounts.findIndex((a) => a.alias === account.alias)

  if (existing >= 0) {
    config.accounts[existing] = account
  } else {
    config.accounts.push(account)
  }

  if (!config.default_account) {
    config.default_account = account.alias
  }

  saveConfig(config)
}

export function removeAccount(alias: string): void {
  const config = loadConfig()
  const idx = config.accounts.findIndex((a) => a.alias === alias)
  if (idx < 0) {
    throw new ConfigError(`Account not found: ${alias}`)
  }

  config.accounts.splice(idx, 1)

  if (config.default_account === alias) {
    config.default_account = config.accounts.length > 0
      ? config.accounts[0].alias
      : null
  }

  saveConfig(config)
}

export function setDefaultAccount(alias: string): void {
  const config = loadConfig()
  const account = config.accounts.find((a) => a.alias === alias)
  if (!account) {
    throw new ConfigError(`Account not found: ${alias}`)
  }
  config.default_account = alias
  saveConfig(config)
}

export function renameAccount(oldAlias: string, newAlias: string): void {
  const config = loadConfig()
  const account = config.accounts.find((a) => a.alias === oldAlias)
  if (!account) {
    throw new ConfigError(`Account not found: ${oldAlias}`)
  }

  // Check new alias doesn't conflict
  const conflict = config.accounts.find((a) => a.alias === newAlias)
  if (conflict) {
    throw new ConfigError(`Alias already in use: ${newAlias}`)
  }

  account.alias = newAlias
  account.updated_at = new Date().toISOString()

  // Update default_account reference if it pointed to the old alias
  if (config.default_account === oldAlias) {
    config.default_account = newAlias
  }

  saveConfig(config)
}

export function updateAccountTokens(
  alias: string,
  tokens: AccountConfig['tokens'],
): void {
  const config = loadConfig()
  const account = config.accounts.find((a) => a.alias === alias)
  if (!account) {
    throw new ConfigError(`Account not found: ${alias}`)
  }
  account.tokens = tokens
  account.updated_at = new Date().toISOString()
  saveConfig(config)
}

// ==================== Tag Management ====================

const TAG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,31}$/

/** Validate a tag name: alphanumeric + hyphens, 1-32 chars, cannot be "default" */
export function validateTag(tag: string): void {
  if (tag === 'default') {
    throw new ConfigError('"default" is a reserved group name and cannot be used as a tag')
  }
  if (!TAG_REGEX.test(tag)) {
    throw new ConfigError(
      `Invalid tag: "${tag}". Tags must be 1-32 characters, alphanumeric and hyphens only, starting with a letter or number.`,
    )
  }
}

/** Set or remove a tag on an account */
export function setAccountTag(alias: string, tag: string | null): void {
  const config = loadConfig()
  const account = config.accounts.find((a) => a.alias === alias)
  if (!account) {
    throw new ConfigError(`Account not found: ${alias}`)
  }

  if (tag !== null) {
    validateTag(tag)
    account.tag = tag
  } else {
    delete account.tag
  }

  account.updated_at = new Date().toISOString()
  saveConfig(config)
}

/** Get accounts filtered by tag. If tag is "default", returns accounts without a tag. */
export function getAccountsByTag(tag: string): AccountConfig[] {
  const config = loadConfig()
  if (tag === 'default') {
    return config.accounts.filter((a) => !a.tag)
  }
  return config.accounts.filter((a) => a.tag === tag)
}

/** List all unique tags across accounts, always including "default" if any untagged accounts exist */
export function listTags(): Array<{ tag: string; count: number }> {
  const config = loadConfig()
  const tagMap = new Map<string, number>()

  for (const account of config.accounts) {
    const t = account.tag || 'default'
    tagMap.set(t, (tagMap.get(t) || 0) + 1)
  }

  // Sort: "default" first, then alphabetical
  const entries = Array.from(tagMap.entries())
  entries.sort((a, b) => {
    if (a[0] === 'default') return -1
    if (b[0] === 'default') return 1
    return a[0].localeCompare(b[0])
  })

  return entries.map(([tag, count]) => ({ tag, count }))
}

export { CONFIG_DIR, CONFIG_FILE }

