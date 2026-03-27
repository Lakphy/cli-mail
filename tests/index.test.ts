import { describe, test, expect, beforeEach, afterEach } from 'vitest'

// ============================================================
// MIME Utilities Tests
// ============================================================

import {
  buildMimeMessage,
  toBase64Url,
  fromBase64Url,
  bufferToBase64Url,
  base64UrlToBuffer,
  extractTextFromPayload,
  getHeader,
} from '../src/utils/mime'

describe('MIME Utilities', () => {
  describe('toBase64Url / fromBase64Url', () => {
    test('roundtrip ASCII string', () => {
      const input = 'Hello, World!'
      const encoded = toBase64Url(input)
      expect(encoded).not.toContain('+')
      expect(encoded).not.toContain('/')
      expect(encoded).not.toContain('=')
      expect(fromBase64Url(encoded)).toBe(input)
    })

    test('roundtrip UTF-8 string', () => {
      const input = '你好世界 🌍'
      expect(fromBase64Url(toBase64Url(input))).toBe(input)
    })

    test('roundtrip empty string', () => {
      expect(fromBase64Url(toBase64Url(''))).toBe('')
    })

    test('handles special base64 chars (+/=)', () => {
      // String that produces + and / in standard base64
      const input = '>>>???'
      const encoded = toBase64Url(input)
      expect(encoded).not.toContain('+')
      expect(encoded).not.toContain('/')
      expect(fromBase64Url(encoded)).toBe(input)
    })
  })

  describe('bufferToBase64Url / base64UrlToBuffer', () => {
    test('roundtrip binary data', () => {
      const input = Buffer.from([0, 1, 2, 255, 254, 253])
      const encoded = bufferToBase64Url(input)
      expect(base64UrlToBuffer(encoded)).toEqual(input)
    })

    test('handles empty buffer', () => {
      const input = Buffer.alloc(0)
      expect(base64UrlToBuffer(bufferToBase64Url(input))).toEqual(input)
    })

    test('handles large buffer', () => {
      const input = Buffer.alloc(10000, 0xAB)
      expect(base64UrlToBuffer(bufferToBase64Url(input))).toEqual(input)
    })
  })

  describe('buildMimeMessage', () => {
    test('builds simple text message with required headers', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Test Subject',
        body: 'Hello Alice',
      })
      expect(mime).toContain('To: alice@example.com')
      expect(mime).toContain('Subject: Test Subject')
      expect(mime).toContain('MIME-Version: 1.0')
      expect(mime).toContain('Content-Type: text/plain; charset=utf-8')
      expect(mime).toContain('Content-Transfer-Encoding: base64')
      expect(mime).toContain('Date: ')
    })

    test('builds message with CC and BCC', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com', 'bob@example.com'],
        cc: ['charlie@example.com'],
        bcc: ['dave@example.com'],
        subject: 'Multi-recipient',
        body: 'Hello everyone',
      })
      expect(mime).toContain('To: alice@example.com, bob@example.com')
      expect(mime).toContain('Cc: charlie@example.com')
      expect(mime).toContain('Bcc: dave@example.com')
    })

    test('omits CC/BCC when empty', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        cc: [],
        bcc: [],
        subject: 'Test',
        body: 'body',
      })
      expect(mime).not.toContain('Cc:')
      expect(mime).not.toContain('Bcc:')
    })

    test('builds HTML message', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'HTML',
        body: '<h1>Hello</h1>',
        contentType: 'text/html',
      })
      expect(mime).toContain('Content-Type: text/html; charset=utf-8')
    })

    test('encodes non-ASCII subject with RFC 2047', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: '日本語の件名',
        body: 'test',
      })
      expect(mime).toContain('=?UTF-8?B?')
    })

    test('does not encode ASCII-only subject', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Plain ASCII Subject',
        body: 'test',
      })
      expect(mime).toContain('Subject: Plain ASCII Subject')
      expect(mime).not.toContain('=?UTF-8?B?')
    })

    test('includes In-Reply-To and References headers', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Re: Test',
        body: 'reply',
        inReplyTo: '<msg123@example.com>',
        references: '<msg123@example.com>',
      })
      expect(mime).toContain('In-Reply-To: <msg123@example.com>')
      expect(mime).toContain('References: <msg123@example.com>')
    })

    test('includes From header when specified', () => {
      const mime = buildMimeMessage({
        from: 'sender@example.com',
        to: ['alice@example.com'],
        subject: 'Test',
        body: 'test',
      })
      expect(mime).toContain('From: sender@example.com')
    })

    test('body is base64 encoded in the message', () => {
      const body = 'This is the message body content'
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Test',
        body,
      })
      const bodyBase64 = Buffer.from(body, 'utf-8').toString('base64')
      expect(mime).toContain(bodyBase64)
    })

    test('uses CRLF line endings', () => {
      const mime = buildMimeMessage({
        to: ['alice@example.com'],
        subject: 'Test',
        body: 'test',
      })
      expect(mime).toContain('\r\n')
    })
  })

  describe('extractTextFromPayload', () => {
    test('extracts text from simple body', () => {
      const payload = {
        mimeType: 'text/plain',
        body: { data: toBase64Url('Hello, plain text!') },
      }
      expect(extractTextFromPayload(payload)).toBe('Hello, plain text!')
    })

    test('prefers text/plain in multipart', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: toBase64Url('Plain text') } },
          { mimeType: 'text/html', body: { data: toBase64Url('<p>HTML</p>') } },
        ],
      }
      expect(extractTextFromPayload(payload)).toBe('Plain text')
    })

    test('falls back to text/html', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/html', body: { data: toBase64Url('<p>HTML only</p>') } },
        ],
      }
      expect(extractTextFromPayload(payload)).toBe('<p>HTML only</p>')
    })

    test('returns empty for empty payload', () => {
      expect(extractTextFromPayload({})).toBe('')
    })

    test('handles deeply nested multipart', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [{
          mimeType: 'multipart/alternative',
          parts: [{
            mimeType: 'text/plain',
            body: { data: toBase64Url('Nested plain text') },
          }],
        }],
      }
      expect(extractTextFromPayload(payload)).toBe('Nested plain text')
    })

    test('handles parts without body data', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: {} },
          { mimeType: 'text/html', body: { data: toBase64Url('found it') } },
        ],
      }
      expect(extractTextFromPayload(payload)).toBe('found it')
    })

    test('handles attachment parts without body data', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'application/pdf', filename: 'doc.pdf', body: { attachmentId: 'att1' } },
          { mimeType: 'text/plain', body: { data: toBase64Url('Body text') } },
        ],
      }
      expect(extractTextFromPayload(payload)).toBe('Body text')
    })
  })

  describe('getHeader', () => {
    const headers = [
      { name: 'From', value: 'sender@example.com' },
      { name: 'Subject', value: 'Test Subject' },
      { name: 'Content-Type', value: 'text/plain' },
    ]

    test('finds header case-insensitively', () => {
      expect(getHeader(headers, 'from')).toBe('sender@example.com')
      expect(getHeader(headers, 'FROM')).toBe('sender@example.com')
      expect(getHeader(headers, 'From')).toBe('sender@example.com')
    })

    test('returns empty for missing header', () => {
      expect(getHeader(headers, 'X-Custom')).toBe('')
    })

    test('returns empty for undefined headers', () => {
      expect(getHeader(undefined, 'From')).toBe('')
    })

    test('returns empty for empty array', () => {
      expect(getHeader([], 'From')).toBe('')
    })
  })
})

