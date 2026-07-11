import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// Error Utilities Tests
// ==========================================================

import {
  CliMailError, AuthError, TokenExpiredError, ApiError,
  RateLimitError, ConfigError, ProviderError, errorMessage, formatErrorOutput,
} from '../../src/utils/error'

describe('Error Utilities', () => {
  test('errorMessage normalizes Error objects and primitive failures', () => {
    expect(errorMessage(new Error('failed'))).toBe('failed')
    expect(errorMessage('failed')).toBe('failed')
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage(null)).toBe('null')
  })

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
    expect(err.code).toBe('RATE_LIMIT_ERROR')
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
      expect(output.error.message).toBe('Not found')
      expect(output.error.code).toBe('API_ERROR')
      expect(output.error.statusCode).toBe(404)
      expect(output.error.details).toEqual({ detail: 'missing' })
    })

    test('formats generic Error', () => {
      const output = JSON.parse(formatErrorOutput(new Error('something broke')))
      expect(output.error.message).toBe('something broke')
      expect(output.error.code).toBe('UNKNOWN_ERROR')
    })

    test('formats string error', () => {
      const output = JSON.parse(formatErrorOutput('raw string error'))
      expect(output.error.message).toBe('raw string error')
      expect(output.error.code).toBe('UNKNOWN_ERROR')
    })

    test('formats null error', () => {
      const output = JSON.parse(formatErrorOutput(null))
      expect(output.error.code).toBe('UNKNOWN_ERROR')
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

    test('uses an ApiError suggestion attached by a provider', () => {
      const err = new ApiError(
        'Provider query failed',
        400,
        { error: { code: 'ProviderQueryError' } },
        'Use the provider-specific query syntax.',
      )
      const output = JSON.parse(formatErrorOutput(err))
      expect(output.error.suggestion).toBe('Use the provider-specific query syntax.')
    })

    test('does not infer Graph search advice from a shared ApiError message', () => {
      const err = new ApiError("The query parameter '$orderby' is not supported", 400)
      const output = JSON.parse(formatErrorOutput(err))
      expect(output.error.suggestion).toBe('Check the command parameters and try again.')
    })

    test('suggests reauthentication from the structured code', () => {
      const err = new CliMailError('Account needs attention', 'ACCOUNT_REAUTH_REQUIRED')
      const output = JSON.parse(formatErrorOutput(err))
      expect(output.error.suggestion).toContain('account reauth')
    })
  })
})
