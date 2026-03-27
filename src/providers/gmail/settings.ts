// Gmail settings operations

import type { HttpClient } from '../../utils/http.js'
import type { MailboxSettings } from '../types.js'

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

export async function getSettings(client: HttpClient): Promise<MailboxSettings> {
  const [vacation, forwarding, imap, pop, language] = await Promise.all([
    client.get<GmailVacationSettings>('/settings/vacation').catch(() => null),
    client.get<GmailAutoForwarding>('/settings/autoForwarding').catch(() => null),
    client.get<GmailImapSettings>('/settings/imap').catch(() => null),
    client.get<GmailPopSettings>('/settings/pop').catch(() => null),
    client.get<GmailLanguageSettings>('/settings/language').catch(() => null),
  ])

  return {
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
  }
}

export async function getVacation(client: HttpClient): Promise<GmailVacationSettings> {
  return client.get<GmailVacationSettings>('/settings/vacation')
}

export async function setVacation(
  client: HttpClient,
  settings: Partial<GmailVacationSettings>,
): Promise<GmailVacationSettings> {
  return client.put<GmailVacationSettings>('/settings/vacation', settings)
}

export async function getAutoForwarding(client: HttpClient): Promise<GmailAutoForwarding> {
  return client.get<GmailAutoForwarding>('/settings/autoForwarding')
}

export async function setAutoForwarding(
  client: HttpClient,
  settings: Partial<GmailAutoForwarding>,
): Promise<GmailAutoForwarding> {
  return client.put<GmailAutoForwarding>('/settings/autoForwarding', settings)
}

export async function updateSettings(
  client: HttpClient,
  settingsJson: Record<string, unknown>,
): Promise<void> {
  // Gmail doesn't have a single settings endpoint; route to specific ones
  if (settingsJson.vacation) {
    await setVacation(client, settingsJson.vacation as Partial<GmailVacationSettings>)
  }
  if (settingsJson.autoForwarding) {
    await setAutoForwarding(client, settingsJson.autoForwarding as Partial<GmailAutoForwarding>)
  }
  if (settingsJson.imap) {
    await client.put('/settings/imap', settingsJson.imap)
  }
  if (settingsJson.pop) {
    await client.put('/settings/pop', settingsJson.pop)
  }
  if (settingsJson.language) {
    await client.put('/settings/language', settingsJson.language)
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

export async function getSendAs(client: HttpClient, email: string): Promise<GmailSendAs> {
  return client.get<GmailSendAs>(`/settings/sendAs/${encodeURIComponent(email)}`)
}

export async function createSendAs(client: HttpClient, sendAs: Partial<GmailSendAs>): Promise<GmailSendAs> {
  return client.post<GmailSendAs>('/settings/sendAs', sendAs)
}

export async function deleteSendAs(client: HttpClient, email: string): Promise<void> {
  await client.delete(`/settings/sendAs/${encodeURIComponent(email)}`)
}

// --- Delegates ---

interface GmailDelegate {
  delegateEmail: string
  verificationStatus?: string
}

export async function listDelegates(client: HttpClient): Promise<GmailDelegate[]> {
  const result = await client.get<{ delegates?: GmailDelegate[] }>('/settings/delegates')
  return result.delegates || []
}

export async function addDelegate(client: HttpClient, email: string): Promise<void> {
  await client.post('/settings/delegates', { delegateEmail: email })
}

export async function removeDelegate(client: HttpClient, email: string): Promise<void> {
  await client.delete(`/settings/delegates/${encodeURIComponent(email)}`)
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

export async function createForwardingAddress(client: HttpClient, email: string): Promise<void> {
  await client.post('/settings/forwardingAddresses', { forwardingEmail: email })
}

export async function deleteForwardingAddress(client: HttpClient, email: string): Promise<void> {
  await client.delete(`/settings/forwardingAddresses/${encodeURIComponent(email)}`)
}