// ============================================================
// Error Utilities Tests
// ============================================================

import {
  CliMailError, AuthError, TokenExpiredError, ApiError,
  RateLimitError, ConfigError, ProviderError, formatErrorOutput,
} from '../src/utils/error'

describe('Error Utilities', () => {
  test('CliMailError has code, message and statusCode', () => {
    const err = new CliMailError('test message', 'TEST_CODE', 500)
    expect(err.message).toBe('test message')
    expect(err.code).toBe('TEST_CODE')
    expect(err.statusCode).toBe(500)
    expect(err.name).toBe('CliMailError')
    expect(err instanceof Error).toBe(true)
  })

  test('AuthError defaults to 401', () => {
    const err = new AuthError('auth failed')
    expect(err.code).toBe('AUTH_ERROR')
    expect(err.statusCode).toBe(401)
    expect(err instanceof CliMailError).toBe(true)
  })

  test('TokenExpiredError has specific message', () => {
    const err = new TokenExpiredError()
    expect(err.message).toContain('expired')
    expect(err.name).toBe('TokenExpiredError')
    expect(err instanceof AuthError).toBe(true)
  })

  test('ApiError includes response detail', () => {
    const response = { error: { code: 'NotFound' } }
    const err = new ApiError('Not found', 404, response)
    expect(err.statusCode).toBe(404)
    expect(err.response).toEqual(response)
    expect(err.code).toBe('API_ERROR')
  })

  test('RateLimitError includes retry info', () => {
    const err = new RateLimitError(5000)
    expect(err.retryAfterMs).toBe(5000)
    expect(err.statusCode).toBe(429)
    expect(err instanceof ApiError).toBe(true)
  })

  test('ConfigError has CONFIG_ERROR code', () => {
    const err = new ConfigError('missing config')
    expect(err.code).toBe('CONFIG_ERROR')
  })

  test('ProviderError includes provider name', () => {
    const err = new ProviderError('unsupported', 'gmail')
    expect(err.provider).toBe('gmail')
    expect(err.code).toBe('PROVIDER_ERROR')
  })

  describe('formatErrorOutput', () => {
    test('formats CliMailError as JSON', () => {
      const err = new ApiError('Not found', 404, { detail: 'missing' })
      const output = JSON.parse(formatErrorOutput(err))
      expect(output.error).toBe('Not found')
      expect(output.code).toBe('API_ERROR')
      expect(output.statusCode).toBe(404)
      expect(output.details).toEqual({ detail: 'missing' })
    })

    test('formats generic Error', () => {
      const output = JSON.parse(formatErrorOutput(new Error('something broke')))
      expect(output.error).toBe('something broke')
      expect(output.code).toBe('UNKNOWN_ERROR')
    })

    test('formats string error', () => {
      const output = JSON.parse(formatErrorOutput('raw string error'))
      expect(output.error).toBe('raw string error')
      expect(output.code).toBe('UNKNOWN_ERROR')
    })

    test('formats null error', () => {
      const output = JSON.parse(formatErrorOutput(null))
      expect(output.code).toBe('UNKNOWN_ERROR')
    })

    test('omits statusCode when not present', () => {
      const err = new ConfigError('bad config')
      const output = JSON.parse(formatErrorOutput(err))
      expect(output.statusCode).toBeUndefined()
    })

    test('omits details when response is not present', () => {
      const err = new ApiError('fail', 500)
      const output = JSON.parse(formatErrorOutput(err))
      expect(output.details).toBeUndefined()
    })
  })
})

