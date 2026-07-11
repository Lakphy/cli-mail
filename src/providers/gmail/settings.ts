// Gmail settings operations

import type { HttpClient } from '../../utils/http.js'
import type { MailboxSettings } from '../types.js'
import { z } from 'zod'
import { CliMailError, ConfigError, errorMessage } from '../../utils/error.js'

interface GmailVacationSettings {
  enableAutoReply: boolean
  responseSubject?: string
  responseBodyPlainText?: string
  responseBodyHtml?: string
  restrictToContacts?: boolean
  restrictToDomain?: boolean
  startTime?: string
  endTime?: string
}

interface GmailAutoForwarding {
  enabled: boolean
  emailAddress?: string
  disposition?: string
}

interface GmailImapSettings {
  enabled: boolean
  autoExpunge?: boolean
  expungeBehavior?: string
  maxFolderSize?: number
}

interface GmailPopSettings {
  accessWindow?: string
  disposition?: string
}

interface GmailLanguageSettings {
  displayLanguage: string
}

export interface GmailVacationOptions {
  enabled: boolean
  message?: string
  start?: Date
  end?: Date
}

const gmailVacationOptionsSchema = z.object({
  enabled: z.boolean(),
  message: z.string().optional(),
  start: z.date().optional(),
  end: z.date().optional(),
}).strict()

const gmailVacationSettingsSchema = z.object({
  enableAutoReply: z.boolean().optional(),
  responseSubject: z.string().optional(),
  responseBodyPlainText: z.string().optional(),
  responseBodyHtml: z.string().optional(),
  restrictToContacts: z.boolean().optional(),
  restrictToDomain: z.boolean().optional(),
  startTime: z.string().regex(/^-?\d+$/).optional(),
  endTime: z.string().regex(/^-?\d+$/).optional(),
}).strict()

const gmailImapSettingsSchema = z.object({
  enabled: z.boolean(),
  autoExpunge: z.boolean().optional(),
  expungeBehavior: z.enum(['archive', 'trash', 'deleteForever']).optional(),
  maxFolderSize: z.number().int().nonnegative().optional(),
}).strict()

const gmailPopSettingsSchema = z.object({
  accessWindow: z.enum(['disabled', 'fromNowOn', 'allMail']).optional(),
  disposition: z.enum(['leaveInInbox', 'archive', 'trash', 'markRead']).optional(),
}).strict()

const gmailLanguageSettingsSchema = z.object({
  displayLanguage: z.string(),
}).strict()

export type GmailSettingsSection =
  | 'vacation'
  | 'autoForwarding'
  | 'imap'
  | 'pop'
  | 'language'

export interface GmailSettingsError {
  section: GmailSettingsSection
  code: string
  message: string
  statusCode?: number
}

/**
 * An aggregate settings read is explicitly partial-aware. Callers must render
 * `errors` and treat a non-empty list as a partial result. If every endpoint
 * fails, the most actionable original error is thrown instead.
 */
export interface GmailSettingsResult {
  settings: MailboxSettings
  errors: GmailSettingsError[]
}

export interface GmailSettingsUpdateResult {
  updated: Array<Exclude<GmailSettingsSection, 'autoForwarding'>>
  errors: GmailSettingsError[]
}

