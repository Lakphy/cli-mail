// Config file management (~/.cli-mail/)

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AccountConfig, AppConfig } from './types.js'
import { DEFAULT_CONFIG } from './types.js'
import { ConfigError } from '../utils/error.js'

const CONFIG_DIR = join(homedir(), '.cli-mail')
const CONFIG_FILE = join(CONFIG_DIR, 'accounts.json')

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

export { CONFIG_DIR, CONFIG_FILE }