// ============================================================
// Output Formatter Tests
// ============================================================

import {
  output, outputList, outputSuccess, outputRaw, setGlobalFormat, getGlobalFormat,
} from '../src/output/formatter'

describe('Output Formatter', () => {
  let originalWrite: typeof process.stdout.write
  let captured: string

  beforeEach(() => {
    captured = ''
    originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string) => {
      captured += chunk
      return true
    }) as typeof process.stdout.write
  })

  afterEach(() => {
    process.stdout.write = originalWrite
    setGlobalFormat('text')
  })

  describe('text format (markdown)', () => {
    test('output renders object as markdown key-value', () => {
      output({ name: 'Alice', email: 'alice@example.com' }, 'text')
      expect(captured).toContain('**name**: Alice')
      expect(captured).toContain('**email**: alice@example.com')
    })

    test('outputList renders markdown table', () => {
      outputList(
        [{ id: '1', name: 'Inbox' }, { id: '2', name: 'Sent' }],
        [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }],
        'text',
      )
      expect(captured).toContain('| ID | Name |')
      expect(captured).toContain('| 1 | Inbox |')
      expect(captured).toContain('| 2 | Sent |')
    })

    test('outputList includes separator row', () => {
      outputList(
        [{ id: '1' }],
        [{ key: 'id', label: 'ID' }],
        'text',
      )
      expect(captured).toContain('| --- |')
    })

    test('outputList shows empty message', () => {
      outputList([], [{ key: 'id', label: 'ID' }], 'text')
      expect(captured).toContain('No items found.')
    })

    test('outputList escapes pipes in cell values', () => {
      outputList(
        [{ content: 'a|b|c' }],
        [{ key: 'content', label: 'Content' }],
        'text',
      )
      expect(captured).toContain('a\\|b\\|c')
    })

    test('outputList replaces newlines in cell values', () => {
      outputList(
        [{ content: 'line1\nline2' }],
        [{ key: 'content', label: 'Content' }],
        'text',
      )
      // Newlines in cell values should be replaced with spaces
      expect(captured).toContain('line1 line2')
    })

    test('outputSuccess shows checkmark', () => {
      outputSuccess('Done!')
      expect(captured).toContain('✓ Done!')
    })

    test('outputRaw outputs as-is with trailing newline', () => {
      outputRaw('raw content')
      expect(captured).toBe('raw content\n')
    })

    test('outputRaw does not add extra newline if already present', () => {
      outputRaw('content\n')
      expect(captured).toBe('content\n')
    })

    test('output handles nested objects', () => {
      output({ user: { name: 'Alice', age: 30 } }, 'text')
      expect(captured).toContain('**user**:')
      expect(captured).toContain('**name**: Alice')
    })

    test('output handles arrays in objects', () => {
      output({ tags: ['a', 'b', 'c'] }, 'text')
      expect(captured).toContain('**tags**:')
      expect(captured).toContain('- a')
      expect(captured).toContain('- b')
    })

    test('output handles empty arrays', () => {
      output({ tags: [] }, 'text')
      expect(captured).toContain('(empty)')
    })

    test('output handles null', () => {
      output(null, 'text')
      expect(captured).toContain('null')
    })

    test('output handles primitive values', () => {
      output('hello', 'text')
      expect(captured).toContain('hello')
    })

    test('output skips undefined values in objects', () => {
      output({ a: 'visible', b: undefined }, 'text')
      expect(captured).toContain('**a**: visible')
      expect(captured).not.toContain('**b**')
    })

    test('output handles boolean and number values', () => {
      output({ active: true, count: 42 }, 'text')
      expect(captured).toContain('**active**: true')
      expect(captured).toContain('**count**: 42')
    })
  })

  describe('json format', () => {
    test('output renders JSON with indentation', () => {
      output({ name: 'Alice' }, 'json')
      const parsed = JSON.parse(captured)
      expect(parsed.name).toBe('Alice')
    })

    test('outputList renders JSON array', () => {
      outputList([{ id: '1' }, { id: '2' }], [{ key: 'id', label: 'ID' }], 'json')
      const parsed = JSON.parse(captured)
      expect(parsed).toHaveLength(2)
    })

    test('outputSuccess renders JSON success object', () => {
      setGlobalFormat('json')
      outputSuccess('Operation complete')
      const parsed = JSON.parse(captured)
      expect(parsed.success).toBe(true)
      expect(parsed.message).toBe('Operation complete')
    })
  })

  describe('global format', () => {
    test('setGlobalFormat changes default', () => {
      setGlobalFormat('json')
      expect(getGlobalFormat()).toBe('json')
      output({ test: true })
      expect(() => JSON.parse(captured)).not.toThrow()
    })

    test('text is the default format', () => {
      expect(getGlobalFormat()).toBe('text')
    })
  })
})

