// Outlook mailbox settings operations via Microsoft Graph API

import type { HttpClient } from '../../utils/http.js'
import type { MailboxSettings } from '../types.js'

interface GraphMailboxSettings {
  automaticRepliesSetting?: {
    status: string
    internalReplyMessage?: string
    externalReplyMessage?: string
    scheduledStartDateTime?: { dateTime: string; timeZone: string }
    scheduledEndDateTime?: { dateTime: string; timeZone: string }
    externalAudience?: string
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
    startDateTime: ars.scheduledStartDateTime?.dateTime,
    endDateTime: ars.scheduledEndDateTime?.dateTime,
  }
}

export async function setAutoReply(
  client: HttpClient,
  options: {
    enabled: boolean
    internalMessage?: string
    externalMessage?: string
    startDateTime?: string
    endDateTime?: string
  },
): Promise<void> {
  const settings: Record<string, unknown> = {
    automaticRepliesSetting: {
      status: options.enabled ? 'scheduled' : 'disabled',
      internalReplyMessage: options.internalMessage || '',
      externalReplyMessage: options.externalMessage || '',
      ...(options.startDateTime && options.endDateTime
        ? {
            scheduledStartDateTime: {
              dateTime: options.startDateTime,
              timeZone: 'UTC',
            },
            scheduledEndDateTime: {
              dateTime: options.endDateTime,
              timeZone: 'UTC',
            },
          }
        : {}),
    },
  }

  await client.patch('/mailboxSettings', settings)
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
  await client.delete(`/inferenceClassification/overrides/${id}`)
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
