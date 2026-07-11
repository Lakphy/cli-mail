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
  readdirSync,
  renameSync,
  rmSync,
  writeSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { z } from 'zod'
import type {
  AccountConfig,
  AccountStatus,
  AccountTokenIdentity,
  AppConfig,
  OAuthTokens,
  Provider,
} from './types.js'
import { CONFIG_VERSION, createDefaultConfig } from './types.js'
import { AccountReauthRequiredError, ConfigError, errorMessage } from '../utils/error.js'

const DEFAULT_CONFIG_DIR = join(homedir(), '.cli-mail')
const DEFAULT_CONFIG_FILE = join(DEFAULT_CONFIG_DIR, 'accounts.json')
const LOCK_WAIT_MS = 5_000
const LOCK_STALE_MS = 60_000
const LOCK_QUEUE_RECORD = /Q:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\n/gi

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

function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ESRCH' || code === 'EINVAL'
  }
}

function ensureRegularLockFile(path: string): void {
  const stats = lstatSync(path)
  if (!stats.isFile()) throw new ConfigError(`Config lock entry must be a regular file: ${path}`)
  try {
    chmodSync(path, 0o600)
  } catch (error) {
    if (process.platform !== 'win32') {
      throw new ConfigError(`Unable to secure config lock entry ${path}: ${String(error)}`)
    }
  }
}

function ensureLockDirectory(path: string): void {
  const stats = lstatSync(path)
  if (!stats.isDirectory()) throw new ConfigError(`Config lock path must be a directory: ${path}`)
  try {
    chmodSync(path, 0o700)
  } catch (error) {
    if (process.platform !== 'win32') {
      throw new ConfigError(`Unable to secure config lock directory ${path}: ${String(error)}`)
    }
  }
}

