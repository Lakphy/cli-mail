import {
  createAccount,
  finalizeMigration,
  getAccount,
  getAccountsByTag,
  getMigrationStatus,
  loadConfig,
  removeAccount,
  reauthorizeAccount,
  renameAccount,
  setAccountTag,
  setDefaultAccount,
  validateTag,
} from '../config/store.js'
import { deriveAccountCapabilities, type Provider } from '../config/types.js'
import { gmailAuthFlow, readGmailDesktopCredentials } from '../providers/gmail/auth.js'
import { outlookAuthFlow } from '../providers/outlook/auth.js'
import { output, outputList, outputSuccess } from '../output/formatter.js'
import { ConfigError, handleError } from '../utils/error.js'

interface AccountAuthOptions {
  alias?: string
  tag?: string
  credentialsFile?: string
  clientId?: string
  fullAccess?: boolean
}

export async function accountAdd(provider: string, options: AccountAuthOptions = {}): Promise<void> {
  try {
    const validProvider = validateProvider(provider)
    if (options.tag) validateTag(options.tag)
    if (options.alias && loadConfig().accounts.some((account) => account.alias === options.alias)) {
      throw new ConfigError(
        `Account alias already exists: ${options.alias}. Use account reauth or choose another alias.`,
      )
    }

    const result = await authorize(validProvider, options)
    const alias = options.alias ?? result.email
    createAccount({
      alias,
      ...(options.tag ? { tag: options.tag } : {}),
      provider: validProvider,
      email: result.email,
      client_id: result.clientId,
      ...(result.clientSecret ? { client_secret: result.clientSecret } : {}),
      tokens: result.tokens,
    })

    outputSuccess(`Account added: ${alias} (${result.email}) [${validProvider}]`, {
      alias,
      email: result.email,
      provider: validProvider,
      fullAccess: validProvider === 'gmail' && options.fullAccess === true,
    })
  } catch (error) {
    handleError(error)
  }
}

export async function accountReauth(
  alias: string | undefined,
  options: Omit<AccountAuthOptions, 'alias' | 'tag'> = {},
): Promise<void> {
  try {
    const current = getAccount(alias)
    const authOptions: AccountAuthOptions = {
      ...options,
      ...(current.provider === 'outlook' && !options.clientId && current.status === 'active'
        ? { clientId: current.client_id }
        : {}),
    }
    const result = await authorize(current.provider, authOptions)
    reauthorizeAccount(current.id, {
      email: result.email,
      client_id: result.clientId,
      ...(result.clientSecret ? { client_secret: result.clientSecret } : {}),
      tokens: result.tokens,
    })
    outputSuccess(`Account reauthorized: ${current.alias}`, {
      alias: current.alias,
      provider: current.provider,
      fullAccess: current.provider === 'gmail' && options.fullAccess === true,
    })
  } catch (error) {
    handleError(error)
  }
}

export function accountRemove(alias: string): void {
  try {
    removeAccount(alias)
    outputSuccess(`Account removed: ${alias}`, { alias })
  } catch (error) {
    handleError(error)
  }
}

export function accountList(options: { tag?: string } = {}): void {
  try {
    const config = loadConfig()
    const accounts = options.tag
      ? getAccountsByTag(options.tag, config)
      : config.accounts

    const sorted = [...accounts].sort((left, right) => {
      const tagOrder = (left.tag ?? '').localeCompare(right.tag ?? '')
      return tagOrder || left.alias.localeCompare(right.alias)
    })
    outputList(
      sorted.map((account) => ({
        id: account.id,
        alias: account.alias,
        tag: account.tag ?? 'default',
        provider: account.provider,
        email: account.email,
        status: account.status,
        default: account.id === config.defaultAccountId,
        capabilities: deriveAccountCapabilities(account),
        created: account.created_at,
      })),
      [
        { key: 'alias', label: 'Alias' },
        { key: 'tag', label: 'Tag' },
        { key: 'provider', label: 'Provider' },
        { key: 'email', label: 'Email' },
        { key: 'status', label: 'Status' },
        { key: 'default', label: 'Default' },
      ],
    )
  } catch (error) {
    handleError(error)
  }
}

export function accountSwitch(alias: string): void {
  try {
    setDefaultAccount(alias)
    outputSuccess(`Default account set to: ${alias}`, { alias })
  } catch (error) {
    handleError(error)
  }
}

