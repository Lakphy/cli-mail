// Outlook category operations via Microsoft Graph API

import type { HttpClient } from '../../utils/http.js'

export interface OutlookCategory {
  id: string
  displayName: string
  color?: string
}

interface CategoryList {
  value: OutlookCategory[]
}

export async function listCategories(client: HttpClient): Promise<OutlookCategory[]> {
  const list = await client.get<CategoryList>('/outlook/masterCategories')
  return list.value || []
}

export async function createCategory(
  client: HttpClient,
  name: string,
  color?: string,
): Promise<OutlookCategory> {
  return client.post<OutlookCategory>('/outlook/masterCategories', {
    displayName: name,
    color: color || 'preset0',
  })
}

export async function updateCategory(
  client: HttpClient,
  id: string,
  name?: string,
  color?: string,
): Promise<OutlookCategory> {
  const updates: Record<string, string> = {}
  if (name) updates.displayName = name
  if (color) updates.color = color

  return client.patch<OutlookCategory>(
    `/outlook/masterCategories/${encodeURIComponent(id)}`,
    updates,
  )
}

export async function deleteCategory(
  client: HttpClient,
  id: string,
): Promise<void> {
  await client.delete(`/outlook/masterCategories/${encodeURIComponent(id)}`)
}
