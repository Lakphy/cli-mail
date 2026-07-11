import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createAccount,
  finalizeMigration,
  getActiveAccount,
  getConfigPath,
  getMigrationStatus,
  loadConfig,
  reauthorizeAccount,
  removeAccount,
  saveConfig,
  setConfigPath,
  updateAccountTokens,
} from '../../src/config/store'
import { createDefaultConfig, DEFAULT_CONFIG, GMAIL_AUTH } from '../../src/config/types'
import { ConfigError } from '../../src/utils/error'

const testDirectory = join(import.meta.dirname, '..', '.test-config-v2-store')
const testFile = join(testDirectory, 'accounts.json')
let previousPath: string

function legacyConfig() {
  return {
    default_account: 'personal',
    accounts: [{
      alias: 'personal',
      tag: 'home',
      provider: 'gmail',
      email: 'person@example.com',
      client_id: 'legacy-client',
      client_secret: 'legacy-secret',
      tokens: {
        access_token: 'legacy-access',
        refresh_token: 'legacy-refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
      },
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    }],
  }
}

beforeEach(() => {
  previousPath = getConfigPath()
  rmSync(testDirectory, { recursive: true, force: true })
  mkdirSync(testDirectory, { recursive: true })
  setConfigPath(testFile)
})

afterEach(() => {
  setConfigPath(previousPath)
  rmSync(testDirectory, { recursive: true, force: true })
})

describe('config v2 migration', () => {
  test('moves v1 aside and migrates only non-secret identity metadata', () => {
    writeFileSync(testFile, JSON.stringify(legacyConfig()))
    chmodSync(testFile, 0o644)

    const config = loadConfig()
    expect(config.version).toBe(2)
    expect(config.defaultAccountId).toBe(config.accounts[0].id)
    expect(config.accounts[0]).toMatchObject({
      status: 'needs_reauth',
      alias: 'personal',
      tag: 'home',
      client_id: '',
      scopes: [],
    })
    expect(config.accounts[0].tokens.access_token).toBe('')
    expect(config.accounts[0].id).toMatch(/^[0-9a-f-]{36}$/)

    const backup = `${testFile}.v1.bak`
    expect(existsSync(backup)).toBe(true)
    if (process.platform !== 'win32') {
      expect(statSync(backup).mode & 0o777).toBe(0o600)
    }
    expect(readFileSync(backup, 'utf8')).toContain('legacy-secret')

    const persisted = JSON.parse(readFileSync(testFile, 'utf8')) as Record<string, unknown>
    expect(persisted.defaultAccountId).toBe(config.defaultAccountId)
    expect(persisted).not.toHaveProperty('default_account')
    expect(readFileSync(testFile, 'utf8')).not.toContain('legacy-secret')
  })

  test('requires all migrated accounts to reauthenticate before finalizing', () => {
    writeFileSync(testFile, JSON.stringify(legacyConfig()))
    const migrated = loadConfig()
    expect(getMigrationStatus()).toMatchObject({
      migrated: true,
      pendingAliases: ['personal'],
      canFinalize: false,
    })
    expect(() => finalizeMigration()).toThrow(ConfigError)

    reauthorizeAccount(migrated.accounts[0].id, {
      email: 'person@example.com',
      client_id: 'new-client',
      client_secret: 'desktop-value',
      tokens: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
        scope: GMAIL_AUTH.scopes.join(' '),
      },
    })
    const active = loadConfig().accounts[0]
    expect(active.id).toBe(migrated.accounts[0].id)
    expect(active.created_at).toBe(migrated.accounts[0].created_at)
    expect(active.tag).toBe('home')
    expect(active.status).toBe('active')

    expect(getMigrationStatus().canFinalize).toBe(true)
    finalizeMigration()
    expect(existsSync(`${testFile}.v1.bak`)).toBe(false)
  })

  test('recovers when a process stopped after moving the v1 backup', () => {
    writeFileSync(`${testFile}.v1.bak`, JSON.stringify(legacyConfig()), { mode: 0o600 })
    const recovered = loadConfig()
    expect(recovered.accounts).toHaveLength(1)
    expect(recovered.accounts[0]).toMatchObject({
      alias: 'personal',
      status: 'needs_reauth',
    })
    expect(existsSync(testFile)).toBe(true)
    expect(existsSync(`${testFile}.v1.bak`)).toBe(true)
  })
})

