// HTTP client wrapper with authentication, bounded retries, and token refresh.

import { createHash } from 'node:crypto'
import { ApiError, RateLimitError, AuthError, CliMailError } from './error.js'
import type { AccountTokenIdentity, OAuthTokens } from '../config/types.js'
import { updateAccountTokens } from '../config/store.js'

export interface HttpClientOptions {
  baseUrl: string
  getTokens: () => OAuthTokens
  refreshTokens: () => Promise<OAuthTokens>
  accountIdentity: AccountTokenIdentity
  defaultHeaders?: Record<string, string>
  timeoutMs?: number
  /** Exact hosts (or their subdomains) allowed for pre-authenticated upload URLs. */
  allowedUnauthenticatedHosts?: string[]
  /** Provider-specific classifier for 403 responses that represent rate limits. */
  isRetryableForbidden?: (body: unknown) => boolean
}

interface RequestOptions {
  body?: unknown
  query?: Record<string, string | number | boolean | string[] | undefined>
  headers?: Record<string, string>
  rawBody?: string | Buffer
  rawResponse?: boolean
  authenticated?: boolean
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3

export class HttpClient {
  private readonly baseUrl: string
  private readonly baseOrigin: string
  private readonly getTokens: () => OAuthTokens
  private readonly refreshTokens: () => Promise<OAuthTokens>
  private readonly accountIdentity: AccountTokenIdentity
  private readonly defaultHeaders: Record<string, string>
  private readonly timeoutMs: number
  private readonly allowedUnauthenticatedHosts: string[]
  private readonly isRetryableForbidden?: (body: unknown) => boolean
  private refreshPromise?: Promise<OAuthTokens>

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl
    this.baseOrigin = new URL(options.baseUrl).origin
    this.getTokens = options.getTokens
    this.refreshTokens = options.refreshTokens
    this.accountIdentity = { ...options.accountIdentity }
    this.defaultHeaders = { ...options.defaultHeaders }
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.allowedUnauthenticatedHosts = options.allowedUnauthenticatedHosts ?? []
    this.isRetryableForbidden = options.isRetryableForbidden
  }

  private async refreshAndPersist(): Promise<OAuthTokens> {
    if (!this.refreshPromise) {
      const expectedRefreshTokenBinding = createHash('sha256')
        .update('cli-mail-refresh-token\0')
        .update(this.getTokens().refresh_token)
        .digest('hex')
      this.refreshPromise = this.refreshTokens()
        .then(async (tokens) => {
          await updateAccountTokens(
            this.accountIdentity,
            tokens,
            expectedRefreshTokenBinding,
          )
          return tokens
        })
        .finally(() => {
          this.refreshPromise = undefined
        })
    }
    return this.refreshPromise
  }

