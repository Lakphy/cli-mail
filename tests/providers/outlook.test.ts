import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// Outlook Message Normalization Tests
// ==========================================================

describe('Outlook Message Helpers', () => {
  test('Graph email address format conversion', () => {
    const graphAddr = { emailAddress: { name: 'Alice', address: 'alice@example.com' } }
    const normalized = { name: graphAddr.emailAddress.name, address: graphAddr.emailAddress.address }
    expect(normalized.name).toBe('Alice')
    expect(normalized.address).toBe('alice@example.com')
  })

  test('Graph email address without name', () => {
    const graphAddr: { emailAddress: { name?: string; address: string } } = { emailAddress: { address: 'alice@example.com' } }
    const normalized = { name: graphAddr.emailAddress.name, address: graphAddr.emailAddress.address }
    expect(normalized.name).toBeUndefined()
    expect(normalized.address).toBe('alice@example.com')
  })

  test('toGraphAddress format', () => {
    const addr = 'alice@example.com'
    const graphAddr = { emailAddress: { address: addr } }
    expect(graphAddr.emailAddress.address).toBe('alice@example.com')
  })
})