function initializeQueueLock(path: string): void {
  const claimsPath = join(path, 'claims')
  try {
    mkdirSync(claimsPath, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  ensureLockDirectory(path)
  ensureLockDirectory(claimsPath)

  const queuePath = join(path, 'queue')
  let descriptor: number | undefined
  try {
    descriptor = openSync(queuePath, 'ax', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  ensureRegularLockFile(queuePath)
}

/**
 * Initialize the append-only queue layout. The short grace period avoids
 * mistaking an older client between mkdir and owner.json for an abandoned
 * directory. Legacy locks are only reclaimed when their recorded PID is gone.
 */
function prepareQueueLock(path: string): boolean {
  let created = false
  try {
    mkdirSync(path, { mode: 0o700 })
    created = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }

  const stats = lstatSync(path)
  if (!stats.isDirectory()) throw new ConfigError(`Config lock is not a directory: ${path}`)
  if (created || existsSync(join(path, 'claims'))) {
    initializeQueueLock(path)
    return true
  }

  const legacyOwnerPath = join(path, 'owner.json')
  if (existsSync(legacyOwnerPath)) {
    let pid: number | undefined
    try {
      const owner = JSON.parse(readFileSync(legacyOwnerPath, 'utf8')) as { pid?: unknown }
      if (Number.isSafeInteger(owner.pid) && (owner.pid as number) > 0) pid = owner.pid as number
    } catch {
      // An invalid legacy owner cannot be reclaimed without risking a live
      // old client; fail closed until the user removes it.
    }
    if (pid === undefined || !processIsGone(pid)) return false
    rmSync(legacyOwnerPath, { force: true })
    initializeQueueLock(path)
    return true
  }

  // An older client can be descheduled after mkdir but before owner.json.
  // Fail closed for the full stale interval rather than introducing a short
  // window in which a live legacy creator could be bypassed.
  if (Date.now() - stats.mtimeMs < LOCK_STALE_MS) return false
  initializeQueueLock(path)
  return true
}

function appendLockQueue(path: string, nonce: string): void {
  const queuePath = join(path, 'queue')
  let descriptor: number | undefined
  try {
    descriptor = openSync(queuePath, 'a', 0o600)
    // A complete record is emitted by one small write on an O_APPEND fd.
    // This gives contenders a single filesystem order; the `Q:` framing lets
    // readers resynchronize after unrelated malformed or partial bytes.
    const record = Buffer.from(`Q:${nonce}\n`, 'utf8')
    const written = writeSync(descriptor, record, 0, record.length)
    if (written !== record.length) throw new ConfigError('Unable to append complete lock record')
    fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function queuedLockNonces(path: string): string[] {
  const raw = readFileSync(join(path, 'queue'), 'utf8')
  const result: string[] = []
  const seen = new Set<string>()
  for (const match of raw.matchAll(LOCK_QUEUE_RECORD)) {
    const nonce = match[1].toLowerCase()
    if (!seen.has(nonce)) {
      seen.add(nonce)
      result.push(nonce)
    }
  }
  return result
}

function claimIsActive(path: string, nonce: string): boolean {
  const claimPath = join(path, 'claims', `${nonce}.json`)
  let stats
  try {
    stats = lstatSync(claimPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  if (!stats.isFile()) {
    throw new ConfigError(`Config lock claim must be a regular file: ${claimPath}`)
  }

  let pid: number | undefined
  try {
    const claim = JSON.parse(readFileSync(claimPath, 'utf8')) as {
      nonce?: unknown
      pid?: unknown
    }
    if (claim.nonce === nonce
      && Number.isSafeInteger(claim.pid)
      && (claim.pid as number) > 0) pid = claim.pid as number
  } catch {
    // A fresh partial claim may still be in the process of being published.
  }

  if (pid !== undefined) {
    if (!processIsGone(pid)) return true
  } else if (Date.now() - stats.mtimeMs <= LOCK_STALE_MS) {
    return true
  }

  // Claim names contain an unguessable nonce and are never reused, so two
  // reclaimers deleting this exact stale path cannot affect a newer owner.
  rmSync(claimPath, { force: true })
  return false
}

function firstActiveLockClaim(path: string): string | undefined {
  const existingClaims = new Set(
    readdirSync(join(path, 'claims'))
      .map((name) => /^([0-9a-f-]{36})\.json$/i.exec(name)?.[1].toLowerCase())
      .filter((nonce): nonce is string => nonce !== undefined),
  )
  for (const nonce of queuedLockNonces(path)) {
    // The queue is intentionally append-only, but released claims are absent
    // from this small directory snapshot. Avoid one lstat per historical
    // queue entry as the CLI accumulates operations.
    if (!existingClaims.has(nonce)) continue
    if (claimIsActive(path, nonce)) return nonce
  }
  return undefined
}

function acquireConfigLock(): () => void {
  ensureConfigDir()
  const path = lockPath()
  const startedAt = Date.now()

  while (!prepareQueueLock(path)) {
    if (Date.now() - startedAt >= LOCK_WAIT_MS) {
      throw new ConfigError(`CONFIG_LOCK_TIMEOUT: waited 5 seconds for ${path}`)
    }
    sleepSync(25)
  }

  const nonce = randomUUID()
  const claimPath = join(path, 'claims', `${nonce}.json`)
  writeFileSync(
    claimPath,
    JSON.stringify({ pid: process.pid, nonce, createdAt: new Date().toISOString() }),
    { encoding: 'utf8', mode: 0o600, flag: 'wx' },
  )
  try {
    appendLockQueue(path, nonce)
  } catch (error) {
    rmSync(claimPath, { force: true })
    throw error
  }

  while (true) {
    try {
      if (firstActiveLockClaim(path) !== nonce) throw new Error('LOCK_BUSY')
      let released = false
      return () => {
        if (released) return
        released = true
        rmSync(claimPath, { force: true })
      }
    } catch {
      if (Date.now() - startedAt >= LOCK_WAIT_MS) {
        rmSync(claimPath, { force: true })
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

function parsePersisted(value: unknown, source = CONFIG_FILE): PersistedConfig {
  const parsed = persistedConfigSchema.safeParse(value)
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid config schema in ${source}: ${describeValidationError(parsed.error)}`,
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
  if (existsSync(lastGoodPath())) readLastGood()

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
  // An existing recovery copy is part of the persisted state contract. Never
  // silently replace a malformed copy, even when the primary is still valid.
  if (existsSync(lastGoodPath())) readLastGood()
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

  writeAtomic(CONFIG_FILE, serialized)
  // Keep recovery current after the primary replacement is durable. A crash
  // between these writes still leaves either the prior valid recovery copy or
  // the new valid primary; credential removal/rotation uses the stricter
  // synchronizeLastGood ordering above.
  writeAtomic(lastGoodPath(), serialized)
}

function readLastGood(): { raw: string; config: PersistedConfig } {
  const path = lastGoodPath()
  const raw = readFileSync(path, 'utf8')
  const value = parseJson(raw, path)
  return { raw, config: parsePersisted(value, path) }
}

function recoveryWarning(primaryWasCorrupt: boolean): void {
  const detail = primaryWasCorrupt
    ? ' The invalid primary file was preserved for inspection.'
    : ''
  process.stderr.write(`Warning: recovered cli-mail configuration from its last-good backup.${detail}\n`)
}

function recoverFromLastGoodUnlocked(primaryWasCorrupt: boolean): AppConfig {
  // Validate the recovery source before renaming or overwriting anything.
  const recovery = readLastGood()

  if (primaryWasCorrupt) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const corruptPath = `${CONFIG_FILE}.corrupt-${timestamp}-${randomUUID()}`
    try {
      chmodSync(CONFIG_FILE, 0o600)
    } catch {
      // See ensureConfigDir permission note.
    }
    renameSync(CONFIG_FILE, corruptPath)
    try {
      chmodSync(corruptPath, 0o600)
    } catch {
      // See ensureConfigDir permission note.
    }
    fsyncDirectory()
  }

  writeAtomic(CONFIG_FILE, recovery.raw)
  recoveryWarning(primaryWasCorrupt)
  return hydrate(recovery.config)
}

function validateLegacy(value: unknown): void {
  const parsed = legacyConfigSchema.safeParse(value)
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid legacy config schema in ${CONFIG_FILE}: ${describeValidationError(parsed.error)}`,
    )
  }
}

function loadConfigUnlocked(): AppConfig {
  ensureConfigDir()
  secureKnownConfigFiles()
  if (!existsSync(CONFIG_FILE)) {
    if (existsSync(lastGoodPath())) return recoverFromLastGoodUnlocked(false)

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

  let value: unknown
  try {
    value = parseJson(readFileSync(CONFIG_FILE, 'utf8'))
    if (typeof value === 'object' && value !== null && 'version' in value) {
      return hydrate(parsePersisted(value))
    }
    validateLegacy(value)
  } catch (error) {
    if (!(error instanceof ConfigError) || !existsSync(lastGoodPath())) throw error
    return recoverFromLastGoodUnlocked(true)
  }

  return migrateLegacyConfigUnlocked(value)
}

export function loadConfig(): AppConfig {
  // Fast-path validated v2 reads without taking a write lock.
  ensureConfigDir()
  secureKnownConfigFiles()
  if (existsSync(CONFIG_FILE)) {
    try {
      const value = parseJson(readFileSync(CONFIG_FILE, 'utf8'))
      if (typeof value === 'object' && value !== null && 'version' in value) {
        return hydrate(parsePersisted(value))
      }
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error
      // Recovery and its warning are serialized under the config lock.
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

/**
 * Atomically merge a token refresh into the latest config revision.  A
 * refresh is bound to the stable account and OAuth client that initiated it,
 * so deleting an account, reusing its alias, or reauthorizing it while a
 * refresh is in flight can never overwrite the replacement credentials.
 */
export function updateAccountTokens(
  identity: AccountTokenIdentity,
  tokens: OAuthTokens,
  expectedRefreshTokenBinding: string,
): void {
  mutateConfig((config) => {
    const account = config.accounts.find((candidate) => candidate.id === identity.id)
    if (!account) {
      throw new ConfigError(`Account no longer exists: ${identity.alias}`)
    }
    if (account.provider !== identity.provider || account.client_id !== identity.clientId) {
      throw new ConfigError(
        `Account authorization changed while refreshing tokens: ${account.alias}`,
      )
    }
    const currentRefreshTokenBinding = createHash('sha256')
      .update('cli-mail-refresh-token\0')
      .update(account.tokens.refresh_token)
      .digest('hex')
    if (currentRefreshTokenBinding !== expectedRefreshTokenBinding) {
      throw new ConfigError(
        `Account credentials changed while refreshing tokens: ${account.alias}`,
      )
    }
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
