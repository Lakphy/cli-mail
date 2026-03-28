// HTTP client wrapper with auth, token refresh, and rate limiting

import { ApiError, RateLimitError, AuthError } from './error.js'
import type { OAuthTokens } from '../config/types.js'
import { updateAccountTokens } from '../config/store.js'

export interface HttpClientOptions {
  baseUrl: string
  getTokens: () => OAuthTokens
  refreshTokens: () => Promise<OAuthTokens>
  accountAlias: string
}

export class HttpClient {
  private baseUrl: string
  private getTokens: () => OAuthTokens
  private refreshTokens: () => Promise<OAuthTokens>
  private accountAlias: string

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl
    this.getTokens = options.getTokens
    this.refreshTokens = options.refreshTokens
    this.accountAlias = options.accountAlias
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown
      query?: Record<string, string | number | boolean | string[] | undefined>
      headers?: Record<string, string>
      rawBody?: string | Buffer
      rawResponse?: boolean
    } = {},
    retried = false,
  ): Promise<T> {
    let tokens = this.getTokens()

    // Check if token is expired
    if (tokens.expires_at && Date.now() >= tokens.expires_at - 60_000) {
      try {
        tokens = await this.refreshTokens()
        updateAccountTokens(this.accountAlias, tokens)
      } catch {
        throw new AuthError('Token refresh failed. Please re-authenticate with: cli-mail account add')
      }
    }

    // Build URL with query params
    let url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    if (options.query) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined) continue
        if (Array.isArray(value)) {
          // Support repeated query params (e.g. metadataHeaders=From&metadataHeaders=To)
          for (const item of value) {
            params.append(key, String(item))
          }
        } else {
          params.set(key, String(value))
        }
      }
      const qs = params.toString()
      if (qs) {
        url += `?${qs}`
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${tokens.access_token}`,
      ...options.headers,
    }

    let fetchBody: string | Buffer | undefined
    if (options.rawBody !== undefined) {
      fetchBody = options.rawBody
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      fetchBody = JSON.stringify(options.body)
    }

    const response = await fetch(url, {
      method,
      headers,
      body: fetchBody,
    })

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After')
      const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000
      throw new RateLimitError(retryMs, await response.json().catch(() => null))
    }

    // Handle auth errors with retry
    if (response.status === 401 && !retried) {
      try {
        const newTokens = await this.refreshTokens()
        updateAccountTokens(this.accountAlias, newTokens)
        return this.request<T>(method, path, options, true)
      } catch {
        throw new AuthError('Authentication failed. Please re-authenticate.')
      }
    }

    if (response.status === 401) {
      throw new AuthError('Authentication failed after token refresh. Please re-authenticate.')
    }

    // Handle raw response (for downloads)
    if (options.rawResponse) {
      return response as unknown as T
    }

    // Handle no content
    if (response.status === 204) {
      return undefined as T
    }

    // Handle error responses
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: response.statusText }))
      throw new ApiError(
        (errorBody as Record<string, unknown>).message as string
          || (errorBody as { error?: { message?: string } }).error?.message
          || `API request failed with status ${response.status}`,
        response.status,
        errorBody,
      )
    }

    // Parse JSON response
    const text = await response.text()
    if (!text) {
      return undefined as T
    }

    try {
      return JSON.parse(text) as T
    } catch {
      return text as T
    }
  }

  async get<T>(path: string, query?: Record<string, string | number | boolean | string[] | undefined>, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, { query, headers })
  }

  async post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, { body, headers })
  }

  async postRaw<T>(path: string, rawBody: string | Buffer, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, { rawBody, headers })
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

  async getRaw(path: string, query?: Record<string, string | number | boolean | string[] | undefined>): Promise<Response> {
    return this.request<Response>('GET', path, { query, rawResponse: true })
  }
}
