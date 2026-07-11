import { outputFailure, type ErrorPayload } from '../output/formatter.js'
import { redactSensitive, redactText } from './redact.js'

export class CliMailError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'CliMailError'
  }
}

export class AuthError extends CliMailError {
  constructor(message: string, details?: unknown) {
    super(message, 'AUTH_ERROR', 401, details)
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
    public suggestion?: string,
  ) {
    super(message, 'API_ERROR', statusCode, response)
    this.name = 'ApiError'
  }
}

export class RateLimitError extends ApiError {
  constructor(public retryAfterMs: number, response?: unknown) {
    super('Rate limit exceeded', 429, response)
    this.name = 'RateLimitError'
    this.code = 'RATE_LIMIT_ERROR'
  }
}

export class ConfigError extends CliMailError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIG_ERROR', undefined, details)
    this.name = 'ConfigError'
  }
}

export class AccountReauthRequiredError extends ConfigError {
  constructor(alias: string) {
    super(`Account "${alias}" must be reauthenticated`, { alias })
    this.name = 'AccountReauthRequiredError'
    this.code = 'ACCOUNT_REAUTH_REQUIRED'
  }
}

export class ProviderError extends CliMailError {
  constructor(message: string, public provider: string, details?: unknown) {
    super(message, 'PROVIDER_ERROR', undefined, details)
    this.name = 'ProviderError'
  }
}

/** Sentinel used to prevent duplicate formatting at the process boundary. */
export class HandledCliError extends Error {
  constructor(public exitCode: 1 | 2 = 1) {
    super('CLI error already handled')
    this.name = 'HandledCliError'
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function getSuggestion(error: unknown): string | undefined {
  if (error instanceof TokenExpiredError || error instanceof AuthError) {
    return 'Re-authenticate with: cli-mail account reauth [alias]'
  }
  if (error instanceof RateLimitError) {
    return `Rate limited. Retry after ${Math.ceil(error.retryAfterMs / 1000)} seconds.`
  }
  if (error instanceof ApiError) {
    if (error.suggestion) return error.suggestion
    const message = error.message.toLowerCase()
    const response = JSON.stringify(error.response ?? '').toLowerCase()
    if (error.statusCode === 403 && (message.includes('access_denied') || response.includes('access_denied'))) {
      return 'Verify the OAuth app consent configuration and that this account is allowed to use it.'
    }
    if (error.statusCode === 503 || message.includes('transient') || message.includes('temporarily unavailable')) {
      return 'The provider is temporarily unavailable. Retry in a few seconds.'
    }
    if (error.statusCode === 404) return 'The resource may have been deleted or its ID is invalid.'
    if (error.statusCode === 400) return 'Check the command parameters and try again.'
  }
  if (error instanceof CliMailError && error.code === 'ACCOUNT_REAUTH_REQUIRED') {
    return 'Re-authenticate with: cli-mail account reauth [alias]'
  }
  if (error instanceof CliMailError && error.code === 'SEND_OUTCOME_UNKNOWN') {
    return 'Check Sent Items for the draft ID before retrying, to avoid sending a duplicate.'
  }
  if (error instanceof ConfigError) {
    if (error.message.includes('not found')) return 'Run "cli-mail account list" to see available accounts.'
    if (error.message.includes('No default account')) return 'Add an account first: cli-mail account add gmail|outlook'
  }
  return undefined
}

export function toErrorPayload(error: unknown): ErrorPayload {
  const suggestion = getSuggestion(error)
  if (error instanceof CliMailError) {
    return {
      code: error.code,
      message: redactText(error.message),
      ...(error.statusCode !== undefined ? { statusCode: error.statusCode } : {}),
      ...(error.details !== undefined ? { details: redactSensitive(error.details) } : {}),
      ...(suggestion ? { suggestion: redactText(suggestion) } : {}),
    }
  }
  if (error instanceof Error) {
    return {
      code: 'UNKNOWN_ERROR',
      message: redactText(error.message),
      ...(suggestion ? { suggestion: redactText(suggestion) } : {}),
    }
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: redactText(String(error)),
    ...(suggestion ? { suggestion: redactText(suggestion) } : {}),
  }
}

/** Kept as a pure formatter for library callers and tests. */
export function formatErrorOutput(error: unknown): string {
  return JSON.stringify({ ok: false, error: toErrorPayload(error) }, null, 2)
}

export function handleError(error: unknown): never {
  if (error instanceof HandledCliError) throw error
  outputFailure(toErrorPayload(error))
  process.exitCode = 1
  throw new HandledCliError(1)
}
