import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// OAuth Server Tests
// ==========================================================

import { startOAuthCallbackServer } from '../../src/auth/oauth-server'

describe('OAuth Callback Server', () => {
  test('starts on random port and receives auth code', async () => {
    const { result, port } = await startOAuthCallbackServer()
    expect(port).toBeGreaterThan(0)

    const response = await fetch(`http://127.0.0.1:${port}?code=test-auth-code&state=test-state`)
    expect(response.ok).toBe(true)

    const callbackResult = await result
    expect(callbackResult.code).toBe('test-auth-code')
    expect(callbackResult.state).toBe('test-state')
  })

  test('handles error response from OAuth provider', async () => {
    const { result, port } = await startOAuthCallbackServer()
    const errorPromise = result.catch((err) => err)
    await fetch(`http://127.0.0.1:${port}?error=access_denied`)
    const error = await errorPromise
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('access_denied')
  })

  test('handles code without state', async () => {
    const { result, port } = await startOAuthCallbackServer()
    await fetch(`http://127.0.0.1:${port}?code=no-state-code`)
    const callbackResult = await result
    expect(callbackResult.code).toBe('no-state-code')
  })
})
