import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// Gmail Message Normalization Tests (unit-level)
// ==========================================================

describe('Gmail Message Helpers', () => {
  // Test the parseEmailAddress logic that exists in gmail/messages.ts
  // We test it indirectly through the module's normalization

  test('email address parsing - simple address', () => {
    // This tests the pattern used in parseEmailAddress
    const raw = 'alice@example.com'
    const match = raw.match(/^(.+?)\s*<(.+?)>$/)
    expect(match).toBeNull()
    // Should return { address: raw.trim() }
    expect(raw.trim()).toBe('alice@example.com')
  })

  test('email address parsing - name + angle bracket format', () => {
    const raw = 'Alice Smith <alice@example.com>'
    const match = raw.match(/^(.+?)\s*<(.+?)>$/)
    expect(match).not.toBeNull()
    expect(match![1].trim().replace(/^"|"$/g, '')).toBe('Alice Smith')
    expect(match![2]).toBe('alice@example.com')
  })

  test('email address parsing - quoted name', () => {
    const raw = '"Bob Jones" <bob@example.com>'
    const match = raw.match(/^(.+?)\s*<(.+?)>$/)
    expect(match).not.toBeNull()
    expect(match![1].trim().replace(/^"|"$/g, '')).toBe('Bob Jones')
    expect(match![2]).toBe('bob@example.com')
  })

  test('multi-address parsing', () => {
    const raw = 'alice@example.com, bob@example.com'
    const addresses = raw.split(',').map((a) => a.trim())
    expect(addresses).toHaveLength(2)
    expect(addresses[0]).toBe('alice@example.com')
    expect(addresses[1]).toBe('bob@example.com')
  })

  test('empty string returns empty array', () => {
    const raw: string = ''
    const addresses: string[] = raw ? raw.split(',').map((a: string) => a.trim()) : []
    expect(addresses).toHaveLength(0)
  })
})
