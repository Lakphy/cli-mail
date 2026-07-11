// Outlook mailbox settings operations via Microsoft Graph API

import type { HttpClient } from '../../utils/http.js'
import type { MailboxSettings } from '../types.js'
import { z } from 'zod'
import { ConfigError } from '../../utils/error.js'

interface GraphMailboxSettings {
  automaticRepliesSetting?: {
    status: string
    internalReplyMessage?: string
    externalReplyMessage?: string
    scheduledStartDateTime?: { dateTime: string; timeZone: string }
    scheduledEndDateTime?: { dateTime: string; timeZone: string }
    externalAudience?: OutlookExternalAudience
  }
  language?: { locale: string; displayName: string }
  timeZone?: string
  workingHours?: {
    daysOfWeek: string[]
    startTime: string
    endTime: string
    timeZone: { name: string }
  }
  dateFormat?: string
  timeFormat?: string
  delegateMeetingMessageDeliveryOptions?: string
  userPurpose?: string
}

interface GraphMailTips {
  emailAddress?: { address: string }
  automaticReplies?: { message: string; messageLanguage: { locale: string } }
  mailboxFull?: boolean
  maxMessageSize?: number
  deliveryRestricted?: boolean
  isModerated?: boolean
  recipientSuggestions?: unknown[]
  recipientScope?: string
  externalMemberCount?: number
  totalMemberCount?: number
}

const outlookAutoReplySchema = z.object({
  enabled: z.boolean(),
  internalMessage: z.string().optional(),
  externalMessage: z.string().optional(),
  externalAudience: z.enum(['none', 'contactsOnly', 'all']).optional(),
  startDateTime: z.string().optional(),
  endDateTime: z.string().optional(),
}).strict()

export type OutlookExternalAudience = 'none' | 'contactsOnly' | 'all'

export async function getSettings(client: HttpClient): Promise<MailboxSettings> {
  const settings = await client.get<GraphMailboxSettings>('/mailboxSettings')
  return normalizeSettings(settings)
}

export async function updateSettings(
  client: HttpClient,
  settingsJson: Record<string, unknown>,
): Promise<MailboxSettings> {
  const settings = await client.patch<GraphMailboxSettings>(
    '/mailboxSettings',
    settingsJson,
  )
  return normalizeSettings(settings)
}

export async function getAutoReply(client: HttpClient): Promise<MailboxSettings['automaticReplies']> {
  const settings = await client.get<GraphMailboxSettings>(
    '/mailboxSettings/automaticRepliesSetting',
  )

  const ars = settings as unknown as GraphMailboxSettings['automaticRepliesSetting']
  if (!ars) return undefined

  return {
    status: ars.status,
    internalReplyMessage: ars.internalReplyMessage,
    externalReplyMessage: ars.externalReplyMessage,
    externalAudience: ars.externalAudience,
    startDateTime: ars.scheduledStartDateTime?.dateTime,
    endDateTime: ars.scheduledEndDateTime?.dateTime,
  }
}

export async function setAutoReply(
  client: HttpClient,
  input: unknown,
): Promise<void> {
  const parsed = outlookAutoReplySchema.safeParse(input)
  if (!parsed.success) {
    throw new ConfigError('Invalid Outlook auto-reply settings', {
      issues: parsed.error.issues,
    })
  }
  const options = parsed.data
  const hasStart = options.startDateTime !== undefined
  const hasEnd = options.endDateTime !== undefined
  if (hasStart !== hasEnd) {
    throw new TypeError('Scheduled automatic replies require both startDateTime and endDateTime')
  }

  let start: NormalizedUtcDateTime | undefined
  let end: NormalizedUtcDateTime | undefined
  if (hasStart && hasEnd) {
    start = normalizeUtcDateTime(options.startDateTime as string)
    end = normalizeUtcDateTime(options.endDateTime as string)
    if (start.epochMs >= end.epochMs) {
      throw new TypeError('Automatic reply endDateTime must be later than startDateTime')
    }
  }

  const status = !options.enabled
    ? 'disabled'
    : hasStart
      ? 'scheduled'
      : 'alwaysEnabled'

  const settings: Record<string, unknown> = {
    automaticRepliesSetting: {
      status,
      ...(options.internalMessage !== undefined
        ? { internalReplyMessage: options.internalMessage }
        : {}),
      ...(options.externalMessage !== undefined
        ? { externalReplyMessage: options.externalMessage }
        : {}),
      ...(options.externalAudience !== undefined
        ? { externalAudience: options.externalAudience }
        : {}),
      ...(status === 'scheduled' && start && end
        ? {
            scheduledStartDateTime: {
              dateTime: start.graphDateTime,
              timeZone: 'UTC',
            },
            scheduledEndDateTime: {
              dateTime: end.graphDateTime,
              timeZone: 'UTC',
            },
          }
        : {}),
    },
  }

  await client.patch('/mailboxSettings', settings)
}

