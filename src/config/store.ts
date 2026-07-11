// Versioned, validated and crash-safe config file management (~/.cli-mail/).

import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { z } from 'zod'
import type { AccountConfig, AccountStatus, AppConfig, OAuthTokens, Provider } from './types.js'
import { CONFIG_VERSION, createDefaultConfig } from './types.js'
import { AccountReauthRequiredError, ConfigError, errorMessage } from '../utils/error.js'

const DEFAULT_CONFIG_DIR = join(homedir(), '.cli-mail')
const DEFAULT_CONFIG_FILE = join(DEFAULT_CONFIG_DIR, 'accounts.json')
const LOCK_WAIT_MS = 5_000
const LOCK_STALE_MS = 60_000

let CONFIG_DIR = DEFAULT_CONFIG_DIR
let CONFIG_FILE = DEFAULT_CONFIG_FILE

const oauthTokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.number().finite().nonnegative(),
  token_type: z.string(),
  scope: z.string().optional(),
}).strict()

const accountSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['active', 'needs_reauth']),
  alias: z.string().min(1),
  tag: z.string().optional(),
  provider: z.enum(['gmail', 'outlook']),
  email: z.string().min(1),
  client_id: z.string(),
  client_secret: z.string().optional(),
  tokens: oauthTokensSchema,
  scopes: z.array(z.string().min(1)),
  created_at: z.string(),
  updated_at: z.string(),
}).strict()

const persistedConfigSchema = z.object({
  version: z.literal(CONFIG_VERSION),
  defaultAccountId: z.string().uuid().nullable(),
  accounts: z.array(accountSchema),
}).strict().superRefine((config, context) => {
  const ids = new Set<string>()
  const aliases = new Set<string>()

  config.accounts.forEach((account, index) => {
    if (ids.has(account.id)) {
      context.addIssue({
        code: 'custom',
        path: ['accounts', index, 'id'],
        message: 'duplicate account id',
      })
    }
    if (aliases.has(account.alias)) {
      context.addIssue({
        code: 'custom',
        path: ['accounts', index, 'alias'],
        message: 'duplicate account alias',
      })
    }
    ids.add(account.id)
    aliases.add(account.alias)

    if (account.provider === 'outlook' && account.client_secret !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['accounts', index, 'client_secret'],
        message: 'Outlook public clients must not store a client secret',
      })
    }
    if (account.status === 'active') {
      if (!account.client_id) {
        context.addIssue({
          code: 'custom',
          path: ['accounts', index, 'client_id'],
          message: 'is required for an active account',
        })
      }
      if (!account.tokens.access_token) {
        context.addIssue({
          code: 'custom',
          path: ['accounts', index, 'tokens', 'access_token'],
          message: 'is required for an active account',
        })
      }
      if (!account.tokens.refresh_token) {
        context.addIssue({
          code: 'custom',
          path: ['accounts', index, 'tokens', 'refresh_token'],
          message: 'is required for an active account',
        })
      }
    }
  })

  if (config.defaultAccountId && !ids.has(config.defaultAccountId)) {
    context.addIssue({
      code: 'custom',
      path: ['defaultAccountId'],
      message: 'does not reference an existing account id',
    })
  }
})

const legacyAccountSchema = z.object({
  alias: z.string().min(1),
  tag: z.string().optional(),
  provider: z.enum(['gmail', 'outlook']),
  email: z.string().min(1),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  tokens: oauthTokensSchema.optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}).passthrough()

const legacyConfigSchema = z.object({
  default_account: z.string().nullable().optional().default(null),
  accounts: z.array(legacyAccountSchema),
}).passthrough()

type PersistedConfig = z.infer<typeof persistedConfigSchema>

export interface NewAccountConfig {
  id?: string
  status?: AccountStatus
  alias: string
  tag?: string
  provider: Provider
  email: string
  client_id: string
  client_secret?: string
  tokens: OAuthTokens
  scopes?: string[]
  created_at?: string
  updated_at?: string
}

export interface MigrationStatus {
  migrated: boolean
  backupPath: string
  backupExists: boolean
  pendingAliases: string[]
  canFinalize: boolean
}

export interface ReauthorizedAccountConfig {
  email: string
  client_id: string
  client_secret?: string
  tokens: OAuthTokens
  scopes?: string[]
}

/** Set a custom config file path (also updates its parent directory). */
export function setConfigPath(filePath: string): void {
  CONFIG_FILE = filePath
  CONFIG_DIR = dirname(filePath)
}

export function getConfigPath(): string {
  return CONFIG_FILE
}

