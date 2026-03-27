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

export function formatErrorOutput(error: unknown): string {
  if (error instanceof CliMailError) {
    return JSON.stringify(
      {
        error: error.message,
        code: error.code,
        ...(error.statusCode ? { statusCode: error.statusCode } : {}),
        ...(error instanceof ApiError && error.response
          ? { details: error.response }
          : {}),
      },
      null,
      2,
    )
  }

  if (error instanceof Error) {
    return JSON.stringify({ error: error.message, code: 'UNKNOWN_ERROR' }, null, 2)
  }

  return JSON.stringify({ error: String(error), code: 'UNKNOWN_ERROR' }, null, 2)
}

export function handleError(error: unknown): never {
  process.stderr.write(formatErrorOutput(error) + '\n')
  process.exit(1)
}
