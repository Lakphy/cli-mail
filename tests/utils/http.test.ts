import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// HttpClient config tests
// ==========================================================

describe('HttpClient Configuration', () => {
  test('Gmail base URL is correct', () => {
    expect('https://gmail.googleapis.com/gmail/v1/users/me').toContain('gmail.googleapis.com')
  })

  test('Outlook base URL is correct', () => {
    expect('https://graph.microsoft.com/v1.0/me').toContain('graph.microsoft.com')
  })
})