interface NormalizedUtcDateTime {
  epochMs: number
  graphDateTime: string
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?$/i

/** Convert offset-bearing input to a timezone-free UTC value paired with UTC. */
function normalizeUtcDateTime(value: string): NormalizedUtcDateTime {
  if (!ISO_DATE_TIME.test(value)) {
    throw new TypeError('Automatic reply start and end must be valid ISO date-time values')
  }
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  const epochMs = Date.parse(hasOffset ? value : `${value}Z`)
  if (!Number.isFinite(epochMs)) {
    throw new TypeError('Automatic reply start and end must be valid ISO date-time values')
  }
  return {
    epochMs,
    // dateTimeTimeZone carries the timezone separately, so don't append Z.
    graphDateTime: new Date(epochMs).toISOString().slice(0, -1),
  }
}

export async function getMailTips(
  client: HttpClient,
  addresses: string[],
): Promise<GraphMailTips[]> {
  const result = await client.post<{ value: GraphMailTips[] }>('/getMailTips', {
    EmailAddresses: addresses,
    MailTipsOptions:
      'automaticReplies,mailboxFullStatus,maxMessageSize,deliveryRestriction,moderationStatus,recipientScope,recipientSuggestions,totalMemberCount,externalMemberCount',
  })
  return result.value || []
}

// --- Focused Inbox overrides ---

interface FocusedInboxOverride {
  id: string
  classifyAs: string
  senderEmailAddress: { name?: string; address: string }
}

export async function listFocusedInboxOverrides(
  client: HttpClient,
): Promise<FocusedInboxOverride[]> {
  const result = await client.get<{ value: FocusedInboxOverride[] }>(
    '/inferenceClassification/overrides',
  )
  return result.value || []
}

export async function createFocusedInboxOverride(
  client: HttpClient,
  email: string,
  classifyAs: 'focused' | 'other',
): Promise<FocusedInboxOverride> {
  return client.post<FocusedInboxOverride>(
    '/inferenceClassification/overrides',
    {
      classifyAs,
      senderEmailAddress: { address: email },
    },
  )
}

export async function deleteFocusedInboxOverride(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.delete(`/inferenceClassification/overrides/${encodeURIComponent(id)}`)
}

// --- Helpers ---

function normalizeSettings(settings: GraphMailboxSettings): MailboxSettings {
  const ars = settings.automaticRepliesSetting
  return {
    automaticReplies: ars
      ? {
          status: ars.status,
          internalReplyMessage: ars.internalReplyMessage,
          externalReplyMessage: ars.externalReplyMessage,
          externalAudience: ars.externalAudience,
          startDateTime: ars.scheduledStartDateTime?.dateTime,
          endDateTime: ars.scheduledEndDateTime?.dateTime,
        }
      : undefined,
    language: settings.language?.locale,
    timeZone: settings.timeZone,
    workingHours: settings.workingHours as unknown as Record<string, unknown>,
    dateFormat: settings.dateFormat,
    timeFormat: settings.timeFormat,
  }
}