export async function getSettings(client: HttpClient): Promise<GmailSettingsResult> {
  const sections = [
    'vacation',
    'autoForwarding',
    'imap',
    'pop',
    'language',
  ] as const satisfies readonly GmailSettingsSection[]
  const settled = await Promise.allSettled([
    client.get<GmailVacationSettings>('/settings/vacation'),
    client.get<GmailAutoForwarding>('/settings/autoForwarding'),
    client.get<GmailImapSettings>('/settings/imap'),
    client.get<GmailPopSettings>('/settings/pop'),
    client.get<GmailLanguageSettings>('/settings/language'),
  ] as const)

  const errors = settled.flatMap((result, index): GmailSettingsError[] => (
    result.status === 'rejected'
      ? [normalizeSettingsError(sections[index], result.reason)]
      : []
  ))
  if (errors.length === settled.length) {
    throw preferredAggregateError(settled)
  }

  const vacation = settledValue(settled[0])
  const forwarding = settledValue(settled[1])
  const imap = settledValue(settled[2])
  const pop = settledValue(settled[3])
  const language = settledValue(settled[4])

  return {
    settings: {
      automaticReplies: vacation
      ? {
          status: vacation.enableAutoReply ? 'enabled' : 'disabled',
          internalReplyMessage: vacation.responseBodyPlainText,
          externalReplyMessage: vacation.responseBodyPlainText,
          startDateTime: vacation.startTime,
          endDateTime: vacation.endTime,
        }
        : undefined,
      language: language?.displayLanguage,
      autoForwarding: forwarding,
      imap,
      pop,
    },
    errors,
  }
}

export async function getVacation(client: HttpClient): Promise<GmailVacationSettings> {
  return client.get<GmailVacationSettings>('/settings/vacation')
}

export async function setVacation(
  client: HttpClient,
  options: GmailVacationOptions,
): Promise<GmailVacationSettings> {
  const parsed = gmailVacationOptionsSchema.safeParse(options)
  if (!parsed.success) throw gmailVacationValidationError(parsed.error.issues)

  const { enabled, message, start, end } = parsed.data
  assertVacationDateOrder(start, end)
  return putVacationSettings(client, {
    enableAutoReply: enabled,
    ...(message !== undefined ? { responseBodyPlainText: message } : {}),
    ...(start !== undefined ? { startTime: String(start.getTime()) } : {}),
    ...(end !== undefined ? { endTime: String(end.getTime()) } : {}),
  })
}

export async function getAutoForwarding(client: HttpClient): Promise<GmailAutoForwarding> {
  return client.get<GmailAutoForwarding>('/settings/autoForwarding')
}

export async function updateSettings(
  client: HttpClient,
  settingsJson: Record<string, unknown>,
): Promise<GmailSettingsUpdateResult> {
  const forbiddenFields = [
    'autoForwarding',
    'sharing',
    'sendAs',
    'delegates',
    'forwardingAddresses',
  ] as const
  const supportedFields = ['vacation', 'imap', 'pop', 'language'] as const
  const forbidden = forbiddenFields.find((key) => Object.hasOwn(settingsJson, key))
  if (forbidden) {
    throw removedAdminWrite(`settings update (${forbidden})`)
  }

  const known = new Set<string>([...forbiddenFields, ...supportedFields])
  const unknown = Object.keys(settingsJson).filter((key) => !known.has(key))
  if (unknown.length > 0) {
    throw new CliMailError(
      `Unknown Gmail settings field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`,
      'INVALID_SETTINGS_FIELD',
    )
  }

  const present = supportedFields.filter(
    (key) => Object.hasOwn(settingsJson, key) && settingsJson[key] !== undefined,
  )
  if (present.length === 0) {
    throw new CliMailError(
      `At least one supported Gmail settings field is required: ${supportedFields.join(', ')}`,
      'EMPTY_UPDATE',
    )
  }

  const validated = present.map((key) => ({
    key,
    settings: parseSettingsSection(key, settingsJson[key]),
  }))

  const settled = await Promise.allSettled(validated.map(({ key, settings }) => {
    if (key === 'vacation') {
      return putVacationSettings(client, settings)
    }
    return client.put(`/settings/${key}`, settings)
  }))
  const errors = settled.flatMap((result, index): GmailSettingsError[] => (
    result.status === 'rejected'
      ? [normalizeSettingsError(present[index], result.reason)]
      : []
  ))
  if (errors.length === settled.length) throw preferredAggregateError(settled)

  return {
    updated: present.filter((_, index) => settled[index].status === 'fulfilled'),
    errors,
  }
}

// --- SendAs aliases ---

interface GmailSendAs {
  sendAsEmail: string
  displayName?: string
  replyToAddress?: string
  signature?: string
  isPrimary?: boolean
  isDefault?: boolean
  treatAsAlias?: boolean
  verificationStatus?: string
}