  private buildUrl(
    path: string,
    query?: RequestOptions['query'],
    authenticated = true,
  ): string {
    const absolute = /^https?:\/\//i.test(path)
    if (!absolute && containsDotPathSegment(path)) {
      throw new CliMailError(
        'Refusing relative URL with a dot path segment',
        'UNSAFE_URL',
      )
    }
    const url = new URL(absolute ? path : `${this.baseUrl}${path}`)

    if (authenticated && url.origin !== this.baseOrigin) {
      throw new CliMailError(
        `Refusing to send credentials to untrusted origin: ${url.origin}`,
        'UNSAFE_URL',
      )
    }

    if (!authenticated) {
      if (url.protocol !== 'https:') {
        throw new CliMailError('Unauthenticated external requests require HTTPS', 'UNSAFE_URL')
      }
      const allowed = this.allowedUnauthenticatedHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
      if (!allowed) {
        throw new CliMailError(
          `External upload host is not allowed: ${url.hostname}`,
          'UNSAFE_URL',
        )
      }
    }

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue
        if (Array.isArray(value)) {
          url.searchParams.delete(key)
          for (const item of value) url.searchParams.append(key, item)
        } else {
          url.searchParams.set(key, String(value))
        }
      }
    }

    return url.toString()
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
    authRetried = false,
    attempt = 1,
  ): Promise<T> {
    const authenticated = options.authenticated !== false
    let tokens = this.getTokens()

    if (authenticated && tokens.expires_at && Date.now() >= tokens.expires_at - 60_000) {
      try {
        tokens = await this.refreshAndPersist()
      } catch {
        throw new AuthError('Token refresh failed. Please re-authenticate with: cli-mail account reauth')
      }
    }

    const url = this.buildUrl(path, options.query, authenticated)
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...options.headers,
    }
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'authorization') delete headers[key]
    }
    if (authenticated) headers.Authorization = `Bearer ${tokens.access_token}`

    let fetchBody: string | Buffer | undefined
    if (options.rawBody !== undefined) {
      fetchBody = options.rawBody
    } else if (options.body !== undefined) {
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
      fetchBody = JSON.stringify(options.body)
    }

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers,
        body: fetchBody,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'manual',
      })
    } catch (error) {
      return this.handleTransportFailure<T>(
        error,
        method,
        path,
        options,
        authRetried,
        attempt,
      )
    }

    if (authenticated && response.status === 401 && !authRetried) {
      await response.body?.cancel().catch(() => undefined)
      try {
        await this.refreshAndPersist()
        return this.request<T>(method, path, options, true, attempt)
      } catch {
        throw new AuthError('Authentication failed. Please re-authenticate with: cli-mail account reauth')
      }
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined)
      throw new AuthError('Authentication failed after token refresh. Please re-authenticate.')
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined)
      throw new CliMailError(
        `Refusing HTTP redirect for ${method} request`,
        'UNSAFE_REDIRECT',
        response.status,
      )
    }

    if (response.ok) {
      if (options.rawResponse) return mapRawResponseErrors(response, this.timeoutMs) as unknown as T
      if (response.status === 204) return undefined as T

      let text: string
      try {
        text = await response.text()
      } catch (error) {
        return this.handleTransportFailure<T>(
          error,
          method,
          path,
          options,
          authRetried,
          attempt,
          response,
        )
      }
      if (!text) return undefined as T
      try {
        return JSON.parse(text) as T
      } catch {
        return text as T
      }
    }

    let errorBody: unknown
    try {
      errorBody = await readErrorBody(response)
    } catch (error) {
      return this.handleTransportFailure<T>(
        error,
        method,
        path,
        options,
        authRetried,
        attempt,
        response,
      )
    }
    const retryableForbidden = response.status === 403
      && this.isRetryableForbidden?.(errorBody) === true
    const retryable = RETRYABLE_STATUS.has(response.status) || retryableForbidden
    if (method === 'GET' && retryable && attempt < MAX_ATTEMPTS) {
      await delay(retryDelayMs(response.headers.get('Retry-After'), attempt))
      return this.request<T>(method, path, options, authRetried, attempt + 1)
    }

    if (response.status === 429 || retryableForbidden) {
      throw new RateLimitError(
        retryDelayMs(response.headers.get('Retry-After'), attempt),
        errorBody,
      )
    }

    throw new ApiError(extractErrorMessage(errorBody, response), response.status, errorBody)
  }

  private async handleTransportFailure<T>(
    error: unknown,
    method: string,
    path: string,
    options: RequestOptions,
    authRetried: boolean,
    attempt: number,
    response?: Response,
  ): Promise<T> {
    await response?.body?.cancel().catch(() => undefined)
    if (method === 'GET'
      && options.rawResponse !== true
      && attempt < MAX_ATTEMPTS
      && isRetryableNetworkError(error)) {
      await delay(backoffMs(attempt))
      return this.request<T>(method, path, options, authRetried, attempt + 1)
    }
    throw mapTransportError(error, this.timeoutMs)
  }

  async get<T>(path: string, query?: RequestOptions['query'], headers?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, { query, headers })
  }

  async post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, { body, headers })
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body })
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, { body })
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }

  async getRaw(path: string, query?: RequestOptions['query'], headers?: Record<string, string>): Promise<Response> {
    return this.request<Response>('GET', path, { query, headers, rawResponse: true })
  }

  async putRawUnauthenticated(
    path: string,
    rawBody: string | Buffer,
    headers?: Record<string, string>,
  ): Promise<Response> {
    return this.request<Response>('PUT', path, {
      rawBody,
      headers,
      authenticated: false,
      rawResponse: true,
    })
  }
}

