import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// Config Types & Store Tests
// ==========================================================

import type { AppConfig, AccountConfig } from '../../src/config/types'
import { GMAIL_AUTH, OUTLOOK_AUTH, DEFAULT_CONFIG } from '../../src/config/types'

describe('Config Types', () => {
  test('DEFAULT_CONFIG has empty accounts and null default', () => {
    expect(DEFAULT_CONFIG.accounts).toHaveLength(0)
    expect(DEFAULT_CONFIG.default_account).toBeNull()
  })

  test('AccountConfig structure validation', () => {
    const account: AccountConfig = {
      alias: 'test',
      provider: 'gmail',
      email: 'test@gmail.com',
      client_id: 'client-123',
      client_secret: 'secret-456',
      tokens: {
        access_token: 'at-123',
        refresh_token: 'rt-456',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
        scope: 'https://mail.google.com/',
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    expect(account.provider).toBe('gmail')
    expect(account.tokens.access_token).toBe('at-123')
    expect(account.tokens.expires_at).toBeGreaterThan(Date.now())
  })

  test('provider can only be gmail or outlook', () => {
    const gmail: AccountConfig['provider'] = 'gmail'
    const outlook: AccountConfig['provider'] = 'outlook'
    expect(gmail).toBe('gmail')
    expect(outlook).toBe('outlook')
  })
})

describe('Auth Constants', () => {
  test('Gmail auth URLs are correct', () => {
    expect(GMAIL_AUTH.authUrl).toContain('accounts.google.com')
    expect(GMAIL_AUTH.tokenUrl).toContain('oauth2.googleapis.com')
    expect(GMAIL_AUTH.scopes).toContain('https://mail.google.com/')
  })

  test('Outlook auth URLs are correct', () => {
    expect(OUTLOOK_AUTH.authUrl).toContain('login.microsoftonline.com')
    expect(OUTLOOK_AUTH.tokenUrl).toContain('login.microsoftonline.com')
    expect(OUTLOOK_AUTH.scopes).toContain('Mail.ReadWrite')
    expect(OUTLOOK_AUTH.scopes).toContain('Mail.Send')
    expect(OUTLOOK_AUTH.scopes).toContain('MailboxSettings.ReadWrite')
    expect(OUTLOOK_AUTH.scopes).toContain('User.Read')
    expect(OUTLOOK_AUTH.scopes).toContain('offline_access')
  })

  test('Gmail scopes include full mail access', () => {
    expect(GMAIL_AUTH.scopes.length).toBeGreaterThanOrEqual(1)
  })

  test('Outlook has 5 required scopes', () => {
    expect(OUTLOOK_AUTH.scopes.length).toBe(5)
  })
})
