// Provider client factory — creates the right client based on account provider

import type { AccountConfig } from '../config/types.js'
import type { HttpClient } from '../utils/http.js'
import { createGmailClient } from '../providers/gmail/client.js'
import { createOutlookClient } from '../providers/outlook/client.js'
import { getAccount } from '../config/store.js'

export interface ResolvedAccount {
  account: AccountConfig
  client: HttpClient
}

export function resolveAccount(alias?: string): ResolvedAccount {
  const account = getAccount(alias)
  const client =
    account.provider === 'gmail'
      ? createGmailClient(account)
      : createOutlookClient(account)

  return { account, client }
}