export async function listSendAs(client: HttpClient): Promise<GmailSendAs[]> {
  const result = await client.get<{ sendAs: GmailSendAs[] }>('/settings/sendAs')
  return result.sendAs || []
}

/** Read-only identity helper used to exclude aliases from reply-all. */
export async function getSendAsAliases(client: HttpClient): Promise<string[]> {
  const aliases = await listSendAs(client)
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of aliases) {
    const address = item.sendAsEmail.trim()
    const key = address.toLowerCase()
    if (!address || seen.has(key)) continue
    seen.add(key)
    result.push(address)
  }
  return result
}

export async function getSendAs(client: HttpClient, email: string): Promise<GmailSendAs> {
  return client.get<GmailSendAs>(`/settings/sendAs/${encodeURIComponent(email)}`)
}

// --- Forwarding addresses ---

interface GmailForwardingAddress {
  forwardingEmail: string
  verificationStatus?: string
}

export async function listForwardingAddresses(client: HttpClient): Promise<GmailForwardingAddress[]> {
  const result = await client.get<{ forwardingAddresses?: GmailForwardingAddress[] }>('/settings/forwardingAddresses')
  return result.forwardingAddresses || []
}

function removedAdminWrite(command: string): CliMailError {
  return new CliMailError(
    `${command} is not supported by cli-mail's user OAuth model. Use an administrator workflow with domain-wide delegation instead.`,
    'COMMAND_REMOVED',
  )
}

function settledValue<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === 'fulfilled' ? result.value : undefined
}

function normalizeSettingsError(
  section: GmailSettingsSection,
  error: unknown,
): GmailSettingsError {
  if (error instanceof CliMailError) {
    return {
      section,
      code: error.code,
      message: error.message,
      ...(error.statusCode !== undefined ? { statusCode: error.statusCode } : {}),
    }
  }
  return {
    section,
    code: 'SETTINGS_READ_FAILED',
    message: errorMessage(error),
  }
}

function preferredAggregateError(
  results: readonly PromiseSettledResult<unknown>[],
): unknown {
  const reasons = results.flatMap((result) => (
    result.status === 'rejected' ? [result.reason] : []
  ))
  // Authentication and throttling failures are more actionable than a
  // secondary endpoint error and must retain their original type/status.
  return reasons.find((reason) => (
    reason instanceof CliMailError
    && (reason.statusCode === 401 || reason.statusCode === 429)
  )) ?? reasons[0] ?? new CliMailError(
    'Unable to read Gmail settings.',
    'SETTINGS_READ_FAILED',
  )
}

type GmailWritableSettingsSection = Exclude<GmailSettingsSection, 'autoForwarding'>

function parseSettingsSection(
  field: GmailWritableSettingsSection,
  value: unknown,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CliMailError(
      `Gmail settings field ${field} must be a JSON object.`,
      'INVALID_SETTINGS_VALUE',
    )
  }

  const schema = {
    vacation: gmailVacationSettingsSchema,
    imap: gmailImapSettingsSchema,
    pop: gmailPopSettingsSchema,
    language: gmailLanguageSettingsSchema,
  }[field]
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new CliMailError(
      `Invalid Gmail ${field} settings.`,
      'INVALID_SETTINGS_VALUE',
      undefined,
      { issues: parsed.error.issues },
    )
  }
  return { ...parsed.data }
}

function putVacationSettings(
  client: HttpClient,
  settings: Partial<GmailVacationSettings>,
): Promise<GmailVacationSettings> {
  return client.put<GmailVacationSettings>('/settings/vacation', settings)
}

function assertVacationDateOrder(start: Date | undefined, end: Date | undefined): void {
  if (start !== undefined && end !== undefined && end <= start) {
    throw new ConfigError('Gmail vacation end must be later than start')
  }
}

function gmailVacationValidationError(issues: z.core.$ZodIssue[]): ConfigError {
  return new ConfigError('Invalid Gmail vacation settings', { issues })
}
