// Hardened loopback HTTP server for OAuth2 native-app callbacks.

import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export interface OAuthCallbackResult {
  code: string
  state?: string
}

export interface OAuthCallbackServerOptions {
  /** Use 0 (the default) to allocate a random ephemeral port. */
  port?: number
  /** Loopback hostname used by both the listener and redirect URI. */
  host?: '127.0.0.1' | 'localhost'
  /** Exact callback route. Gmail uses /callback; Entra desktop apps use /. */
  path?: string
  expectedState: string
  timeoutMs?: number
}

export interface OAuthCallbackServer {
  result: Promise<OAuthCallbackResult>
  port: number
  host: string
  path: string
  server: Server
}

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const

const SUCCESS_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Authorization complete</title></head><body><h1>Authorization successful</h1><p>You can close this window and return to the terminal.</p></body></html>'
const FAILURE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Authorization failed</title></head><body><h1>Authorization failed</h1><p>You can close this window and return to the terminal.</p></body></html>'

function stateMatches(actual: string | null, expected: string): boolean {
  if (actual === null) return false
  // Hash first so timingSafeEqual always receives equal-length buffers.
  const actualHash = createHash('sha256').update(actual, 'utf8').digest()
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(actualHash, expectedHash)
}

function send(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(status, {
    ...RESPONSE_HEADERS,
    ...extraHeaders,
    'Content-Type': contentType,
  })
  response.end(body)
}

/**
 * Start a callback server bound to an explicit loopback host. The expected
 * state is mandatory so no caller can accidentally create an unbound flow.
 */
export function startOAuthCallbackServer(
  options: OAuthCallbackServerOptions,
): Promise<OAuthCallbackServer> {
  const requestedPort = options.port ?? 0
  const host = options.host ?? '127.0.0.1'
  const callbackPath = options.path ?? '/callback'
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000
  if (!callbackPath.startsWith('/') || callbackPath.includes('?') || callbackPath.includes('#')) {
    throw new TypeError('OAuth callback path must be an absolute URL path')
  }

  return new Promise((resolveStart, rejectStart) => {
    let resolveResult!: (value: OAuthCallbackResult) => void
    let rejectResult!: (reason: Error) => void
    let started = false
    let settled = false

    const result = new Promise<OAuthCallbackResult>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })

    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      callback()
      server.close()
    }

    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      if (request.method !== 'GET') {
        send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed', {
          Allow: 'GET',
        })
        return
      }

      let url: URL
      try {
        url = new URL(request.url || '/', `http://${host}`)
      } catch {
        send(response, 400, 'text/plain; charset=utf-8', 'Invalid callback request')
        return
      }

      if (url.pathname !== callbackPath) {
        send(response, 404, 'text/plain; charset=utf-8', 'Not Found')
        return
      }

      const state = url.searchParams.get('state')
      if (!stateMatches(state, options.expectedState)) {
        // A bad callback must not consume the one-time callback listener.
        send(response, 400, 'text/plain; charset=utf-8', 'Invalid OAuth state')
        return
      }

      const error = url.searchParams.get('error')
      if (error) {
        send(response, 200, 'text/html; charset=utf-8', FAILURE_HTML)
        const safeError = /^[a-zA-Z0-9_.-]+$/.test(error) ? error : 'oauth_error'
        settle(() => rejectResult(new Error(`OAuth authorization failed: ${safeError}`)))
        return
      }

      const code = url.searchParams.get('code')
      if (!code) {
        send(response, 400, 'text/plain; charset=utf-8', 'Missing authorization code')
        return
      }

      send(response, 200, 'text/html; charset=utf-8', SUCCESS_HTML)
      settle(() => resolveResult({ code, ...(state ? { state } : {}) }))
    })

    const timeout = setTimeout(() => {
      settle(() => rejectResult(new Error(
        `OAuth callback timed out after ${formatTimeout(timeoutMs)}`,
      )))
    }, timeoutMs)
    timeout.unref()

    server.on('error', (error) => {
      if (!started) {
        settled = true
        clearTimeout(timeout)
        rejectStart(error)
      } else {
        settle(() => rejectResult(error))
      }
    })
    server.on('close', () => clearTimeout(timeout))

    server.listen(requestedPort, host, () => {
      started = true
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : requestedPort
      resolveStart({ result, port, host, path: callbackPath, server })
    })
  })
}

function formatTimeout(timeoutMs: number): string {
  if (timeoutMs >= 60_000 && timeoutMs % 60_000 === 0) {
    const minutes = timeoutMs / 60_000
    return `${minutes} minute${minutes === 1 ? '' : 's'}`
  }
  return `${timeoutMs}ms`
}