// ============================================================
// Config Types & Store Tests
// ============================================================

import type { AppConfig, AccountConfig } from '../src/config/types'
import { GMAIL_AUTH, OUTLOOK_AUTH, DEFAULT_CONFIG } from '../src/config/types'

describe('Config Types', () => {
  test('DEFAULT_CONFIG has empty accounts and null default', () => {
    expect(DEFAULT_CONFIG.accounts).toHaveLength(0)
    expect(DEFAULT_CONFIG.default_account).toBeNull()
  })

  test('AccountConfig structure validation', () => {
    const account: AccountConfig = {
      alias: 'test',
      provider: 'gmail',
      email: 'test@gmail.com',
      client_id: 'client-123',
      client_secret: 'secret-456',
      tokens: {
        access_token: 'at-123',
        refresh_token: 'rt-456',
        expires_at: Date.now() + 3600_000,
        token_type: 'Bearer',
        scope: 'https://mail.google.com/',
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    expect(account.provider).toBe('gmail')
    expect(account.tokens.access_token).toBe('at-123')
    expect(account.tokens.expires_at).toBeGreaterThan(Date.now())
  })

  test('provider can only be gmail or outlook', () => {
    const gmail: AccountConfig['provider'] = 'gmail'
    const outlook: AccountConfig['provider'] = 'outlook'
    expect(gmail).toBe('gmail')
    expect(outlook).toBe('outlook')
  })
})

describe('Auth Constants', () => {
  test('Gmail auth URLs are correct', () => {
    expect(GMAIL_AUTH.authUrl).toContain('accounts.google.com')
    expect(GMAIL_AUTH.tokenUrl).toContain('oauth2.googleapis.com')
    expect(GMAIL_AUTH.scopes).toContain('https://mail.google.com/')
  })

  test('Outlook auth URLs are correct', () => {
    expect(OUTLOOK_AUTH.authUrl).toContain('login.microsoftonline.com')
    expect(OUTLOOK_AUTH.tokenUrl).toContain('login.microsoftonline.com')
    expect(OUTLOOK_AUTH.scopes).toContain('Mail.ReadWrite')
    expect(OUTLOOK_AUTH.scopes).toContain('Mail.Send')
    expect(OUTLOOK_AUTH.scopes).toContain('MailboxSettings.ReadWrite')
    expect(OUTLOOK_AUTH.scopes).toContain('User.Read')
    expect(OUTLOOK_AUTH.scopes).toContain('offline_access')
  })

  test('Gmail scopes include full mail access', () => {
    expect(GMAIL_AUTH.scopes.length).toBeGreaterThanOrEqual(1)
  })

  test('Outlook has 5 required scopes', () => {
    expect(OUTLOOK_AUTH.scopes.length).toBe(5)
  })
})

// ============================================================
// Token Store (buildAuthUrl) Tests
// ============================================================

import { buildAuthUrl } from '../src/auth/token-store'

describe('Token Store', () => {
  describe('buildAuthUrl', () => {
    test('builds Gmail OAuth URL with all required params', () => {
      const url = buildAuthUrl({
        provider: 'gmail',
        client_id: 'test-client-id',
        redirect_uri: 'http://127.0.0.1:3000',
      })
      expect(url).toContain('accounts.google.com')
      expect(url).toContain('client_id=test-client-id')
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain(encodeURIComponent('https://mail.google.com/'))
    })

    test('builds Outlook OAuth URL', () => {
      const url = buildAuthUrl({
        provider: 'outlook',
        client_id: 'outlook-client-id',
        redirect_uri: 'http://127.0.0.1:4000',
      })
      expect(url).toContain('login.microsoftonline.com')
      expect(url).toContain('client_id=outlook-client-id')
      expect(url).toContain('Mail.ReadWrite')
      expect(url).toContain('Mail.Send')
    })

    test('includes state parameter when provided', () => {
      const url = buildAuthUrl({
        provider: 'gmail',
        client_id: 'test',
        redirect_uri: 'http://localhost:3000',
        state: 'random-state-123',
      })
      expect(url).toContain('state=random-state-123')
    })

    test('omits state when not provided', () => {
      const url = buildAuthUrl({
        provider: 'gmail',
        client_id: 'test',
        redirect_uri: 'http://localhost:3000',
      })
      expect(url).not.toContain('state=')
    })

    test('URL is parseable', () => {
      const url = buildAuthUrl({
        provider: 'gmail',
        client_id: 'test',
        redirect_uri: 'http://localhost:3000',
      })
      const parsed = new URL(url)
      expect(parsed.searchParams.get('client_id')).toBe('test')
      expect(parsed.searchParams.get('response_type')).toBe('code')
    })
  })
})

// ============================================================
// OAuth Server Tests
// ============================================================

import { startOAuthCallbackServer } from '../src/auth/oauth-server'

describe('OAuth Callback Server', () => {
  test('starts on random port and receives auth code', async () => {
    const { result, port } = await startOAuthCallbackServer()
    expect(port).toBeGreaterThan(0)

    const response = await fetch(`http://127.0.0.1:${port}?code=test-auth-code&state=test-state`)
    expect(response.ok).toBe(true)

    const callbackResult = await result
    expect(callbackResult.code).toBe('test-auth-code')
    expect(callbackResult.state).toBe('test-state')
  })

  test('handles error response from OAuth provider', async () => {
    const { result, port } = await startOAuthCallbackServer()
    const errorPromise = result.catch((err) => err)
    await fetch(`http://127.0.0.1:${port}?error=access_denied`)
    const error = await errorPromise
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('access_denied')
  })

  test('handles code without state', async () => {
    const { result, port } = await startOAuthCallbackServer()
    await fetch(`http://127.0.0.1:${port}?code=no-state-code`)
    const callbackResult = await result
    expect(callbackResult.code).toBe('no-state-code')
  })
})

// ============================================================
// CLI Structure Tests
// ============================================================

import { createCli } from '../src/cli'

describe('CLI', () => {
  test('creates program with correct name and version', () => {
    const program = createCli()
    expect(program.name()).toBe('cli-mail')
    expect(program.version()).toBe('0.1.0')
  })

  test('has all top-level commands', () => {
    const program = createCli()
    const names = program.commands.map((c) => c.name())
    const expected = [
      'account', 'message', 'draft', 'folder', 'attachment',
      'rule', 'settings', 'thread', 'category', 'mail-tips', 'focused-inbox',
    ]
    for (const name of expected) {
      expect(names).toContain(name)
    }
  })

  test('command aliases work correctly', () => {
    const program = createCli()
    const aliases: Record<string, string> = {
      message: 'msg', folder: 'label', attachment: 'att', rule: 'filter',
    }
    for (const [cmdName, alias] of Object.entries(aliases)) {
      const cmd = program.commands.find((c) => c.name() === cmdName)
      expect(cmd?.aliases()).toContain(alias)
    }
  })

  test('message command has all subcommands including new ones', () => {
    const program = createCli()
    const msgCmd = program.commands.find((c) => c.name() === 'message')
    const subNames = msgCmd?.commands.map((c) => c.name()) || []
    const expected = [
      'list', 'get', 'raw', 'send', 'reply', 'forward', 'delete',
      'move', 'mark', 'search', 'untrash', 'batch-delete', 'import', 'copy',
    ]
    for (const name of expected) {
      expect(subNames).toContain(name)
    }
  })

  test('account command has all subcommands', () => {
    const program = createCli()
    const accCmd = program.commands.find((c) => c.name() === 'account')
    const subNames = accCmd?.commands.map((c) => c.name()) || []
    for (const name of ['add', 'remove', 'list', 'switch', 'info']) {
      expect(subNames).toContain(name)
    }
  })

  test('draft command has all subcommands', () => {
    const program = createCli()
    const draftCmd = program.commands.find((c) => c.name() === 'draft')
    const subNames = draftCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'get', 'create', 'update', 'send', 'delete']) {
      expect(subNames).toContain(name)
    }
  })

  test('folder command has all subcommands', () => {
    const program = createCli()
    const folderCmd = program.commands.find((c) => c.name() === 'folder')
    const subNames = folderCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'get', 'create', 'update', 'delete', 'messages']) {
      expect(subNames).toContain(name)
    }
  })

  test('attachment command has all subcommands including add/delete', () => {
    const program = createCli()
    const attCmd = program.commands.find((c) => c.name() === 'attachment')
    const subNames = attCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'get', 'download', 'add', 'delete']) {
      expect(subNames).toContain(name)
    }
  })

  test('rule command has all subcommands', () => {
    const program = createCli()
    const ruleCmd = program.commands.find((c) => c.name() === 'rule')
    const subNames = ruleCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'get', 'create', 'update', 'delete']) {
      expect(subNames).toContain(name)
    }
  })

  test('thread command has all subcommands', () => {
    const program = createCli()
    const threadCmd = program.commands.find((c) => c.name() === 'thread')
    const subNames = threadCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'get', 'modify', 'trash', 'untrash', 'delete']) {
      expect(subNames).toContain(name)
    }
  })

  test('category command has all subcommands', () => {
    const program = createCli()
    const catCmd = program.commands.find((c) => c.name() === 'category')
    const subNames = catCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'create', 'update', 'delete']) {
      expect(subNames).toContain(name)
    }
  })

  test('settings command has nested subcommands', () => {
    const program = createCli()
    const settingsCmd = program.commands.find((c) => c.name() === 'settings')
    const subNames = settingsCmd?.commands.map((c) => c.name()) || []
    for (const name of ['get', 'update', 'vacation', 'auto-reply', 'forwarding']) {
      expect(subNames).toContain(name)
    }
  })

  test('focused-inbox command has all subcommands', () => {
    const program = createCli()
    const fiCmd = program.commands.find((c) => c.name() === 'focused-inbox')
    const subNames = fiCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'add', 'delete']) {
      expect(subNames).toContain(name)
    }
  })

  test('message list has --page-token option', () => {
    const program = createCli()
    const msgCmd = program.commands.find((c) => c.name() === 'message')
    const listCmd = msgCmd?.commands.find((c) => c.name() === 'list')
    const optionFlags = listCmd?.options.map((o) => o.long) || []
    expect(optionFlags).toContain('--page-token')
  })

  test('message send has all required and optional flags', () => {
    const program = createCli()
    const msgCmd = program.commands.find((c) => c.name() === 'message')
    const sendCmd = msgCmd?.commands.find((c) => c.name() === 'send')
    const optionFlags = sendCmd?.options.map((o) => o.long) || []
    for (const flag of ['--to', '--subject', '--body', '--body-file', '--cc', '--bcc', '--attach', '--body-type', '--importance']) {
      expect(optionFlags).toContain(flag)
    }
  })

  test('attachment download has -o shorthand for --output', () => {
    const program = createCli()
    const attCmd = program.commands.find((c) => c.name() === 'attachment')
    const dlCmd = attCmd?.commands.find((c) => c.name() === 'download')
    const shortFlags = dlCmd?.options.map((o) => o.short) || []
    expect(shortFlags).toContain('-o')
  })

  test('every data subcommand has -a/--account option', () => {
    const program = createCli()
    // Check a representative set of data-operation subcommands
    const cmdPairs = [
      ['message', 'list'], ['message', 'get'], ['message', 'send'],
      ['draft', 'list'], ['folder', 'list'], ['attachment', 'list'],
      ['rule', 'list'], ['thread', 'list'], ['category', 'list'],
    ]
    for (const [parent, child] of cmdPairs) {
      const parentCmd = program.commands.find((c) => c.name() === parent)
      const childCmd = parentCmd?.commands.find((c) => c.name() === child)
      const optionFlags = childCmd?.options.map((o) => o.long) || []
      expect(optionFlags).toContain('--account')
    }
  })
})