export function resetConfigPath(): void {
  CONFIG_DIR = DEFAULT_CONFIG_DIR
  CONFIG_FILE = DEFAULT_CONFIG_FILE
}

function backupPath(): string {
  return `${CONFIG_FILE}.v1.bak`
}

function lastGoodPath(): string {
  return `${CONFIG_FILE}.last-good`
}

function lockPath(): string {
  return `${CONFIG_FILE}.lock`
}

function ensureConfigDir(): void {
  let createdByUs = false
  if (!existsSync(CONFIG_DIR)) {
    // With recursive=true Node returns undefined if another process won the
    // creation race, so we do not take ownership of its directory mode.
    createdByUs = mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 }) !== undefined
  }

  // A custom --config may live in a shared/project directory whose mode is
  // owned by the user. Only directories created by us and our dedicated
  // default directory may be tightened.
  if (createdByUs || CONFIG_DIR === DEFAULT_CONFIG_DIR) {
    try {
      chmodSync(CONFIG_DIR, 0o700)
    } catch {
      // Some filesystems (notably Windows) do not implement POSIX permissions.
    }
  }
}

function secureSensitiveFile(path: string): void {
  if (!existsSync(path)) return
  let stats
  try {
    stats = lstatSync(path)
  } catch (error) {
    throw new ConfigError(`Unable to inspect sensitive config file ${path}: ${String(error)}`)
  }
  if (!stats.isFile()) {
    throw new ConfigError(`Sensitive config path must be a regular file: ${path}`)
  }
  try {
    chmodSync(path, 0o600)
  } catch (error) {
    if (process.platform !== 'win32') {
      throw new ConfigError(`Unable to secure config file ${path}: ${String(error)}`)
    }
  }
}

function secureKnownConfigFiles(): void {
  secureSensitiveFile(CONFIG_FILE)
  secureSensitiveFile(backupPath())
  secureSensitiveFile(lastGoodPath())
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function lockOwnerIsGone(path: string): boolean {
  try {
    const owner = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8')) as { pid?: unknown }
    if (!Number.isSafeInteger(owner.pid) || (owner.pid as number) <= 0) return false
    try {
      process.kill(owner.pid as number, 0)
      return false
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return code === 'ESRCH' || code === 'EINVAL'
    }
  } catch {
    return false
  }
}

function acquireConfigLock(): () => void {
  ensureConfigDir()
  const path = lockPath()
  const startedAt = Date.now()

  while (true) {
    try {
      mkdirSync(path, { mode: 0o700 })
      const nonce = randomUUID()
      try {
        writeFileSync(
          join(path, 'owner.json'),
          JSON.stringify({ pid: process.pid, nonce, createdAt: new Date().toISOString() }),
          { encoding: 'utf8', mode: 0o600, flag: 'wx' },
        )
      } catch (error) {
        rmSync(path, { recursive: true, force: true })
        throw error
      }

      let released = false
      return () => {
        if (released) return
        released = true
        try {
          const owner = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8')) as {
            nonce?: unknown
          }
          // Never let a delayed release remove a lock acquired by a newer
          // process after stale-lock recovery.
          if (owner.nonce === nonce) rmSync(path, { recursive: true, force: true })
        } catch {
          // A missing/replaced owner file means this process no longer owns it.
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error

      try {
        if (lockOwnerIsGone(path)
          || Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) {
          rmSync(path, { recursive: true, force: true })
          continue
        }
      } catch {
        continue
      }

      if (Date.now() - startedAt >= LOCK_WAIT_MS) {
        throw new ConfigError(`CONFIG_LOCK_TIMEOUT: waited 5 seconds for ${path}`)
      }
      sleepSync(25)
    }
  }
}

function withConfigLock<T>(operation: () => T): T {
  const release = acquireConfigLock()
  try {
    return operation()
  } finally {
    release()
  }
}

function fsyncDirectory(): void {
  let descriptor: number | undefined
  try {
    descriptor = openSync(CONFIG_DIR, 'r')
    fsyncSync(descriptor)
  } catch {
    // Directory fsync is not available on every supported platform/filesystem.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function writeAtomic(path: string, contents: string): void {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  )
  let descriptor: number | undefined

  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600)
    writeFileSync(descriptor, contents, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporaryPath, path)
    try {
      chmodSync(path, 0o600)
    } catch {
      // See ensureConfigDir permission note.
    }
    fsyncDirectory()
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

function describeValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '<root>'}: ${issue.message}`)
    .join('; ')
}

function parseJson(raw: string, source = CONFIG_FILE): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    const reason = errorMessage(error)
    throw new ConfigError(`Invalid JSON in config file ${source}: ${reason}`)
  }
}

function parsePersisted(value: unknown): PersistedConfig {
  const parsed = persistedConfigSchema.safeParse(value)
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid config schema in ${CONFIG_FILE}: ${describeValidationError(parsed.error)}`,
    )
  }
  return parsed.data
}

