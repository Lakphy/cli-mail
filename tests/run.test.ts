import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '../src/run'
import { setGlobalFormat } from '../src/output/formatter'
import { _resetGlobalAccount } from '../src/cli'
import { createAccount, resetConfigPath, setConfigPath } from '../src/config/store'

describe('CLI process boundary', () => {
  let stdout = ''
  let stderr = ''
  let originalStdout: typeof process.stdout.write
  let originalStderr: typeof process.stderr.write

  beforeEach(() => {
    stdout = ''
    stderr = ''
    originalStdout = process.stdout.write
    originalStderr = process.stderr.write
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
      return true
    }) as typeof process.stderr.write
    process.exitCode = undefined
  })

  afterEach(() => {
    process.stdout.write = originalStdout
    process.stderr.write = originalStderr
    process.exitCode = undefined
    setGlobalFormat('markdown')
    _resetGlobalAccount()
    resetConfigPath()
  })

  test('formats Commander parse failures as one JSON document', async () => {
    await runCli(['node', 'cli-mail', '--format', 'json', 'does-not-exist'])

    const parsed = JSON.parse(stdout)
    expect(parsed).toMatchObject({
      ok: false,
      error: { code: 'CLI_USAGE_ERROR' },
    })
    expect(stdout.trim().split('\n').filter((line) => line === '{')).toHaveLength(1)
    expect(stderr).toBe('')
    expect(process.exitCode).toBe(1)
  })

  test.each([
    [['node', 'cli-mail', '--format', 'json', '--help'], 'help'],
    [['node', 'cli-mail', '--format', 'json', '--version'], 'version'],
  ] as const)('wraps successful Commander output in JSON', async (argv, type) => {
    await runCli(argv)
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      data: { type, text: expect.any(String) },
      meta: {},
      warnings: [],
    })
    expect(stderr).toBe('')
    expect(process.exitCode).toBeUndefined()
  })

  test('detects the compact -fjson form before parsing', async () => {
    await runCli(['node', 'cli-mail', '-fjson', 'does-not-exist'])
    expect(JSON.parse(stdout).error.code).toBe('CLI_USAGE_ERROR')
    expect(stderr).toBe('')
  })

  test('rejects invalid numeric options before a provider request', async () => {
    await runCli(['node', 'cli-mail', '--format', 'json', 'message', 'list', '--top', 'NaN'])
    expect(JSON.parse(stdout).error).toMatchObject({ code: 'CLI_USAGE_ERROR' })
    expect(process.exitCode).toBe(1)
  })

  test('requires confirmation for permanent deletion', async () => {
    await runCli([
      'node', 'cli-mail', '--format', 'json',
      'message', 'delete', 'message-id', '--permanent',
    ])
    expect(JSON.parse(stdout).error).toMatchObject({
      code: 'CONFIG_ERROR',
      message: expect.stringContaining('--yes'),
    })
    expect(process.exitCode).toBe(1)
  })

  test('keeps removed commands as hidden migration stubs', async () => {
    await runCli(['node', 'cli-mail', '--format', 'json', 'delegate', 'list'])
    expect(JSON.parse(stdout).error).toMatchObject({
      code: 'COMMAND_REMOVED',
      message: expect.stringContaining('removed in cli-mail 0.2'),
    })
    expect(process.exitCode).toBe(1)
  })

  test('requires --yes for permanent-delete rules before account resolution', async () => {
    await runCli([
      'node', 'cli-mail', '--format', 'json',
      'rule', 'create', '--json', '{"actions":{"permanentDelete":true}}',
    ])
    expect(JSON.parse(stdout).error).toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
      message: expect.stringContaining('--yes'),
    })
  })

  test('requires permanent-delete capability for rules', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cli-mail-rule-'))
    const configPath = join(directory, 'accounts.json')
    try {
      setConfigPath(configPath)
      createAccount({
        alias: 'limited',
        provider: 'outlook',
        email: 'limited@example.com',
        client_id: 'public-client',
        tokens: {
          access_token: 'access',
          refresh_token: 'refresh',
          expires_at: Date.now() + 60_000,
          token_type: 'Bearer',
          scope: 'User.Read',
        },
      })

      await runCli([
        'node', 'cli-mail', '--format', 'json', '--config', configPath,
        'rule', 'create', '--json', '{"actions":{"permanentDelete":true}}', '--yes',
      ])
      expect(JSON.parse(stdout).error.code).toBe('CAPABILITY_REQUIRED')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