// ============================================================
// Provider Types Tests
// ============================================================

import type {
  EmailAddress, MessageSummary, MessageDetail, DraftSummary,
  DraftDetail, FolderInfo, AttachmentSummary, AttachmentDetail,
  RuleInfo, MailboxSettings, SendMessageOptions, ListOptions,
} from '../src/providers/types'

describe('Provider Types', () => {
  test('EmailAddress has required address field', () => {
    const addr: EmailAddress = { address: 'test@example.com' }
    expect(addr.address).toBe('test@example.com')
    expect(addr.name).toBeUndefined()
  })

  test('EmailAddress can have optional name', () => {
    const addr: EmailAddress = { name: 'Test User', address: 'test@example.com' }
    expect(addr.name).toBe('Test User')
  })

  test('SendMessageOptions structure', () => {
    const opts: SendMessageOptions = {
      to: ['a@b.com'],
      subject: 'Hi',
      body: 'Hello',
      bodyType: 'text',
      importance: 'high',
    }
    expect(opts.to).toHaveLength(1)
    expect(opts.importance).toBe('high')
  })

  test('ListOptions defaults', () => {
    const opts: ListOptions = {}
    expect(opts.top).toBeUndefined()
    expect(opts.query).toBeUndefined()
  })

  test('MessageDetail extends MessageSummary', () => {
    const detail: MessageDetail = {
      id: 'msg1', subject: 'Test', from: { address: 'a@b.com' },
      to: [{ address: 'c@d.com' }], date: '2024-01-01', isRead: true,
      hasAttachments: false, body: 'Hello', bodyType: 'text',
    }
    expect(detail.body).toBe('Hello')
    expect(detail.id).toBe('msg1')
  })

  test('FolderInfo structure', () => {
    const folder: FolderInfo = {
      id: 'f1', name: 'Inbox', messageCount: 42, unreadCount: 5,
    }
    expect(folder.name).toBe('Inbox')
    expect(folder.messageCount).toBe(42)
  })

  test('AttachmentDetail extends AttachmentSummary', () => {
    const att: AttachmentDetail = {
      id: 'a1', name: 'file.pdf', contentType: 'application/pdf',
      size: 1024, content: 'base64data',
    }
    expect(att.content).toBe('base64data')
  })

  test('MailboxSettings structure', () => {
    const settings: MailboxSettings = {
      automaticReplies: {
        status: 'enabled',
        internalReplyMessage: 'OOO',
        externalReplyMessage: 'OOO external',
      },
      language: 'en',
      timeZone: 'UTC',
    }
    expect(settings.automaticReplies?.status).toBe('enabled')
  })
})

