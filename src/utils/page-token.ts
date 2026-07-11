import type { AccountConfig, Provider } from '../config/types.js'
import { ConfigError } from './error.js'

export type PageTokenContext = Record<string, string>

interface PageTokenPayloadV2 {
  v: 2
  accountId: string
  provider: Provider
  operation: string
  cursor: string
  context?: PageTokenContext
}

export interface DecodedPageToken {
  cursor: string
  context?: PageTokenContext
}

/**
 * Restore an option captured by a v2 page token. An omitted option inherits the
 * first-page value; an explicitly repeated option must be identical.
 */
export function resolvePageTokenOption(
  state: DecodedPageToken | undefined,
  key: string,
  explicitValue: string | undefined,
  optionName = `--${key}`,
): string | undefined {
  if (!state) return explicitValue
  const storedValue = state.context?.[key]
  if (explicitValue !== undefined && explicitValue !== storedValue) {
    throw new ConfigError(`The supplied ${optionName} value does not match this page token`)
  }
  return storedValue
}

export function createPageTokenContext(
  values: Record<string, string | undefined>,
): PageTokenContext {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

export function encodePageToken(
  account: Pick<AccountConfig, 'id' | 'provider'>,
  operation: string,
  cursor: string | undefined,
  context?: PageTokenContext,
): string | undefined {
  if (!cursor) return undefined
  const payload: PageTokenPayloadV2 = {
    v: 2,
    accountId: account.id,
    provider: account.provider,
    operation,
    cursor,
    ...(context ? { context } : {}),
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodePageToken(
  token: string | undefined,
  account: Pick<AccountConfig, 'id' | 'provider'>,
  operation: string,
): string | undefined {
  return decodePageTokenState(token, account, operation)?.cursor
}

export function decodePageTokenState(
  token: string | undefined,
  account: Pick<AccountConfig, 'id' | 'provider'>,
  operation: string,
): DecodedPageToken | undefined {
  if (!token) return undefined
  if (token.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw invalidToken()
  }

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as unknown
  } catch {
    throw invalidToken()
  }
  if (isLegacyPageTokenPayload(payload)) {
    throw new ConfigError(
      'Page tokens created by cli-mail 0.2.0 are no longer supported. Run the command again without --page-token to start from the first page.',
    )
  }
  if (!isPageTokenPayload(payload)
    || payload.accountId !== account.id
    || payload.provider !== account.provider
    || payload.operation !== operation) {
    throw invalidToken()
  }
  return {
    cursor: payload.cursor,
    ...(payload.context ? { context: payload.context } : {}),
  }
}

function isPageTokenPayload(value: unknown): value is PageTokenPayloadV2 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  return payload.v === 2
    && typeof payload.accountId === 'string'
    && (payload.provider === 'gmail' || payload.provider === 'outlook')
    && typeof payload.operation === 'string'
    && typeof payload.cursor === 'string'
    && payload.cursor.length > 0
    && (payload.context === undefined || isStringRecord(payload.context))
}

function isLegacyPageTokenPayload(value: unknown): boolean {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).v === 1
}

function isStringRecord(value: unknown): value is PageTokenContext {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((item) => typeof item === 'string')
}

function invalidToken(): ConfigError {
  return new ConfigError(
    'Invalid or mismatched page token. Use the nextToken returned by the same account and operation.',
  )
}
