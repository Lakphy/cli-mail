import { describe, expect, test } from 'vitest'
import {
  decodePageToken,
  decodePageTokenState,
  encodePageToken,
  resolvePageTokenOption,
} from '../../src/utils/page-token'

const gmail = { id: 'account-1', provider: 'gmail' as const }

describe('provider-neutral page tokens', () => {
  test('round-trips an opaque provider cursor', () => {
    const token = encodePageToken(gmail, 'message.list', 'gmail-cursor')
    expect(token).toBeTypeOf('string')
    expect(token).not.toContain('gmail-cursor')
    expect(decodePageToken(token, gmail, 'message.list')).toBe('gmail-cursor')
  })

  test('rejects tokens from another account', () => {
    const token = encodePageToken(gmail, 'message.list', 'cursor')
    expect(() => decodePageToken(token, { ...gmail, id: 'account-2' }, 'message.list'))
      .toThrow(/Invalid or mismatched page token/)
  })

  test('rejects tokens from another operation or provider', () => {
    const token = encodePageToken(gmail, 'message.list', 'cursor')
    expect(() => decodePageToken(token, gmail, 'message.search')).toThrow()
    expect(() => decodePageToken(token, { id: gmail.id, provider: 'outlook' }, 'message.list')).toThrow()
  })

  test('rejects malformed input', () => {
    expect(() => decodePageToken('not.valid', gmail, 'message.list')).toThrow()
  })

  test('carries opaque operation context for stable relative pagination', () => {
    const token = encodePageToken(gmail, 'message.recent', 'cursor', {
      since: '2026-07-11T00:00:00.000Z',
    })
    expect(decodePageTokenState(token, gmail, 'message.recent')).toEqual({
      cursor: 'cursor',
      context: { since: '2026-07-11T00:00:00.000Z' },
    })
  })

  test('rejects legacy v1 tokens with restart guidance', () => {
    const token = Buffer.from(JSON.stringify({
      v: 1,
      accountId: gmail.id,
      provider: gmail.provider,
      operation: 'message.list',
      cursor: 'old',
    })).toString('base64url')
    expect(() => decodePageToken(token, gmail, 'message.list'))
      .toThrow(/no longer supported.*without --page-token/i)
  })

  test('restores omitted context and rejects explicit mismatches', () => {
    const token = encodePageToken(gmail, 'message.list', 'cursor', {
      folder: 'INBOX',
      query: 'is:unread',
      top: '25',
    })
    const state = decodePageTokenState(token, gmail, 'message.list')
    expect(resolvePageTokenOption(state, 'folder', undefined)).toBe('INBOX')
    expect(resolvePageTokenOption(state, 'top', '25')).toBe('25')
    expect(() => resolvePageTokenOption(state, 'query', 'from:other@example.com'))
      .toThrow(/does not match this page token/)
  })
})