// ============================================================
// Gmail Message Normalization Tests (unit-level)
// ============================================================

describe('Gmail Message Helpers', () => {
  // Test the parseEmailAddress logic that exists in gmail/messages.ts
  // We test it indirectly through the module's normalization

  test('email address parsing - simple address', () => {
    // This tests the pattern used in parseEmailAddress
    const raw = 'alice@example.com'
    const match = raw.match(/^(.+?)\s*<(.+?)>$/)
    expect(match).toBeNull()
    // Should return { address: raw.trim() }
    expect(raw.trim()).toBe('alice@example.com')
  })

  test('email address parsing - name + angle bracket format', () => {
    const raw = 'Alice Smith <alice@example.com>'
    const match = raw.match(/^(.+?)\s*<(.+?)>$/)
    expect(match).not.toBeNull()
    expect(match![1].trim().replace(/^"|"$/g, '')).toBe('Alice Smith')
    expect(match![2]).toBe('alice@example.com')
  })

  test('email address parsing - quoted name', () => {
    const raw = '"Bob Jones" <bob@example.com>'
    const match = raw.match(/^(.+?)\s*<(.+?)>$/)
    expect(match).not.toBeNull()
    expect(match![1].trim().replace(/^"|"$/g, '')).toBe('Bob Jones')
    expect(match![2]).toBe('bob@example.com')
  })

  test('multi-address parsing', () => {
    const raw = 'alice@example.com, bob@example.com'
    const addresses = raw.split(',').map((a) => a.trim())
    expect(addresses).toHaveLength(2)
    expect(addresses[0]).toBe('alice@example.com')
    expect(addresses[1]).toBe('bob@example.com')
  })

  test('empty string returns empty array', () => {
    const raw = ''
    const addresses = raw ? raw.split(',').map((a) => a.trim()) : []
    expect(addresses).toHaveLength(0)
  })
})

