import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AccountConfig } from '../../src/config/types'

vi.mock('../../src/config/store', () => ({
  getActiveAccount: vi.fn(),
}))
vi.mock('../../src/providers/gmail/client', () => ({
  createGmailClient: vi.fn(() => ({ provider: 'gmail-client' })),
}))
vi.mock('../../src/providers/outlook/client', () => ({
  createOutlookClient: vi.fn(() => ({ provider: 'outlook-client' })),
}))

import { getActiveAccount } from '../../src/config/store'
import { createOutlookClient } from '../../src/providers/outlook/client'
import {
  resetGlobalAccount,
  setGlobalAccount,
} from '../../src/config/context'
import { createClientForAccount, resolveAccount } from '../../src/commands/resolve'

const account: AccountConfig = {
  id: 'account-id',
  status: 'active',
  alias: 'selected',
  provider: 'gmail',
  email: 'selected@example.com',
  client_id: 'client-id',
  tokens: {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: Date.now() + 60_000,
    token_type: 'Bearer',
  },
  scopes: ['https://www.googleapis.com/auth/gmail.modify'],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

describe('account resolution context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetGlobalAccount()
    vi.mocked(getActiveAccount).mockReturnValue(account)
  })

  test('a subcommand account takes precedence over the global account', () => {
    setGlobalAccount('global-account')

    resolveAccount('subcommand-account')

    expect(getActiveAccount).toHaveBeenCalledWith('subcommand-account')
  })

  test('uses the global account before falling back to the default', () => {
    setGlobalAccount('global-account')
    resolveAccount()
    expect(getActiveAccount).toHaveBeenLastCalledWith('global-account')

    resetGlobalAccount()
    resolveAccount()
    expect(getActiveAccount).toHaveBeenLastCalledWith(undefined)
  })

  test('the command layer imports context without importing the CLI command tree', () => {
    const source = readFileSync(
      new URL('../../src/commands/resolve.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain("from '../config/context.js'")
    expect(source).not.toContain("from '../cli.js'")
  })

  test('createClientForAccount dispatches by provider', () => {
    const outlookAccount = { ...account, provider: 'outlook' as const }
    createClientForAccount(outlookAccount)
    expect(createOutlookClient).toHaveBeenCalledWith(outlookAccount)
  })
})
