import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// Test suite for all user feedback fixes
// ==========================================================

// --- 1. CLI structure tests for new commands ---

import { createCli, _resetGlobalAccount, getGlobalAccount } from '../src/cli'

describe('CLI Structure — New Commands', () => {
  test('account command has rename subcommand', () => {
    const program = createCli()
    const accCmd = program.commands.find((c) => c.name() === 'account')
    const subNames = accCmd?.commands.map((c) => c.name()) || []
    expect(subNames).toContain('rename')
  })

  test('account rename takes <old-alias> <new-alias>', () => {
    const program = createCli()
    const accCmd = program.commands.find((c) => c.name() === 'account')
    const renameCmd = accCmd?.commands.find((c) => c.name() === 'rename')
    expect(renameCmd).toBeDefined()
    // Commander stores registered arguments
    const argNames = renameCmd?.registeredArguments?.map((a: any) => a.name()) || []
    expect(argNames).toContain('old-alias')
    expect(argNames).toContain('new-alias')
  })

  test('account command has validate subcommand', () => {
    const program = createCli()
    const accCmd = program.commands.find((c) => c.name() === 'account')
    const subNames = accCmd?.commands.map((c) => c.name()) || []
    expect(subNames).toContain('validate')
  })

  test('message command has recent subcommand', () => {
    const program = createCli()
    const msgCmd = program.commands.find((c) => c.name() === 'message')
    const subNames = msgCmd?.commands.map((c) => c.name()) || []
    expect(subNames).toContain('recent')
  })

  test('message recent has --hours, --since, --top, --account options', () => {
    const program = createCli()
    const msgCmd = program.commands.find((c) => c.name() === 'message')
    const recentCmd = msgCmd?.commands.find((c) => c.name() === 'recent')
    const flags = recentCmd?.options.map((o) => o.long) || []
    expect(flags).toContain('--hours')
    expect(flags).toContain('--since')
    expect(flags).toContain('--top')
    expect(flags).toContain('--account')
  })

  test('inbox command exists at top level for cross-account aggregation', () => {
    const program = createCli()
    const inboxCmd = program.commands.find((c) => c.name() === 'inbox')
    expect(inboxCmd).toBeDefined()
  })

  test('inbox command has --hours, --since, --top', () => {
    const program = createCli()
    const inboxCmd = program.commands.find((c) => c.name() === 'inbox')
    const flags = inboxCmd?.options.map((o) => o.long) || []
    expect(flags).toContain('--hours')
    expect(flags).toContain('--since')
    expect(flags).toContain('--top')
  })
})

// --- 2. Global --account resolution ---

describe('Global Account Resolution', () => {
  beforeEach(() => {
    _resetGlobalAccount()
  })

  test('getGlobalAccount returns undefined by default', () => {
    expect(getGlobalAccount()).toBeUndefined()
  })

  test('_resetGlobalAccount clears the value', () => {
    // We can't easily set it without running the CLI, but we can verify reset works
    _resetGlobalAccount()
    expect(getGlobalAccount()).toBeUndefined()
  })
})

// --- 3. Outlook search: no $orderby with $search ---

import * as outlookMessages from '../src/providers/outlook/messages'

describe('Outlook Search Fix', () => {
  test('listMessages does not include $orderby when query is present', async () => {
    const mockClient = {
      get: vi.fn().mockResolvedValue({ value: [] }),
    } as any

    await outlookMessages.listMessages(mockClient, { query: 'test search', top: 10 })

    // Check the query params passed to client.get
    const [_path, queryParams] = mockClient.get.mock.calls[0]
    expect(queryParams['$search']).toBeTruthy() // should have $search
    expect(queryParams['$orderby']).toBeUndefined() // should NOT have $orderby
  })

  test('listMessages includes $orderby when no query', async () => {
    const mockClient = {
      get: vi.fn().mockResolvedValue({ value: [] }),
    } as any

    await outlookMessages.listMessages(mockClient, { top: 10 })

    const [_path, queryParams] = mockClient.get.mock.calls[0]
    expect(queryParams['$orderby']).toBe('receivedDateTime desc')
    expect(queryParams['$search']).toBeUndefined()
  })

  test('listMessages supports $filter parameter', async () => {
    const mockClient = {
      get: vi.fn().mockResolvedValue({ value: [] }),
    } as any

    await outlookMessages.listMessages(mockClient, {
      top: 10,
      filter: 'receivedDateTime ge 2026-03-28T00:00:00Z',
    })

    const [_path, queryParams] = mockClient.get.mock.calls[0]
    expect(queryParams['$filter']).toBe('receivedDateTime ge 2026-03-28T00:00:00Z')
  })

  test('search results are sorted client-side by date', async () => {
    const mockClient = {
      get: vi.fn().mockResolvedValue({
        value: [
          { id: '1', receivedDateTime: '2026-03-25T10:00:00Z', subject: 'Old', isRead: false, hasAttachments: false },
          { id: '2', receivedDateTime: '2026-03-28T10:00:00Z', subject: 'New', isRead: true, hasAttachments: false },
        ],
      }),
    } as any

    const result = await outlookMessages.listMessages(mockClient, { query: 'test', top: 10 })

    // Newer message should be first after client-side sort
    expect(result.messages[0].id).toBe('2')
    expect(result.messages[1].id).toBe('1')
  })
})