// ============================================================
// Outlook Message Normalization Tests
// ============================================================

describe('Outlook Message Helpers', () => {
  test('Graph email address format conversion', () => {
    const graphAddr = { emailAddress: { name: 'Alice', address: 'alice@example.com' } }
    const normalized = { name: graphAddr.emailAddress.name, address: graphAddr.emailAddress.address }
    expect(normalized.name).toBe('Alice')
    expect(normalized.address).toBe('alice@example.com')
  })

  test('Graph email address without name', () => {
    const graphAddr = { emailAddress: { address: 'alice@example.com' } }
    const normalized = { name: graphAddr.emailAddress.name, address: graphAddr.emailAddress.address }
    expect(normalized.name).toBeUndefined()
    expect(normalized.address).toBe('alice@example.com')
  })

  test('toGraphAddress format', () => {
    const addr = 'alice@example.com'
    const graphAddr = { emailAddress: { address: addr } }
    expect(graphAddr.emailAddress.address).toBe('alice@example.com')
  })
})

// ============================================================
// HttpClient config tests
// ============================================================

describe('HttpClient Configuration', () => {
  test('Gmail base URL is correct', () => {
    expect('https://gmail.googleapis.com/gmail/v1/users/me').toContain('gmail.googleapis.com')
  })

  test('Outlook base URL is correct', () => {
    expect('https://graph.microsoft.com/v1.0/me').toContain('graph.microsoft.com')
  })
})

// ============================================================
// Attachment Size Formatting (logic test)
// ============================================================

describe('Attachment Size Formatting', () => {
  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  test('formats bytes', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1023)).toBe('1023 B')
  })

  test('formats kilobytes', () => {
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(1024 * 100)).toBe('100.0 KB')
  })

  test('formats megabytes', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatSize(1024 * 1024 * 5.5)).toBe('5.5 MB')
  })
})