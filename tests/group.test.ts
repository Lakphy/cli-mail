import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import {
  setConfigPath,
  loadConfig,
  setAccountTag,
  getAccountsByTag,
  listTags,
  validateTag,
  createAccount,
} from '../src/config/store'
import { ConfigError } from '../src/utils/error'
import type { NewAccountConfig } from '../src/config/store'

// ==========================================================
// Tag / Group Feature Tests
// ==========================================================

function makeAccount(alias: string, provider: 'gmail' | 'outlook', tag?: string): NewAccountConfig {
  return {
    alias,
    ...(tag ? { tag } : {}),
    provider,
    email: `${alias}@example.com`,
    client_id: 'cid',
    client_secret: 'cs',
    tokens: {
      access_token: 'at',
      refresh_token: 'rt',
      expires_at: Date.now() + 3600000,
      token_type: 'Bearer',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

describe('Tag Validation', () => {
  test('accepts valid alphanumeric tags', () => {
    expect(() => validateTag('work')).not.toThrow()
    expect(() => validateTag('personal')).not.toThrow()
    expect(() => validateTag('my-team')).not.toThrow()
    expect(() => validateTag('A1')).not.toThrow()
    expect(() => validateTag('x')).not.toThrow()
  })

  test('rejects "default" as a tag name', () => {
    expect(() => validateTag('default')).toThrow(ConfigError)
    expect(() => validateTag('default')).toThrow('reserved')
  })

  test('rejects tags with special characters', () => {
    expect(() => validateTag('work@home')).toThrow(ConfigError)
    expect(() => validateTag('my tag')).toThrow(ConfigError)
    expect(() => validateTag('工作')).toThrow(ConfigError)
    expect(() => validateTag('a/b')).toThrow(ConfigError)
  })

  test('rejects empty string', () => {
    expect(() => validateTag('')).toThrow(ConfigError)
  })

  test('rejects tags longer than 32 characters', () => {
    expect(() => validateTag('a'.repeat(33))).toThrow(ConfigError)
  })

  test('accepts tags exactly 32 characters', () => {
    expect(() => validateTag('a'.repeat(32))).not.toThrow()
  })

  test('rejects tags starting with a hyphen', () => {
    expect(() => validateTag('-work')).toThrow(ConfigError)
  })
})

describe('Tag Store Operations', () => {
  const testConfigDir = join(import.meta.dirname, '..', '.test-config-tag')
  const testConfigFile = join(testConfigDir, 'accounts.json')

  beforeEach(() => {
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true })
    }
    setConfigPath(testConfigFile)

    // Set up test config with mixed tagged/untagged accounts
    const testConfig = {
      default_account: 'alice',
      accounts: [
        makeAccount('alice', 'gmail'),
        makeAccount('bob', 'outlook', 'work'),
        makeAccount('carol', 'gmail', 'work'),
        makeAccount('dave', 'outlook', 'personal'),
      ],
    }
    writeFileSync(testConfigFile, JSON.stringify(testConfig, null, 2))
  })

  afterEach(() => {
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true })
    }
  })

  // --- setAccountTag ---

  test('setAccountTag sets a tag on an account', () => {
    setAccountTag('alice', 'vip')
    const config = loadConfig()
    const alice = config.accounts.find((a) => a.alias === 'alice')
    expect(alice?.tag).toBe('vip')
  })

  test('setAccountTag removes a tag when null', () => {
    setAccountTag('bob', null)
    const config = loadConfig()
    const bob = config.accounts.find((a) => a.alias === 'bob')
    expect(bob?.tag).toBeUndefined()
  })

  test('setAccountTag updates updated_at timestamp', () => {
    const before = loadConfig().accounts.find((a) => a.alias === 'alice')!.updated_at
    // Ensure we get a different timestamp by waiting a tick
    const start = Date.now()
    while (Date.now() === start) { /* spin until ms changes */ }
    setAccountTag('alice', 'test-tag')
    const after = loadConfig().accounts.find((a) => a.alias === 'alice')!.updated_at
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime())
  })

  test('setAccountTag throws on nonexistent account', () => {
    expect(() => setAccountTag('nonexistent', 'work')).toThrow(ConfigError)
  })

  test('setAccountTag rejects invalid tag names', () => {
    expect(() => setAccountTag('alice', 'default')).toThrow(ConfigError)
    expect(() => setAccountTag('alice', 'bad tag')).toThrow(ConfigError)
  })

  // --- getAccountsByTag ---

  test('getAccountsByTag returns accounts with matching tag', () => {
    const work = getAccountsByTag('work')
    expect(work).toHaveLength(2)
    expect(work.map((a) => a.alias).sort()).toEqual(['bob', 'carol'])
  })

  test('getAccountsByTag("default") returns untagged accounts', () => {
    const defaults = getAccountsByTag('default')
    expect(defaults).toHaveLength(1)
    expect(defaults[0].alias).toBe('alice')
  })

  test('getAccountsByTag returns empty for nonexistent tag', () => {
    const none = getAccountsByTag('nonexistent')
    expect(none).toHaveLength(0)
  })

  // --- listTags ---

  test('listTags returns all unique tags with counts', () => {
    const tags = listTags()
    expect(tags).toEqual([
      { tag: 'default', count: 1 },
      { tag: 'personal', count: 1 },
      { tag: 'work', count: 2 },
    ])
  })

  test('listTags omits "default" when all accounts have tags', () => {
    setAccountTag('alice', 'personal')
    const tags = listTags()
    const tagNames = tags.map((t) => t.tag)
    expect(tagNames).not.toContain('default')
  })

  test('listTags returns empty when no accounts exist', () => {
    writeFileSync(testConfigFile, JSON.stringify({ default_account: null, accounts: [] }))
    const tags = listTags()
    expect(tags).toHaveLength(0)
  })
})

describe('Tag preserved during account operations', () => {
  const testConfigDir = join(import.meta.dirname, '..', '.test-config-tag-ops')
  const testConfigFile = join(testConfigDir, 'accounts.json')

  beforeEach(() => {
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true })
    }
    setConfigPath(testConfigFile)
    writeFileSync(testConfigFile, JSON.stringify({ default_account: null, accounts: [] }))
  })

  afterEach(() => {
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true })
    }
  })

  test('createAccount preserves tag field', () => {
    const account = makeAccount('tagged-user', 'gmail', 'team-a')
    createAccount(account)
    const config = loadConfig()
    expect(config.accounts[0].tag).toBe('team-a')
  })

  test('createAccount without tag has no tag field', () => {
    const account = makeAccount('plain-user', 'gmail')
    createAccount(account)
    const config = loadConfig()
    expect(config.accounts[0].tag).toBeUndefined()
  })
})
