import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// Error Utilities Tests
// ==========================================================

import {
  CliMailError, AuthError, TokenExpiredError, ApiError,
  RateLimitError, ConfigError, ProviderError, formatErrorOutput,
} from '../../src/utils/error'

describe('Error Utilities', () => {
  test('CliMailError has code, message and statusCode', () => {
    const err = new CliMailError('test message', 'TEST_CODE', 500)
    expect(err.message).toBe('test message')
    expect(err.code).toBe('TEST_CODE')
    expect(err.statusCode).toBe(500)
    expect(err.name).toBe('CliMailError')
    expect(err instanceof Error).toBe(true)
  })

  test('AuthError defaults to 401', () => {
    const err = new AuthError('auth failed')
    expect(err.code).toBe('AUTH_ERROR')
    expect(err.statusCode).toBe(401)
    expect(err instanceof CliMailError).toBe(true)
  })

  test('TokenExpiredError has specific message', () => {
    const err = new TokenExpiredError()
    expect(err.message).toContain('expired')
    expect(err.name).toBe('TokenExpiredError')
    expect(err instanceof AuthError).toBe(true)
  })

  test('ApiError includes response detail', () => {
    const response = { error: { code: 'NotFound' } }
    const err = new ApiError('Not found', 404, response)
    expect(err.statusCode).toBe(404)
    expect(err.response).toEqual(response)
    expect(err.code).toBe('API_ERROR')
  })

  test('RateLimitError includes retry info', () => {
    const err = new RateLimitError(5000)
    expect(err.retryAfterMs).toBe(5000)
    expect(err.statusCode).toBe(429)
    expect(err instanceof ApiError).toBe(true)
  })

  test('ConfigError has CONFIG_ERROR code', () => {
    const err = new ConfigError('missing config')
    expect(err.code).toBe('CONFIG_ERROR')
  })

  test('ProviderError includes provider name', () => {
    const err = new ProviderError('unsupported', 'gmail')
    expect(err.provider).toBe('gmail')
    expect(err.code).toBe('PROVIDER_ERROR')
  })

  describe('formatErrorOutput', () => {
    test('formats CliMailError as JSON', () => {
      const err = new ApiError('Not found', 404, { detail: 'missing' })
      const output = JSON.parse(formatErrorOutput(err))
      expect(output.error).toBe('Not found')
      expect(output.code).toBe('API_ERROR')
      expect(output.statusCode).toBe(404)
      expect(output.details).toEqual({ detail: 'missing' })
    })

    test('formats generic Error', () => {
      const output = JSON.parse(formatErrorOutput(new Error('something broke')))
      expect(output.error).toBe('something broke')
      expect(output.code).toBe('UNKNOWN_ERROR')
    })

    test('formats string error', () => {
      const output = JSON.parse(formatErrorOutput('raw string error'))
      expect(output.error).toBe('raw string error')
      expect(output.code).toBe('UNKNOWN_ERROR')
    })

    test('formats null error', () => {
      const output = JSON.parse(formatErrorOutput(null))
      expect(output.code).toBe('UNKNOWN_ERROR')
    })

    test('omits statusCode when not present', () => {
      const err = new ConfigError('bad config')
      const output = JSON.parse(formatErrorOutput(err))
      expect(output.statusCode).toBeUndefined()
    })

    test('omits details when response is not present', () => {
      const err = new ApiError('fail', 500)
      const output = JSON.parse(formatErrorOutput(err))
      expect(output.details).toBeUndefined()
    })
  })
})
