import { afterEach, describe, expect, test } from 'vitest'
import type { Server } from 'node:http'
import { startOAuthCallbackServer } from '../../src/auth/oauth-server'

const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

describe('OAuth callback server', () => {
  test('uses a random loopback port and validates state', async () => {
    const callback = await startOAuthCallbackServer({ port: 0, expectedState: 'expected' })
    servers.push(callback.server)
    expect(callback.port).toBeGreaterThan(0)

    const response = await fetch(
      `http://127.0.0.1:${callback.port}/callback?code=auth-code&state=expected`,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    await expect(callback.result).resolves.toEqual({ code: 'auth-code', state: 'expected' })
  })

  test('bad state does not consume the callback listener', async () => {
    const callback = await startOAuthCallbackServer({ port: 0, expectedState: 'good-state' })
    servers.push(callback.server)

    const bad = await fetch(
      `http://127.0.0.1:${callback.port}/callback?code=attacker&state=bad-state`,
    )
    expect(bad.status).toBe(400)

    const good = await fetch(
      `http://127.0.0.1:${callback.port}/callback?code=real-code&state=good-state`,
    )
    expect(good.status).toBe(200)
    await expect(callback.result).resolves.toMatchObject({ code: 'real-code' })
  })

  test('binds and routes using the configured localhost root callback', async () => {
    const callback = await startOAuthCallbackServer({
      port: 0,
      host: 'localhost',
      path: '/',
      expectedState: 'outlook-state',
    })
    servers.push(callback.server)
    expect(callback.host).toBe('localhost')
    expect(callback.path).toBe('/')

    const wrongPath = await fetch(
      `http://localhost:${callback.port}/callback?code=wrong&state=outlook-state`,
    )
    expect(wrongPath.status).toBe(404)

    const root = await fetch(
      `http://localhost:${callback.port}/?code=right&state=outlook-state`,
    )
    expect(root.status).toBe(200)
    await expect(callback.result).resolves.toMatchObject({ code: 'right' })
  })

  test('missing state is rejected when an expected state is configured', async () => {
    const callback = await startOAuthCallbackServer({ port: 0, expectedState: 'required' })
    servers.push(callback.server)

    const missing = await fetch(
      `http://127.0.0.1:${callback.port}/callback?code=no-state`,
    )
    expect(missing.status).toBe(400)

    await fetch(
      `http://127.0.0.1:${callback.port}/callback?code=valid&state=required`,
    )
    await expect(callback.result).resolves.toMatchObject({ code: 'valid' })
  })

  test('provider error is not reflected in callback HTML', async () => {
    const callback = await startOAuthCallbackServer({ port: 0, expectedState: 'state' })
    servers.push(callback.server)
    const result = callback.result.catch((error: unknown) => error)

    const response = await fetch(
      `http://127.0.0.1:${callback.port}/callback?error=access_denied&state=state`,
    )
    expect(await response.text()).not.toContain('access_denied')
    const error = await result
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('access_denied')
  })

  test('rejects non-GET requests without closing the listener', async () => {
    const callback = await startOAuthCallbackServer({ port: 0, expectedState: 'state' })
    servers.push(callback.server)
    const response = await fetch(`http://127.0.0.1:${callback.port}/callback`, {
      method: 'POST',
    })
    expect(response.status).toBe(405)

    await fetch(
      `http://127.0.0.1:${callback.port}/callback?code=valid&state=state`,
    )
    await expect(callback.result).resolves.toMatchObject({ code: 'valid' })
  })

  test('times out and closes the server', async () => {
    const callback = await startOAuthCallbackServer({
      port: 0,
      expectedState: 'state',
      timeoutMs: 20,
    })
    servers.push(callback.server)
    await expect(callback.result).rejects.toThrow('timed out after 20ms')
  })
})