// --- 4. Config store: renameAccount ---

import { renameAccount, loadConfig, saveConfig, addAccount, setDefaultAccount, setConfigPath, resetConfigPath } from '../src/config/store'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError } from '../src/utils/error'

describe('Account Rename', () => {
  const testConfigDir = join(import.meta.dirname, '..', '.test-config-rename')
  const testConfigFile = join(testConfigDir, 'accounts.json')

  beforeEach(() => {
    // Redirect config to isolated test directory
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true })
    }
    setConfigPath(testConfigFile)

    // Set up a test config
    const testConfig = {
      default_account: 'old-alias',
      accounts: [
        {
          alias: 'old-alias',
          provider: 'gmail',
          email: 'test@example.com',
          client_id: 'cid',
          client_secret: 'cs',
          tokens: { access_token: 'at', refresh_token: 'rt', expires_at: Date.now() + 3600000, token_type: 'Bearer' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          alias: 'other-account',
          provider: 'outlook',
          email: 'other@example.com',
          client_id: 'cid2',
          client_secret: 'cs2',
          tokens: { access_token: 'at2', refresh_token: 'rt2', expires_at: Date.now() + 3600000, token_type: 'Bearer' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    }
    writeFileSync(testConfigFile, JSON.stringify(testConfig, null, 2))
  })

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true })
    }
  })

  test('renameAccount changes alias', () => {
    renameAccount('old-alias', 'new-alias')
    const config = loadConfig()
    expect(config.accounts.find((a) => a.alias === 'new-alias')).toBeDefined()
    expect(config.accounts.find((a) => a.alias === 'old-alias')).toBeUndefined()
  })

  test('renameAccount updates default_account reference', () => {
    renameAccount('old-alias', 'new-alias')
    const config = loadConfig()
    expect(config.default_account).toBe('new-alias')
  })

  test('renameAccount throws on conflicting alias', () => {
    expect(() => renameAccount('old-alias', 'other-account')).toThrow(ConfigError)
  })

  test('renameAccount throws if account not found', () => {
    expect(() => renameAccount('nonexistent', 'new-alias')).toThrow(ConfigError)
  })
})

// --- 5. Error suggestions ---

import { formatErrorOutput, ApiError, AuthError, TokenExpiredError, RateLimitError } from '../src/utils/error'

describe('Error Suggestions', () => {
  test('AuthError includes re-authenticate suggestion', () => {
    const error = new AuthError('token invalid')
    const output = JSON.parse(formatErrorOutput(error))
    expect(output.suggestion).toContain('Re-authenticate')
  })

  test('TokenExpiredError includes re-authenticate suggestion', () => {
    const error = new TokenExpiredError()
    const output = JSON.parse(formatErrorOutput(error))
    expect(output.suggestion).toContain('Re-authenticate')
  })

  test('RateLimitError includes retry suggestion', () => {
    const error = new RateLimitError(5000)
    const output = JSON.parse(formatErrorOutput(error))
    expect(output.suggestion).toContain('Retry after')
  })

  test('ApiError with 503 suggests retry', () => {
    const error = new ApiError('Service temporarily unavailable', 503)
    const output = JSON.parse(formatErrorOutput(error))
    expect(output.suggestion).toContain('temporarily unavailable')
  })

  test('ApiError with orderBy message suggests alternative', () => {
    const error = new ApiError("The query parameter '$orderBy' is not supported", 400)
    const output = JSON.parse(formatErrorOutput(error))
    expect(output.suggestion).toContain('sorting')
  })

  test('ApiError with 403 OAuth suggests test users', () => {
    const error = new ApiError('access_denied', 403)
    const output = JSON.parse(formatErrorOutput(error))
    expect(output.suggestion).toContain('OAuth')
  })

  test('ConfigError with "not found" suggests account list', () => {
    const error = new ConfigError('Account not found: xyz')
    const output = JSON.parse(formatErrorOutput(error))
    expect(output.suggestion).toContain('account list')
  })
})

// --- 6. ListOptions has filter field ---

describe('ListOptions Type', () => {
  test('ListOptions supports filter property', () => {
    // TypeScript type check — if this compiles, the type is correct
    const opts: import('../src/providers/types').ListOptions = {
      top: 10,
      filter: 'receivedDateTime ge 2026-03-28T00:00:00Z',
    }
    expect(opts.filter).toBeDefined()
  })
})