const MAX_ERROR_BODY_BYTES = 64 * 1024

async function readErrorBody(response: Response): Promise<unknown> {
  if (!response.body) return response.statusText

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  let truncated = false
  try {
    while (total < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = MAX_ERROR_BODY_BYTES - total
      const accepted = value.byteLength > remaining ? value.subarray(0, remaining) : value
      chunks.push(Buffer.from(accepted))
      total += accepted.byteLength
      if (accepted.byteLength < value.byteLength) {
        truncated = true
        break
      }
    }
    if (total >= MAX_ERROR_BODY_BYTES) truncated = true
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined)
  }

  const text = Buffer.concat(chunks, total).toString('utf8')
  if (!text) return response.statusText
  if (!truncated) {
    try {
      return JSON.parse(text) as unknown
    } catch {
      // Fall through to bounded text.
    }
  }
  return truncated ? `${text}\n[response truncated]` : text
}

function extractErrorMessage(body: unknown, response: Response): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.message === 'string') return record.message
    const nested = record.error
    if (nested && typeof nested === 'object' && typeof (nested as Record<string, unknown>).message === 'string') {
      return (nested as Record<string, unknown>).message as string
    }
  }
  if (typeof body === 'string' && body) return body
  return response.statusText || `API request failed with status ${response.status}`
}

function retryDelayMs(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000)
    const date = Date.parse(retryAfter)
    if (!Number.isNaN(date)) return Math.min(Math.max(0, date - Date.now()), 60_000)
  }
  return backoffMs(attempt)
}

function backoffMs(attempt: number): number {
  const ceiling = Math.min(1000 * 2 ** (attempt - 1), 10_000)
  return Math.max(50, Math.floor(Math.random() * ceiling))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function containsDotPathSegment(path: string): boolean {
  let candidate = path.split(/[?#]/, 1)[0]
  for (let depth = 0; depth < 4; depth += 1) {
    if (candidate.split(/[\\/]/).some((segment) => segment === '.' || segment === '..')) {
      return true
    }
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) return false
      candidate = decoded
    } catch {
      return false
    }
  }
  return candidate.split(/[\\/]/).some((segment) => segment === '.' || segment === '..')
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === 'TimeoutError'
      || error.name === 'AbortError'
      || (error as NodeJS.ErrnoException).code === 'ABORT_ERR')
}

function mapTransportError(error: unknown, timeoutMs: number): unknown {
  if (isTimeoutError(error)) {
    return new CliMailError(`Request timed out after ${timeoutMs}ms`, 'REQUEST_TIMEOUT')
  }
  return error
}

/**
 * `fetch()` resolves as soon as headers arrive, while its timeout signal also
 * governs later body reads.  Wrap raw bodies so callers receive the same
 * stable timeout error as buffered requests.  Raw streams are deliberately
 * never replayed because consumers may already have observed bytes.
 */
function mapRawResponseErrors(response: Response, timeoutMs: number): Response {
  if (!response.body) return response

  const reader = response.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) controller.close()
        else controller.enqueue(chunk.value)
      } catch (error) {
        await reader.cancel(error).catch(() => undefined)
        controller.error(mapTransportError(error, timeoutMs))
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined)
    },
  })

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function isRetryableNetworkError(error: unknown): boolean {
  return isTimeoutError(error)
    || error instanceof TypeError
    || (error instanceof Error && ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes((error as NodeJS.ErrnoException).code ?? ''))
}
