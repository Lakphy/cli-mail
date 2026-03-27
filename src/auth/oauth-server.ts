// Local HTTP server for OAuth2 callback

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'

export interface OAuthCallbackResult {
  code: string
  state?: string
}

/**
 * Start a local HTTP server to receive the OAuth2 authorization code callback.
 * Returns a promise that resolves with the authorization code.
 */
export function startOAuthCallbackServer(
  port = 4088,
): Promise<{ result: Promise<OAuthCallbackResult>; port: number; server: Server }> {
  return new Promise((resolveStart, rejectStart) => {
    let resolveResult: (value: OAuthCallbackResult) => void
    let rejectResult: (reason: Error) => void

    const resultPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`)
      
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not Found')
        return
      }

      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      const state = url.searchParams.get('state') || undefined

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<html><body><h1>Authorization Failed</h1><p>${error}</p><p>You can close this window.</p></body></html>`)
        server.close()
        rejectResult!(new Error(`OAuth authorization failed: ${error}`))
        return
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<html><body><h1>Authorization Successful</h1><p>You can close this window and return to the terminal.</p></body></html>`)
        server.close()
        resolveResult!({ code, state })
        return
      }

      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Missing authorization code')
    })

    server.on('error', (err) => {
      rejectStart(err)
    })

    // Auto-close after 5 minutes
    const timeout = setTimeout(() => {
      server.close()
      rejectResult!(new Error('OAuth callback timed out after 5 minutes'))
    }, 5 * 60 * 1000)

    server.on('close', () => {
      clearTimeout(timeout)
    })

    server.listen(port, '127.0.0.1', () => {
      const addr = server.address()
      const actualPort = typeof addr === 'object' && addr ? addr.port : port
      resolveStart({ result: resultPromise, port: actualPort, server })
    })
  })
}
