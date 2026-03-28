// Standardized error types for CLI mail

export class CliMailError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
  ) {
    super(message)
    this.name = 'CliMailError'
  }
}

export class AuthError extends CliMailError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401)
    this.name = 'AuthError'
  }
}

export class TokenExpiredError extends AuthError {
  constructor() {
    super('Access token expired and refresh failed')
    this.name = 'TokenExpiredError'
  }
}

export class ApiError extends CliMailError {
  constructor(
    message: string,
    statusCode: number,
    public response?: unknown,
  ) {
    super(message, 'API_ERROR', statusCode)
    this.name = 'ApiError'
  }
}

export class RateLimitError extends ApiError {
  constructor(
    public retryAfterMs: number,
    response?: unknown,
  ) {
    super('Rate limit exceeded', 429, response)
    this.name = 'RateLimitError'
  }
}

export class ConfigError extends CliMailError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR')
    this.name = 'ConfigError'
  }
}

export class ProviderError extends CliMailError {
  constructor(message: string, public provider: string) {
    super(message, 'PROVIDER_ERROR')
    this.name = 'ProviderError'
  }
}

/**
 * Generate an actionable suggestion based on the error type and message.
 */
function getSuggestion(error: unknown): string | undefined {
  if (error instanceof TokenExpiredError || error instanceof AuthError) {
    return 'Re-authenticate with: cli-mail account add <provider>'
  }

  if (error instanceof RateLimitError) {
    const seconds = Math.ceil(error.retryAfterMs / 1000)
    return `Rate limited. Retry after ${seconds} seconds.`
  }

  if (error instanceof ApiError) {
    const msg = error.message?.toLowerCase() || ''
    const responseStr = JSON.stringify(error.response || '').toLowerCase()

    // $orderBy + $search conflict
    if (msg.includes('$orderby') || msg.includes('orderby') || responseStr.includes('orderbywithsearch')) {
      return 'Search does not support sorting. Use "cli-mail msg list" with --query instead, or upgrade to the latest version where this is fixed.'
    }

    // OAuth 403 — test user not added
    if (error.statusCode === 403 && (msg.includes('access_denied') || msg.includes('not configured') || responseStr.includes('access_denied'))) {
      return 'OAuth app may be in testing mode. Go to Google Cloud Console → OAuth consent screen → Test users, and add your email address.'
    }

    // 503 transient server error
    if (error.statusCode === 503 || msg.includes('transient') || msg.includes('temporarily unavailable')) {
      return 'Server temporarily unavailable. Retry in a few seconds.'
    }

    // 404 — resource not found
    if (error.statusCode === 404) {
      return 'Resource not found. The message, folder, or account may have been deleted or the ID is invalid.'
    }

    // 400 — bad request
    if (error.statusCode === 400) {
      return 'Bad request. Check the command parameters and try again.'
    }
  }

  if (error instanceof ConfigError) {
    const msg = error.message || ''
    if (msg.includes('not found')) {
      return 'Run "cli-mail account list" to see available accounts.'
    }
    if (msg.includes('No default account')) {
      return 'Add an account first: cli-mail account add gmail (or outlook)'
    }
  }

  return undefined
}

export function formatErrorOutput(error: unknown): string {
  const suggestion = getSuggestion(error)

  if (error instanceof CliMailError) {
    return JSON.stringify(
      {
        error: error.message,
        code: error.code,
        ...(error.statusCode ? { statusCode: error.statusCode } : {}),
        ...(error instanceof ApiError && error.response
          ? { details: error.response }
          : {}),
        ...(suggestion ? { suggestion } : {}),
      },
      null,
      2,
    )
  }

  if (error instanceof Error) {
    return JSON.stringify({
      error: error.message,
      code: 'UNKNOWN_ERROR',
      ...(suggestion ? { suggestion } : {}),
    }, null, 2)
  }

  return JSON.stringify({
    error: String(error),
    code: 'UNKNOWN_ERROR',
    ...(suggestion ? { suggestion } : {}),
  }, null, 2)
}

export function handleError(error: unknown): never {
  process.stderr.write(formatErrorOutput(error) + '\n')
  process.exit(1)
}

