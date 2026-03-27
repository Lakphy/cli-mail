// Gmail user profile operations

import type { HttpClient } from '../../utils/http.js'

interface GmailProfile {
  emailAddress: string
  messagesTotal: number
  threadsTotal: number
  historyId: string
}

export async function getProfile(client: HttpClient): Promise<GmailProfile> {
  return client.get<GmailProfile>('/profile')
}
