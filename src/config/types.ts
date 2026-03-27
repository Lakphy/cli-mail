// Config type definitions

export type Provider = 'gmail' | 'outlook'

export interface OAuthTokens {
  access_token: string
  refresh_token: string
  expires_at: number // Unix timestamp in ms
  token_type: string
  scope?: string
}

export interface AccountConfig {
  alias: string
  provider: Provider
  email: string
  client_id: string
  client_secret: string
  tokens: OAuthTokens
  created_at: string
  updated_at: string
}

export interface AppConfig {
  default_account: string | null
  accounts: AccountConfig[]
}

export const DEFAULT_CONFIG: AppConfig = {
  default_account: null,
  accounts: [],
}

export interface OAuthClientConfig {
  client_id: string
  client_secret: string
  redirect_uri: string
}

// Gmail OAuth2 endpoints
export const GMAIL_AUTH = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: ['https://mail.google.com/'],
} as const

// Outlook (Microsoft Graph) OAuth2 endpoints
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
} as const