describe('validated atomic storage', () => {
  test('creates isolated defaults, mode 0600 and a last-good copy', () => {
    const first = loadConfig()
    first.accounts.push({} as never)
    const second = createDefaultConfig()
    expect(second.accounts).toEqual([])
    expect(DEFAULT_CONFIG.accounts).toEqual([])
    if (process.platform !== 'win32') {
      expect(statSync(testFile).mode & 0o777).toBe(0o600)
    }
    expect(existsSync(`${testFile}.last-good`)).toBe(true)
  })

  test('reports the exact schema path and never overwrites malformed config', () => {
    const malformed = JSON.stringify({
      version: 2,
      defaultAccountId: null,
      accounts: [{ id: 'not-a-uuid' }],
    })
    writeFileSync(testFile, malformed)
    expect(() => loadConfig()).toThrow('accounts.0')
    expect(readFileSync(testFile, 'utf8')).toBe(malformed)
  })

  test('save persists only v2 default-account state', () => {
    const config = loadConfig()
    saveConfig(config)
    expect(JSON.parse(readFileSync(testFile, 'utf8'))).not.toHaveProperty('default_account')
  })

  test('token updates preserve the latest account metadata', () => {
    createAccount({
      alias: 'work',
      tag: 'team',
      provider: 'outlook',
      email: 'work@example.com',
      client_id: 'public-client',
      client_secret: 'must-not-be-stored',
      tokens: {
        access_token: 'old',
        refresh_token: 'refresh',
        expires_at: 1,
        token_type: 'Bearer',
      },
    })
    updateAccountTokens('work', {
      access_token: 'new',
      refresh_token: 'refresh',
      expires_at: Date.now() + 3600_000,
      token_type: 'Bearer',
    })
    expect(loadConfig().accounts[0]).toMatchObject({
      status: 'active',
      tag: 'team',
      client_id: 'public-client',
      tokens: { access_token: 'new' },
    })
    expect(loadConfig().accounts[0].client_secret).toBeUndefined()
    expect(readFileSync(testFile, 'utf8')).not.toContain('must-not-be-stored')
  })

  test('recovers a directory lock left by a dead process', () => {
    const lock = `${testFile}.lock`
    mkdirSync(lock, { mode: 0o700 })
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 2_147_483_647 }))
    expect(loadConfig().version).toBe(2)
    expect(existsSync(lock)).toBe(false)
  })

  test('does not chmod an existing custom config parent directory', () => {
    if (process.platform === 'win32') return
    chmodSync(testDirectory, 0o755)
    loadConfig()
    expect(statSync(testDirectory).mode & 0o777).toBe(0o755)
  })

  test('uses mode 0700 for a custom config directory it creates', () => {
    const privateDirectory = join(testDirectory, 'new-private-directory')
    setConfigPath(join(privateDirectory, 'accounts.json'))
    loadConfig()
    if (process.platform !== 'win32') {
      expect(statSync(privateDirectory).mode & 0o777).toBe(0o700)
    }
  })

  test('tightens existing config, backup and last-good files without changing the parent', () => {
    loadConfig()
    writeFileSync(`${testFile}.v1.bak`, JSON.stringify(legacyConfig()))
    chmodSync(testFile, 0o644)
    chmodSync(`${testFile}.last-good`, 0o644)
    chmodSync(`${testFile}.v1.bak`, 0o644)
    if (process.platform !== 'win32') chmodSync(testDirectory, 0o755)

    loadConfig()
    if (process.platform !== 'win32') {
      expect(statSync(testFile).mode & 0o777).toBe(0o600)
      expect(statSync(`${testFile}.last-good`).mode & 0o777).toBe(0o600)
      expect(statSync(`${testFile}.v1.bak`).mode & 0o777).toBe(0o600)
      expect(statSync(testDirectory).mode & 0o777).toBe(0o755)
    }
  })

  test('createAccount atomically rejects alias and id conflicts', () => {
    const first = createAccount({
      id: '37d65ed6-69f3-4b69-87dd-7d9a86924570',
      alias: 'first',
      provider: 'gmail',
      email: 'first@example.com',
      client_id: 'client',
      tokens: {
        access_token: 'first-access',
        refresh_token: 'first-refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
      },
    })

    expect(() => createAccount({
      alias: first.alias,
      provider: 'gmail',
      email: 'other@example.com',
      client_id: 'other-client',
      tokens: {
        access_token: 'other-access',
        refresh_token: 'other-refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
      },
    })).toThrow('alias already exists')
    expect(() => createAccount({
      id: first.id,
      alias: 'other',
      provider: 'gmail',
      email: 'other@example.com',
      client_id: 'other-client',
      tokens: {
        access_token: 'other-access',
        refresh_token: 'other-refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
      },
    })).toThrow('id already exists')

    const persisted = loadConfig()
    expect(persisted.accounts).toHaveLength(1)
    expect(persisted.accounts[0].tokens.access_token).toBe('first-access')
  })

  test('reauthorization replaces credentials by stable id and preserves identity metadata', () => {
    const created = createAccount({
      alias: 'stable',
      tag: 'team',
      provider: 'gmail',
      email: 'stable@example.com',
      client_id: 'old-client',
      client_secret: 'old-secret',
      tokens: {
        access_token: 'old-access',
        refresh_token: 'old-refresh',
        expires_at: 1,
        token_type: 'Bearer',
      },
    })
    const updated = reauthorizeAccount(created.id, {
      email: 'STABLE@example.com',
      client_id: 'new-client',
      client_secret: 'new-secret',
      tokens: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
        scope: GMAIL_AUTH.scopes.join(' '),
      },
    })

    expect(updated).toMatchObject({
      id: created.id,
      alias: 'stable',
      tag: 'team',
      provider: 'gmail',
      created_at: created.created_at,
      client_id: 'new-client',
      client_secret: 'new-secret',
      tokens: { access_token: 'new-access' },
    })
    expect(loadConfig().defaultAccountId).toBe(created.id)
    const recovery = readFileSync(`${testFile}.last-good`, 'utf8')
    expect(recovery).not.toContain('old-access')
    expect(recovery).not.toContain('old-refresh')
    expect(recovery).not.toContain('old-secret')
  })

  test('reports a structured reauthentication error for an inactive account', () => {
    const created = createAccount({
      alias: 'reauth-me',
      provider: 'gmail',
      email: 'reauth@example.com',
      client_id: 'client',
      tokens: {
        access_token: 'access',
        refresh_token: 'refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
      },
    })
    const config = loadConfig()
    config.accounts[0].status = 'needs_reauth'
    saveConfig(config)

    expect(() => getActiveAccount(created.alias)).toThrow(expect.objectContaining({
      code: 'ACCOUNT_REAUTH_REQUIRED',
      details: { alias: created.alias },
    }))
  })

  test('account removal also purges its credentials from last-good', () => {
    const removed = createAccount({
      alias: 'remove-me',
      provider: 'gmail',
      email: 'remove@example.com',
      client_id: 'client',
      client_secret: 'removed-secret',
      tokens: {
        access_token: 'removed-access',
        refresh_token: 'removed-refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
      },
    })
    removeAccount('remove-me')

    const primary = readFileSync(testFile, 'utf8')
    const recovery = readFileSync(`${testFile}.last-good`, 'utf8')
    for (const value of ['remove@example.com', 'removed-secret', 'removed-access', 'removed-refresh']) {
      expect(primary).not.toContain(value)
      expect(recovery).not.toContain(value)
    }
    expect(() => reauthorizeAccount(removed.id, {
      email: removed.email,
      client_id: 'new-client',
      tokens: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
      },
    })).toThrow('Account id not found')
    expect(loadConfig().accounts).toHaveLength(0)
  })
})
