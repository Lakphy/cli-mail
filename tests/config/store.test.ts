import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createAccount,
  finalizeMigration,
  getActiveAccount,
  getConfigPath,
  getMigrationStatus,
  loadConfig,
  reauthorizeAccount,
  renameAccount,
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

function refreshTokenBinding(refreshToken: string): string {
  return createHash('sha256')
    .update('cli-mail-refresh-token\0')
    .update(refreshToken)
    .digest('hex')
}

beforeEach(() => {
  previousPath = getConfigPath()
  rmSync(testDirectory, { recursive: true, force: true })
  mkdirSync(testDirectory, { recursive: true })
  setConfigPath(testFile)
})

afterEach(() => {
  vi.restoreAllMocks()
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

  test('does not move a legacy primary when an existing recovery copy is invalid', () => {
    const legacy = JSON.stringify(legacyConfig())
    const invalidRecovery = '{ invalid recovery'
    writeFileSync(testFile, legacy)
    writeFileSync(`${testFile}.last-good`, invalidRecovery)

    expect(() => loadConfig()).toThrow(`${testFile}.last-good`)
    expect(readFileSync(testFile, 'utf8')).toBe(legacy)
    expect(readFileSync(`${testFile}.last-good`, 'utf8')).toBe(invalidRecovery)
    expect(existsSync(`${testFile}.v1.bak`)).toBe(false)
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
    const account = loadConfig().accounts[0]
    updateAccountTokens({
      id: account.id,
      alias: account.alias,
      provider: account.provider,
      clientId: account.client_id,
    }, {
      access_token: 'new',
      refresh_token: 'refresh',
      expires_at: Date.now() + 3600_000,
      token_type: 'Bearer',
    }, refreshTokenBinding(account.tokens.refresh_token))
    expect(loadConfig().accounts[0]).toMatchObject({
      status: 'active',
      tag: 'team',
      client_id: 'public-client',
      tokens: { access_token: 'new' },
    })
    expect(loadConfig().accounts[0].client_secret).toBeUndefined()
    expect(readFileSync(testFile, 'utf8')).not.toContain('must-not-be-stored')
  })

  test('binds token updates to stable id and OAuth client while allowing alias renames', () => {
    const original = createAccount({
      alias: 'stable-refresh',
      provider: 'gmail',
      email: 'stable@example.com',
      client_id: 'client-one',
      tokens: {
        access_token: 'old-access',
        refresh_token: 'old-refresh',
        expires_at: 1,
        token_type: 'Bearer',
      },
    })
    const identity = {
      id: original.id,
      alias: original.alias,
      provider: original.provider,
      clientId: original.client_id,
    }

    renameAccount(original.alias, 'renamed-refresh')
    updateAccountTokens(identity, {
      access_token: 'renamed-access',
      refresh_token: 'renamed-refresh-token',
      expires_at: Date.now() + 3600_000,
      token_type: 'Bearer',
    }, refreshTokenBinding('old-refresh'))
    expect(loadConfig().accounts[0].tokens.access_token).toBe('renamed-access')

    reauthorizeAccount(original.id, {
      email: original.email,
      client_id: original.client_id,
      tokens: {
        access_token: 'same-client-replacement-access',
        refresh_token: 'same-client-replacement-refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
      },
    })
    expect(() => updateAccountTokens(identity, {
      access_token: 'same-client-stale-access',
      refresh_token: 'same-client-stale-refresh',
      expires_at: Date.now() + 3600_000,
      token_type: 'Bearer',
    }, refreshTokenBinding('renamed-refresh-token'))).toThrow('credentials changed')
    expect(loadConfig().accounts[0].tokens.access_token).toBe('same-client-replacement-access')

    reauthorizeAccount(original.id, {
      email: original.email,
      client_id: 'client-two',
      tokens: {
        access_token: 'replacement-access',
        refresh_token: 'replacement-refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
      },
    })
    expect(() => updateAccountTokens(identity, {
      access_token: 'stale-access',
      refresh_token: 'stale-refresh',
      expires_at: Date.now() + 3600_000,
      token_type: 'Bearer',
    }, refreshTokenBinding('renamed-refresh-token'))).toThrow('authorization changed')
    expect(loadConfig().accounts[0].tokens.access_token).toBe('replacement-access')

    removeAccount('renamed-refresh')
    const replacement = createAccount({
      alias: original.alias,
      provider: 'gmail',
      email: 'other@example.com',
      client_id: 'client-one',
      tokens: {
        access_token: 'other-access',
        refresh_token: 'other-refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
      },
    })
    expect(() => updateAccountTokens(identity, {
      access_token: 'cross-account-access',
      refresh_token: 'cross-account-refresh',
      expires_at: Date.now() + 3600_000,
      token_type: 'Bearer',
    }, refreshTokenBinding('old-refresh'))).toThrow('no longer exists')
    expect(loadConfig().accounts.find((account) => account.id === replacement.id)?.tokens.access_token)
      .toBe('other-access')
  })

  test('restores a missing primary from a validated last-good copy with one safe warning', () => {
    const created = createAccount({
      alias: 'recover-missing',
      provider: 'gmail',
      email: 'recover@example.com',
      client_id: 'client',
      tokens: {
        access_token: 'secret-access',
        refresh_token: 'secret-refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
      },
    })
    rmSync(testFile)
    const warning = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(loadConfig().accounts[0].id).toBe(created.id)
    expect(existsSync(testFile)).toBe(true)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(String(warning.mock.calls[0][0])).not.toContain('secret')
  })

  test('preserves a corrupt primary before restoring last-good', () => {
    createAccount({
      alias: 'recover-corrupt',
      provider: 'gmail',
      email: 'recover@example.com',
      client_id: 'client',
      tokens: {
        access_token: 'access',
        refresh_token: 'refresh',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
      },
    })
    const corruptContents = '{ definitely not json'
    writeFileSync(testFile, corruptContents)
    const warning = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(loadConfig().accounts[0].alias).toBe('recover-corrupt')
    const corruptFiles = readdirSync(testDirectory).filter((name) => (
      name.startsWith('accounts.json.corrupt-')
    ))
    expect(corruptFiles).toHaveLength(1)
    const corruptPath = join(testDirectory, corruptFiles[0])
    expect(readFileSync(corruptPath, 'utf8')).toBe(corruptContents)
    if (process.platform !== 'win32') {
      expect(statSync(corruptPath).mode & 0o777).toBe(0o600)
    }
    expect(warning).toHaveBeenCalledTimes(1)
  })

  test('does not create or overwrite files when last-good is invalid', () => {
    loadConfig()
    const invalidRecovery = '{ invalid recovery'
    writeFileSync(`${testFile}.last-good`, invalidRecovery)
    rmSync(testFile)

    expect(() => loadConfig()).toThrow(`${testFile}.last-good`)
    expect(existsSync(testFile)).toBe(false)
    expect(readFileSync(`${testFile}.last-good`, 'utf8')).toBe(invalidRecovery)
  })

  test('does not silently replace an invalid last-good beside a valid primary', () => {
    const config = loadConfig()
    const primary = readFileSync(testFile, 'utf8')
    const invalidRecovery = '{ invalid recovery beside valid primary'
    writeFileSync(`${testFile}.last-good`, invalidRecovery)

    expect(() => saveConfig(config)).toThrow(`${testFile}.last-good`)
    expect(readFileSync(testFile, 'utf8')).toBe(primary)
    expect(readFileSync(`${testFile}.last-good`, 'utf8')).toBe(invalidRecovery)
  })

  test('leaves a corrupt primary in place when the recovery copy is also invalid', () => {
    loadConfig()
    const corruptPrimary = '{ corrupt primary'
    const corruptRecovery = '{ corrupt recovery'
    writeFileSync(testFile, corruptPrimary)
    writeFileSync(`${testFile}.last-good`, corruptRecovery)

    expect(() => loadConfig()).toThrow(`${testFile}.last-good`)
    expect(readFileSync(testFile, 'utf8')).toBe(corruptPrimary)
    expect(readFileSync(`${testFile}.last-good`, 'utf8')).toBe(corruptRecovery)
    expect(readdirSync(testDirectory).some((name) => name.includes('.corrupt-'))).toBe(false)
  })

  test('recovers a directory lock left by a dead process', () => {
    const lock = `${testFile}.lock`
    mkdirSync(lock, { mode: 0o700 })
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 2_147_483_647 }))
    expect(loadConfig().version).toBe(2)
    expect(existsSync(lock)).toBe(true)
    expect(existsSync(join(lock, 'owner.json'))).toBe(false)
    expect(readdirSync(join(lock, 'claims'))).toEqual([])
  })

  test('never removes a live queued claim while reclaiming a dead predecessor', async () => {
    const lock = `${testFile}.lock`
    const claims = join(lock, 'claims')
    const deadNonce = '11111111-1111-4111-8111-111111111111'
    const liveNonce = '22222222-2222-4222-8222-222222222222'
    const liveClaim = join(claims, `${liveNonce}.json`)
    const readyPath = join(testDirectory, 'lock-child-ready')
    const observedPath = join(testDirectory, 'lock-child-observed')
    mkdirSync(claims, { recursive: true, mode: 0o700 })
    writeFileSync(join(lock, 'queue'), `Q:${deadNonce}\nQ:${liveNonce}\n`, { mode: 0o600 })
    writeFileSync(join(claims, `${deadNonce}.json`), JSON.stringify({
      pid: 2_147_483_647,
      nonce: deadNonce,
    }), { mode: 0o600 })

    const child = spawn(process.execPath, ['-e', `
      const fs = require('node:fs')
      const [claim, ready, observed] = process.argv.slice(1)
      fs.writeFileSync(ready, 'ready')
      setTimeout(() => fs.writeFileSync(observed, String(fs.existsSync(claim))), 100)
      setTimeout(() => fs.rmSync(claim, { force: true }), 250)
      setTimeout(() => process.exit(0), 300)
    `, liveClaim, readyPath, observedPath], { stdio: 'ignore' })
    if (!child.pid) throw new Error('Unable to start lock test process')
    writeFileSync(liveClaim, JSON.stringify({
      pid: child.pid,
      nonce: liveNonce,
    }), { mode: 0o600 })

    const exited = new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Lock test process exited with ${String(code)}`))
      })
    })
    const readyDeadline = Date.now() + 2_000
    while (!existsSync(readyPath) && Date.now() < readyDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(existsSync(readyPath)).toBe(true)

    expect(loadConfig().version).toBe(2)
    await exited
    expect(readFileSync(observedPath, 'utf8')).toBe('true')
    expect(existsSync(join(claims, `${deadNonce}.json`))).toBe(false)
    expect(readdirSync(claims)).toEqual([])
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