export function accountInfo(alias?: string): void {
  try {
    const account = getAccount(alias)
    output({
      id: account.id,
      status: account.status,
      alias: account.alias,
      tag: account.tag ?? 'default',
      provider: account.provider,
      email: account.email,
      created_at: account.created_at,
      updated_at: account.updated_at,
      token_expires_at: account.tokens.expires_at
        ? new Date(account.tokens.expires_at).toISOString()
        : null,
      scopes: account.scopes,
      capabilities: deriveAccountCapabilities(account),
    })
  } catch (error) {
    handleError(error)
  }
}

export function accountRename(oldAlias: string, newAlias: string): void {
  try {
    renameAccount(oldAlias, newAlias)
    outputSuccess(`Account renamed: ${oldAlias} → ${newAlias}`, { oldAlias, newAlias })
  } catch (error) {
    handleError(error)
  }
}

export async function accountValidate(alias?: string): Promise<void> {
  try {
    const config = loadConfig()
    const selected = alias
      ? config.accounts.find((account) => account.alias === alias)
      : undefined
    if (alias && !selected) throw new ConfigError(`Account not found: ${alias}`)
    const accounts = selected ? [selected] : config.accounts
    const now = Date.now()
    const results = accounts.map((account) => ({
      id: account.id,
      alias: account.alias,
      email: account.email,
      provider: account.provider,
      status: account.status,
      token_valid: account.status === 'active' && account.tokens.expires_at > now,
      token_expires_at: account.tokens.expires_at
        ? new Date(account.tokens.expires_at).toISOString()
        : null,
      alias_unique: config.accounts.filter((candidate) => candidate.alias === account.alias).length === 1,
      capabilities: deriveAccountCapabilities(account),
      ...(account.status === 'needs_reauth'
        ? { issue: `Reauthorize with: cli-mail account reauth ${account.alias}` }
        : {}),
    }))
    const defaultValid = config.defaultAccountId === null
      ? config.accounts.length === 0
      : config.accounts.some((account) => account.id === config.defaultAccountId)
    const warnings = defaultValid
      ? []
      : [`Default account id "${config.defaultAccountId}" is not present in the account list.`]

    output({
      defaultAccountId: config.defaultAccountId,
      defaultAccountValid: defaultValid,
      accounts: results,
    }, { warnings })
  } catch (error) {
    handleError(error)
  }
}

export function accountTag(alias: string, tag?: string, remove?: boolean): void {
  try {
    if (remove) {
      setAccountTag(alias, null)
      outputSuccess(`Tag removed from account: ${alias}`, { alias, tag: null })
    } else if (tag) {
      setAccountTag(alias, tag)
      outputSuccess(`Account "${alias}" tagged as: ${tag}`, { alias, tag })
    } else {
      const account = getAccount(alias)
      output({ alias: account.alias, tag: account.tag ?? 'default' })
    }
  } catch (error) {
    handleError(error)
  }
}

export function accountMigrationStatus(): void {
  try {
    output(getMigrationStatus())
  } catch (error) {
    handleError(error)
  }
}

export function accountMigrationFinalize(): void {
  try {
    finalizeMigration()
    outputSuccess('Configuration migration finalized')
  } catch (error) {
    handleError(error)
  }
}

async function authorize(provider: Provider, options: AccountAuthOptions) {
  if (provider === 'gmail') {
    if (!options.credentialsFile) {
      throw new ConfigError('Gmail requires --credentials-file with an OAuth Desktop app JSON file')
    }
    if (options.clientId) throw new ConfigError('Use --credentials-file, not --client-id, for Gmail')
    const credentials = readGmailDesktopCredentials(options.credentialsFile)
    const result = await gmailAuthFlow({
      credentialsFile: options.credentialsFile,
      fullAccess: options.fullAccess,
    })
    return { ...result, ...credentials }
  }

  if (options.credentialsFile) throw new ConfigError('Use --client-id, not --credentials-file, for Outlook')
  if (options.fullAccess) throw new ConfigError('--full-access is only valid for Gmail')
  if (!options.clientId) {
    throw new ConfigError('Outlook requires --client-id for a public/native application')
  }
  const result = await outlookAuthFlow({ clientId: options.clientId })
  return { ...result, clientId: options.clientId, clientSecret: undefined }
}

function validateProvider(provider: string): Provider {
  if (provider !== 'gmail' && provider !== 'outlook') {
    throw new ConfigError(`Invalid provider: ${provider}. Must be "gmail" or "outlook"`)
  }
  return provider
}
