// Versioned configuration and OAuth type definitions.

export const CONFIG_VERSION = 2 as const

export type Provider = 'gmail' | 'outlook'
export type AccountStatus = 'active' | 'needs_reauth'

export interface OAuthTokens {
  access_token: string
  refresh_token: string
  expires_at: number // Unix timestamp in ms
  token_type: string
  scope?: string
}

/**
 * Runtime account representation. `id` is the stable identity of an account;
 * aliases are user-editable display/lookup names only.
 */
export interface AccountConfig {
  id: string
  status: AccountStatus
  alias: string
  tag?: string
  provider: Provider
  email: string
  client_id: string
  /** Gmail desktop OAuth clients may include this non-confidential value. */
  client_secret?: string
  tokens: OAuthTokens
  /** Normalized scopes granted to this account. */
  scopes: string[]
  created_at: string
  updated_at: string
}

/**
 * Immutable account binding captured by an HTTP client.  The alias is kept
 * only for human-readable diagnostics; token writes are keyed by `id` and
 * guarded by the provider/client binding that produced the refresh token.
 */
export interface AccountTokenIdentity {
  id: string
  alias: string
  provider: Provider
  clientId: string
}

export interface AppConfig {
  version: typeof CONFIG_VERSION
  defaultAccountId: string | null
  accounts: AccountConfig[]
}

/** Always use this factory for mutable config state. */
export function createDefaultConfig(): AppConfig {
  return {
    version: CONFIG_VERSION,
    defaultAccountId: null,
    accounts: [],
  }
}

/** Immutable template retained for callers that only inspect defaults. */
export const DEFAULT_CONFIG: AppConfig = Object.freeze({
  version: CONFIG_VERSION,
  defaultAccountId: null,
  accounts: Object.freeze([]) as unknown as AccountConfig[],
})

export interface OAuthClientConfig {
  client_id: string
  client_secret?: string
  redirect_uri: string
}

export type AccountCapability =
  | 'mail.readWrite'
  | 'mail.send'
  | 'mail.settings.basic'
  | 'mail.settings.sharing'
  | 'mail.permanentDelete'

export const GMAIL_DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
] as const

export const GMAIL_FULL_ACCESS_SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.settings.basic',
] as const

export interface OAuthProviderConfig {
  authUrl: string
  tokenUrl: string
  scopes: readonly string[]
  fullAccessScopes?: readonly string[]
  extraAuthParams: Readonly<Record<string, string>>
  allowsClientSecret: boolean
}

// Gmail OAuth2 endpoints and the least-privilege default scope set.
export const GMAIL_AUTH = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: GMAIL_DEFAULT_SCOPES,
  fullAccessScopes: GMAIL_FULL_ACCESS_SCOPES,
  extraAuthParams: {
    access_type: 'offline',
    prompt: 'consent',
  },
  // Desktop client secrets identify the app but are not treated as confidential.
  allowsClientSecret: true,
} as const satisfies OAuthProviderConfig

// Outlook (Microsoft Graph) OAuth2 endpoints for a public native client.
export const OUTLOOK_AUTH = {
  authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  scopes: [
    'offline_access',
    'Mail.ReadWrite',
    'Mail.Send',
    'MailboxSettings.ReadWrite',
    'User.Read',
  ],
  extraAuthParams: {
    prompt: 'select_account',
  },
  // Microsoft native/public clients must never send a client secret.
  allowsClientSecret: false,
} as const satisfies OAuthProviderConfig

function scopeSet(account: AccountConfig): Set<string> {
  return new Set([
    ...(account.scopes ?? []),
    ...(account.tokens.scope ?? '').split(/\s+/).filter(Boolean),
  ])
}

/** Derive capabilities from the provider and scopes actually granted. */
export function deriveAccountCapabilities(account: AccountConfig): AccountCapability[] {
  if (account.status !== 'active') return []

  const scopes = scopeSet(account)
  const capabilities = new Set<AccountCapability>()

  if (account.provider === 'gmail') {
    const hasFullAccess = scopes.has('https://mail.google.com/')
    if (hasFullAccess || scopes.has('https://www.googleapis.com/auth/gmail.modify')) {
      capabilities.add('mail.readWrite')
      capabilities.add('mail.send')
    }
    if (scopes.has('https://www.googleapis.com/auth/gmail.settings.basic')) {
      capabilities.add('mail.settings.basic')
    }
    if (scopes.has('https://www.googleapis.com/auth/gmail.settings.sharing')) {
      capabilities.add('mail.settings.sharing')
    }
    if (hasFullAccess) capabilities.add('mail.permanentDelete')
  } else {
    if (scopes.has('Mail.ReadWrite')) capabilities.add('mail.readWrite')
    if (scopes.has('Mail.Send')) capabilities.add('mail.send')
    if (scopes.has('MailboxSettings.ReadWrite')) capabilities.add('mail.settings.basic')
    // Graph permanentDelete is available with Mail.ReadWrite.
    if (scopes.has('Mail.ReadWrite')) capabilities.add('mail.permanentDelete')
  }

  return [...capabilities]
}

export function hasAccountCapability(
  account: AccountConfig,
  capability: AccountCapability,
): boolean {
  return deriveAccountCapabilities(account).includes(capability)
}