function hydrate(config: PersistedConfig): AppConfig {
  return {
    version: CONFIG_VERSION,
    defaultAccountId: config.defaultAccountId,
    accounts: config.accounts.map((account) => ({
      ...account,
      tokens: { ...account.tokens },
      scopes: [...account.scopes],
    })),
  }
}

function dehydrate(config: AppConfig): PersistedConfig {
  const defaultAccountId = config.defaultAccountId
    && config.accounts.some((account) => account.id === config.defaultAccountId)
    ? config.defaultAccountId
    : null

  return parsePersisted({
    version: CONFIG_VERSION,
    defaultAccountId,
    accounts: config.accounts.map(({ id, status, ...account }) => ({
      ...account,
      id,
      status,
    })),
  })
}

function emptyTokens(): OAuthTokens {
  return {
    access_token: '',
    refresh_token: '',
    expires_at: 0,
    token_type: 'Bearer',
  }
}

function migrateLegacyConfigUnlocked(
  value: unknown,
  legacyAlreadyBackedUp = false,
): AppConfig {
  const parsed = legacyConfigSchema.safeParse(value)
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid legacy config schema in ${CONFIG_FILE}: ${describeValidationError(parsed.error)}`,
    )
  }

  if (!legacyAlreadyBackedUp && existsSync(backupPath())) {
    throw new ConfigError(
      `Cannot migrate config because backup already exists: ${backupPath()}`,
    )
  }

  const now = new Date().toISOString()
  const migratedAccounts: AccountConfig[] = parsed.data.accounts.map((account) => ({
    id: randomUUID(),
    status: 'needs_reauth',
    alias: account.alias,
    ...(account.tag ? { tag: account.tag } : {}),
    provider: account.provider,
    email: account.email,
    client_id: '',
    tokens: emptyTokens(),
    scopes: [],
    created_at: account.created_at ?? now,
    updated_at: now,
  }))
  const legacyDefault = parsed.data.default_account
  const defaultAccountId = legacyDefault
    ? migratedAccounts.find((account) => account.alias === legacyDefault)?.id ?? null
    : null
  const migrated = hydrate(parsePersisted({
    version: CONFIG_VERSION,
    defaultAccountId,
    accounts: migratedAccounts,
  }))

  if (!legacyAlreadyBackedUp) {
    try {
      // Remove broad permissions before the secret-bearing file is exposed at
      // its backup name.
      chmodSync(CONFIG_FILE, 0o600)
    } catch {
      // See ensureConfigDir permission note.
    }
    renameSync(CONFIG_FILE, backupPath())
    try {
      chmodSync(backupPath(), 0o600)
    } catch {
      // See ensureConfigDir permission note.
    }
    fsyncDirectory()
  }

  try {
    saveConfigUnlocked(migrated)
  } catch (error) {
    if (!existsSync(CONFIG_FILE) && existsSync(backupPath())) {
      renameSync(backupPath(), CONFIG_FILE)
    }
    throw error
  }

  return migrated
}

function saveConfigUnlocked(
  config: AppConfig,
  options: { synchronizeLastGood?: boolean } = {},
): void {
  ensureConfigDir()
  secureKnownConfigFiles()
  const persisted = dehydrate(config)
  const serialized = `${JSON.stringify(persisted, null, 2)}\n`

  if (options.synchronizeLastGood) {
    // Credential deletion/rotation must reach the recovery copy before the
    // primary replacement. If the primary write then fails, its previous
    // valid state remains authoritative and the operation reports failure.
    writeAtomic(lastGoodPath(), serialized)
    writeAtomic(CONFIG_FILE, serialized)
    return
  }

  if (existsSync(CONFIG_FILE)) {
    try {
      const currentRaw = readFileSync(CONFIG_FILE, 'utf8')
      const currentValue = parseJson(currentRaw)
      if (typeof currentValue === 'object' && currentValue !== null && 'version' in currentValue) {
        parsePersisted(currentValue)
        writeAtomic(lastGoodPath(), currentRaw)
      }
    } catch {
      // Never replace a known-good backup with malformed external content.
    }
  }

  writeAtomic(CONFIG_FILE, serialized)
  if (!existsSync(lastGoodPath())) writeAtomic(lastGoodPath(), serialized)
}

function loadConfigUnlocked(): AppConfig {
  ensureConfigDir()
  secureKnownConfigFiles()
  if (!existsSync(CONFIG_FILE)) {
    // Recover an interrupted v1 migration: the first durable step moves the
    // original aside, so it remains the source of truth until v2 is written.
    if (existsSync(backupPath())) {
      const legacy = parseJson(readFileSync(backupPath(), 'utf8'), backupPath())
      return migrateLegacyConfigUnlocked(legacy, true)
    }
    const config = createDefaultConfig()
    saveConfigUnlocked(config)
    return config
  }

  const raw = readFileSync(CONFIG_FILE, 'utf8')
  const value = parseJson(raw)
  if (typeof value === 'object' && value !== null && 'version' in value) {
    return hydrate(parsePersisted(value))
  }

  return migrateLegacyConfigUnlocked(value)
}

export function loadConfig(): AppConfig {
  // Fast-path validated v2 reads without taking a write lock.
  ensureConfigDir()
  secureKnownConfigFiles()
  if (existsSync(CONFIG_FILE)) {
    const value = parseJson(readFileSync(CONFIG_FILE, 'utf8'))
    if (typeof value === 'object' && value !== null && 'version' in value) {
      return hydrate(parsePersisted(value))
    }
  }
  return withConfigLock(loadConfigUnlocked)
}

export function saveConfig(config: AppConfig): void {
  withConfigLock(() => saveConfigUnlocked(config))
}

function mutateConfig(
  operation: (config: AppConfig) => void,
  options: { synchronizeLastGood?: boolean } = {},
): AppConfig {
  return withConfigLock(() => {
    const config = loadConfigUnlocked()
    operation(config)
    saveConfigUnlocked(config, options)
    return config
  })
}

export function getAccount(alias?: string): AccountConfig {
  const config = loadConfig()

  if (alias) {
    const account = config.accounts.find((candidate) => candidate.alias === alias)
    if (!account) throw new ConfigError(`Account not found: ${alias}`)
    return account
  }

  if (!config.defaultAccountId) {
    throw new ConfigError('No default account set. Run: cli-mail account add <provider>')
  }

  const account = config.accounts.find(
    (candidate) => candidate.id === config.defaultAccountId,
  )
  if (!account) {
    throw new ConfigError(
      `Default account id "${config.defaultAccountId}" not found. Run: cli-mail account list`,
    )
  }
  return account
}

/** Resolve an account and enforce the v2 reauthentication state. */
export function getActiveAccount(alias?: string): AccountConfig {
  const account = getAccount(alias)
  if (account.status !== 'active') {
    throw new AccountReauthRequiredError(account.alias)
  }
  return account
}

export function createAccount(input: NewAccountConfig): AccountConfig {
  let created!: AccountConfig
  mutateConfig((config) => {
    if (config.accounts.some((account) => account.alias === input.alias)) {
      throw new ConfigError(`Account alias already exists: ${input.alias}`)
    }
    const id = input.id ?? randomUUID()
    if (config.accounts.some((account) => account.id === id)) {
      throw new ConfigError(`Account id already exists: ${id}`)
    }
    const now = new Date().toISOString()
    const account: AccountConfig = {
      ...input,
      id,
      status: 'active',
      created_at: input.created_at ?? now,
      updated_at: now,
      tokens: { ...input.tokens },
      scopes: input.scopes
        ?? (input.tokens.scope ?? '').split(/\s+/).filter(Boolean),
    }
    if (account.provider === 'outlook') delete account.client_secret
    config.accounts.push(account)
    created = account

    if (!config.defaultAccountId) config.defaultAccountId = account.id
  })
  return { ...created, tokens: { ...created.tokens }, scopes: [...created.scopes] }
}

/**
 * Replace OAuth material for an existing stable account identity. Alias, tag,
 * provider, creation time and default-account references are preserved.
 */
export function reauthorizeAccount(
  id: string,
  input: ReauthorizedAccountConfig,
): AccountConfig {
  let reauthorized!: AccountConfig
  mutateConfig((config) => {
    const index = config.accounts.findIndex((account) => account.id === id)
    if (index < 0) throw new ConfigError(`Account id not found: ${id}`)
    const current = config.accounts[index]
    if (current.email.trim().toLowerCase() !== input.email.trim().toLowerCase()) {
      throw new ConfigError(
        `Authenticated identity ${input.email} does not match account ${current.email}`,
      )
    }

    const updated: AccountConfig = {
      ...current,
      status: 'active',
      email: input.email,
      client_id: input.client_id,
      ...(input.client_secret ? { client_secret: input.client_secret } : {}),
      tokens: { ...input.tokens },
      scopes: input.scopes
        ?? (input.tokens.scope ?? '').split(/\s+/).filter(Boolean),
      updated_at: new Date().toISOString(),
    }
    if (!input.client_secret) delete updated.client_secret
    if (updated.provider === 'outlook') delete updated.client_secret
    config.accounts[index] = updated
    reauthorized = updated
  }, { synchronizeLastGood: true })
  return {
    ...reauthorized,
    tokens: { ...reauthorized.tokens },
    scopes: [...reauthorized.scopes],
  }
}

export function removeAccount(alias: string): void {
  mutateConfig((config) => {
    const index = config.accounts.findIndex((account) => account.alias === alias)
    if (index < 0) throw new ConfigError(`Account not found: ${alias}`)

    const [removed] = config.accounts.splice(index, 1)
    if (config.defaultAccountId === removed.id) {
      config.defaultAccountId = config.accounts[0]?.id ?? null
    }
  }, { synchronizeLastGood: true })
}

export function setDefaultAccount(alias: string): void {
  mutateConfig((config) => {
    const account = config.accounts.find((candidate) => candidate.alias === alias)
    if (!account) throw new ConfigError(`Account not found: ${alias}`)
    config.defaultAccountId = account.id
  })
}

export function renameAccount(oldAlias: string, newAlias: string): void {
  mutateConfig((config) => {
    const account = config.accounts.find((candidate) => candidate.alias === oldAlias)
    if (!account) throw new ConfigError(`Account not found: ${oldAlias}`)
    if (config.accounts.some((candidate) => candidate.alias === newAlias)) {
      throw new ConfigError(`Alias already in use: ${newAlias}`)
    }

    account.alias = newAlias
    account.updated_at = new Date().toISOString()
  })
}

/** Atomically merges a token refresh into the latest config revision. */
export function updateAccountTokens(alias: string, tokens: OAuthTokens): void {
  mutateConfig((config) => {
    const account = config.accounts.find((candidate) => candidate.alias === alias)
    if (!account) throw new ConfigError(`Account not found: ${alias}`)
    account.tokens = { ...tokens }
    if (tokens.scope) account.scopes = tokens.scope.split(/\s+/).filter(Boolean)
    account.status = 'active'
    account.updated_at = new Date().toISOString()
  }, { synchronizeLastGood: true })
}

export function getMigrationStatus(): MigrationStatus {
  const config = loadConfig()
  const backupExists = existsSync(backupPath())
  const pendingAliases = config.accounts
    .filter((account) => account.status === 'needs_reauth')
    .map((account) => account.alias)
  return {
    migrated: backupExists,
    backupPath: backupPath(),
    backupExists,
    pendingAliases,
    canFinalize: backupExists && pendingAliases.length === 0,
  }
}

/** CLI must require its own explicit `--yes` before calling this function. */
export function finalizeMigration(): void {
  withConfigLock(() => {
    const config = loadConfigUnlocked()
    const pending = config.accounts.filter((account) => account.status !== 'active')
    if (pending.length > 0) {
      throw new ConfigError(
        `Cannot finalize migration; reauthenticate: ${pending.map((account) => account.alias).join(', ')}`,
      )
    }
    rmSync(backupPath(), { force: true })
    fsyncDirectory()
  })
}

// ==================== Tag Management ====================

const TAG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,31}$/

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

export function setAccountTag(alias: string, tag: string | null): void {
  mutateConfig((config) => {
    const account = config.accounts.find((candidate) => candidate.alias === alias)
    if (!account) throw new ConfigError(`Account not found: ${alias}`)

    if (tag !== null) {
      validateTag(tag)
      account.tag = tag
    } else {
      delete account.tag
    }
    account.updated_at = new Date().toISOString()
  })
}

export function getAccountsByTag(tag: string, config: AppConfig = loadConfig()): AccountConfig[] {
  if (tag === 'default') return config.accounts.filter((account) => !account.tag)
  return config.accounts.filter((account) => account.tag === tag)
}

export function listTags(): Array<{ tag: string; count: number }> {
  const config = loadConfig()
  const tagMap = new Map<string, number>()

  for (const account of config.accounts) {
    const tag = account.tag || 'default'
    tagMap.set(tag, (tagMap.get(tag) || 0) + 1)
  }

  const entries = Array.from(tagMap.entries())
  entries.sort((left, right) => {
    if (left[0] === 'default') return -1
    if (right[0] === 'default') return 1
    return left[0].localeCompare(right[0])
  })
  return entries.map(([tag, count]) => ({ tag, count }))
}

export { CONFIG_DIR, CONFIG_FILE }
