import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// Token Store (buildAuthUrl) Tests
// ==========================================================

import { buildAuthUrl } from '../../src/auth/token-store'

describe('Token Store', () => {
  describe('buildAuthUrl', () => {
    test('builds Gmail OAuth URL with all required params', () => {
      const url = buildAuthUrl({
        provider: 'gmail',
        client_id: 'test-client-id',
        redirect_uri: 'http://127.0.0.1:3000',
      })
      expect(url).toContain('accounts.google.com')
      expect(url).toContain('client_id=test-client-id')
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain(encodeURIComponent('https://mail.google.com/'))
    })

    test('builds Outlook OAuth URL', () => {
      const url = buildAuthUrl({
        provider: 'outlook',
        client_id: 'outlook-client-id',
        redirect_uri: 'http://127.0.0.1:4000',
      })
      expect(url).toContain('login.microsoftonline.com')
      expect(url).toContain('client_id=outlook-client-id')
      expect(url).toContain('Mail.ReadWrite')
      expect(url).toContain('Mail.Send')
    })

    test('includes state parameter when provided', () => {
      const url = buildAuthUrl({
        provider: 'gmail',
        client_id: 'test',
        redirect_uri: 'http://localhost:3000',
        state: 'random-state-123',
      })
      expect(url).toContain('state=random-state-123')
    })

    test('omits state when not provided', () => {
      const url = buildAuthUrl({
        provider: 'gmail',
        client_id: 'test',
        redirect_uri: 'http://localhost:3000',
      })
      expect(url).not.toContain('state=')
    })

    test('URL is parseable', () => {
      const url = buildAuthUrl({
        provider: 'gmail',
        client_id: 'test',
        redirect_uri: 'http://localhost:3000',
      })
      const parsed = new URL(url)
      expect(parsed.searchParams.get('client_id')).toBe('test')
      expect(parsed.searchParams.get('response_type')).toBe('code')
    })
  })
})
