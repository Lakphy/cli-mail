// Provider client factory — creates the right client based on account provider

import {
  hasAccountCapability,
  type AccountCapability,
  type AccountConfig,
  type Provider,
} from '../config/types.js'
import type { HttpClient } from '../utils/http.js'
import { createGmailClient } from '../providers/gmail/client.js'
import { createOutlookClient } from '../providers/outlook/client.js'
import { getActiveAccount } from '../config/store.js'
import { getGlobalAccount } from '../config/context.js'
import { CliMailError, ProviderError } from '../utils/error.js'

export interface ResolvedAccount {
  account: AccountConfig
  client: HttpClient
}

export function resolveAccount(alias?: string): ResolvedAccount {
  // Subcommand's --account takes precedence, then global --account, then default
  const effectiveAlias = alias || getGlobalAccount()
  const account = getActiveAccount(effectiveAlias)
  const client = createClientForAccount(account)
  return { account, client }
}

export function createClientForAccount(account: AccountConfig): HttpClient {
  return account.provider === 'gmail'
    ? createGmailClient(account)
    : createOutlookClient(account)
}

export function requireProvider(
  account: Pick<AccountConfig, 'provider'>,
  provider: Provider,
  explanation: string,
): void {
  if (account.provider !== provider) {
    throw new ProviderError(explanation, account.provider)
  }
}

export function requireCapability(
  account: AccountConfig,
  capability: AccountCapability,
  explanation?: string,
): void {
  if (hasAccountCapability(account, capability)) return
  const message = explanation ?? (account.provider === 'gmail'
    ? 'Permanent deletion requires Gmail full access. Reauthorize with --full-access.'
    : 'This account is not authorized for permanent deletion.')
  throw new CliMailError(message, 'CAPABILITY_REQUIRED')
}
