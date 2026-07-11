import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { readGmailDesktopCredentials } from '../../src/providers/gmail/auth'

const directory = join(import.meta.dirname, '..', '.test-gmail-credentials')
const file = join(directory, 'credentials.json')

afterEach(() => rmSync(directory, { recursive: true, force: true }))

describe('Gmail desktop credentials', () => {
  test('accepts Google installed-app files with normal extra metadata', () => {
    mkdirSync(directory, { recursive: true })
    writeFileSync(file, JSON.stringify({
      installed: {
        client_id: 'desktop-id',
        project_id: 'project',
        auth_uri: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_secret: 'desktop-value',
        redirect_uris: ['http://localhost'],
      },
    }))
    expect(readGmailDesktopCredentials(file)).toEqual({
      clientId: 'desktop-id',
      clientSecret: 'desktop-value',
    })
  })

  test('rejects web OAuth credentials', () => {
    mkdirSync(directory, { recursive: true })
    writeFileSync(file, JSON.stringify({
      web: {
        client_id: 'web-id',
        auth_uri: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        redirect_uris: ['https://example.com/callback'],
      },
    }))
    expect(() => readGmailDesktopCredentials(file)).toThrow('Desktop')
  })
})
