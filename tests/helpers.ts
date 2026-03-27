import { vi } from 'vitest'
import type { HttpClient } from '../src/utils/http'
import type { AccountConfig } from '../src/config/types'

// Reusable mock for HttpClient
export function createMockHttpClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  } as unknown as HttpClient
}

// Reusable mock for Account instances
export function createMockAccount(provider: 'gmail' | 'outlook'): AccountConfig {
  return {
    alias: 'test-account',
    email: 'test@example.com',
    provider,
    client_id: 'test-client-id',
    client_secret: 'test-client-secret',
    tokens: {
      token_type: 'Bearer',
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      expires_at: Date.now() + 3600000,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}
