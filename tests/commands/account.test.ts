import { describe, test, expect, beforeEach, vi } from 'vitest'
import { accountAdd, accountList, accountInfo, accountSwitch, accountValidate } from '../../src/commands/account'
import { createAccount, loadConfig, getAccountsByTag, getAccount, setDefaultAccount } from '../../src/config/store'
import * as formatterModule from '../../src/output/formatter'
import * as gmailProfile from '../../src/providers/gmail/profile'
import * as resolveModule from '../../src/commands/resolve'
import { gmailAuthFlow, readGmailDesktopCredentials } from '../../src/providers/gmail/auth'

vi.mock('../../src/config/store', () => ({
  loadConfig: vi.fn(),
  getAccountsByTag: vi.fn(),
  getAccount: vi.fn(),
  setDefaultAccount: vi.fn(),
  createAccount: vi.fn(),
}))
vi.mock('../../src/output/formatter', () => ({
  outputList: vi.fn(),
  output: vi.fn(),
  outputPartial: vi.fn(),
  outputSuccess: vi.fn(),
}))
vi.mock('../../src/providers/gmail/profile', () => ({ getProfile: vi.fn() }))
vi.mock('../../src/providers/gmail/auth', () => ({
  gmailAuthFlow: vi.fn(),
  readGmailDesktopCredentials: vi.fn(),
}))
vi.mock('../../src/providers/outlook/auth', () => ({ outlookAuthFlow: vi.fn() }))
vi.mock('../../src/commands/resolve', () => ({ createClientForAccount: vi.fn() }))
vi.mock('../../src/utils/error', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/error')>()
  return { ...actual, handleError: vi.fn((error: unknown) => { throw error }) }
})

describe('Account Command Handlers', () => {
  const dummyConfig = {
    defaultAccountId: 'account-1',
    accounts: [
      {
        id: 'account-1', provider: 'gmail', alias: 'test1', email: 'test1@example.com',
        client_id: 'x', status: 'active', scopes: [], tokens: { expires_at: Date.now() + 60_000 },
      },
      {
        id: 'account-2', provider: 'outlook', alias: 'test2', email: 'test2@example.com',
        client_id: 'y', status: 'active', scopes: [], tokens: { expires_at: Date.now() + 60_000 },
      }
    ]
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadConfig).mockReturnValue(dummyConfig as any)
    vi.mocked(resolveModule.createClientForAccount).mockReturnValue({
      get: vi.fn().mockResolvedValue({ mail: 'test2@example.com' }),
    } as any)
    vi.mocked(gmailProfile.getProfile).mockResolvedValue({
      emailAddress: 'test1@example.com',
    } as any)
  })

  test('accountList shows accounts nicely', async () => {
    await accountList()
    expect(loadConfig).toHaveBeenCalled()
    expect(formatterModule.outputList).toHaveBeenCalled()
    
    // Check what was outputted
    const outputArg = vi.mocked(formatterModule.outputList).mock.calls[0][0]
    expect(outputArg.length).toBe(2)
    expect(outputArg[0].alias).toContain('test1') // default might have a star
    expect(outputArg[0].provider).toBe('gmail')
  })

  test('accountAdd reads Gmail credentials once and binds that exact snapshot to OAuth', async () => {
    vi.mocked(readGmailDesktopCredentials).mockReturnValue({
      clientId: 'desktop-client',
      clientSecret: 'desktop-secret',
    })
    vi.mocked(gmailAuthFlow).mockResolvedValue({
      email: 'new@example.com',
      tokens: {
        access_token: 'access',
        refresh_token: 'refresh',
        expires_at: Date.now() + 60_000,
        token_type: 'Bearer',
      },
    })

    await accountAdd('gmail', { credentialsFile: '/tmp/credentials.json' })

    expect(readGmailDesktopCredentials).toHaveBeenCalledTimes(1)
    expect(gmailAuthFlow).toHaveBeenCalledWith({
      clientId: 'desktop-client',
      clientSecret: 'desktop-secret',
      fullAccess: undefined,
    })
    expect(createAccount).toHaveBeenCalledWith(expect.objectContaining({
      alias: 'new@example.com',
      client_id: 'desktop-client',
      client_secret: 'desktop-secret',
    }))
  })

  test('accountList filters with the config already loaded', async () => {
    vi.mocked(getAccountsByTag).mockReturnValue([dummyConfig.accounts[1]] as any)
    await accountList({ tag: 'work' })
    expect(loadConfig).toHaveBeenCalledTimes(1)
    expect(getAccountsByTag).toHaveBeenCalledWith('work', dummyConfig)
    const outputArg = vi.mocked(formatterModule.outputList).mock.calls[0][0]
    expect(outputArg.map((account) => account.alias)).toEqual(['test2'])
  })

  test('accountValidate performs an online identity check and reloads durable state', async () => {
    await accountValidate('test2')
    expect(loadConfig).toHaveBeenCalledTimes(2)
    expect(getAccount).not.toHaveBeenCalled()
    expect(resolveModule.createClientForAccount).toHaveBeenCalledWith(dummyConfig.accounts[1])
    expect(formatterModule.output).toHaveBeenCalledWith(
      expect.objectContaining({
        accounts: [expect.objectContaining({
          alias: 'test2',
          online_valid: true,
          identity_match: true,
        })],
      }),
      { warnings: [] },
    )
  })

  test('accountValidate reports partial online failures with exit-code-2 output', async () => {
    vi.mocked(resolveModule.createClientForAccount).mockImplementation((account: any) => ({
      get: account.provider === 'outlook'
        ? vi.fn().mockRejectedValue(new Error('offline'))
        : vi.fn(),
    }) as any)

    await accountValidate()

    expect(formatterModule.outputPartial).toHaveBeenCalledWith(
      expect.objectContaining({
        accounts: expect.arrayContaining([
          expect.objectContaining({ alias: 'test1', online_valid: true }),
          expect.objectContaining({ alias: 'test2', online_valid: false }),
        ]),
      }),
      [expect.objectContaining({ code: 'ACCOUNT_VALIDATION_FAILED' })],
      { warnings: [] },
    )
  })

  test('accountValidate treats zero accounts as a successful no-op', async () => {
    const empty = { defaultAccountId: null, accounts: [] }
    vi.mocked(loadConfig).mockReturnValue(empty as any)

    await accountValidate()

    expect(resolveModule.createClientForAccount).not.toHaveBeenCalled()
    expect(formatterModule.output).toHaveBeenCalledWith({
      defaultAccountId: null,
      defaultAccountValid: true,
      accounts: [],
    }, { warnings: [] })
  })

  test('accountValidate returns a structured failure when every account needs reauth', async () => {
    const unavailable = {
      ...dummyConfig,
      accounts: dummyConfig.accounts.map((account) => ({ ...account, status: 'needs_reauth' })),
    }
    vi.mocked(loadConfig).mockReturnValue(unavailable as any)

    await expect(accountValidate()).rejects.toMatchObject({
      code: 'ACCOUNT_VALIDATION_FAILED',
      details: {
        accounts: expect.arrayContaining([
          expect.objectContaining({ online_valid: false }),
        ]),
      },
    })
    expect(resolveModule.createClientForAccount).not.toHaveBeenCalled()
  })

  test('accountValidate limits online checks to four concurrent accounts', async () => {
    const accounts = Array.from({ length: 5 }, (_, index) => ({
      ...dummyConfig.accounts[0],
      id: `account-${index + 1}`,
      alias: `alias-${index + 1}`,
      email: `person-${index + 1}@example.com`,
    }))
    const config = { defaultAccountId: accounts[0].id, accounts }
    vi.mocked(loadConfig).mockReturnValue(config as any)
    vi.mocked(resolveModule.createClientForAccount).mockImplementation((account: any) => ({
      validationEmail: account.email,
    }) as any)

    let active = 0
    let maximum = 0
    const releases: Array<() => void> = []
    vi.mocked(gmailProfile.getProfile).mockImplementation(async (client: any) => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1
      return { emailAddress: client.validationEmail } as any
    })

    const validation = accountValidate()
    await waitFor(() => releases.length === 4)
    expect(maximum).toBe(4)
    releases.shift()?.()
    await waitFor(() => releases.length === 4)
    for (const release of releases.splice(0)) release()
    await validation

    expect(maximum).toBe(4)
  })

  test('accountInfo retrieves specific account', async () => {
    vi.mocked(getAccount).mockReturnValue({ provider: 'outlook', alias: 'test2', client_id: 'y', tokens: { expires_at: 1000 } } as any)
    await accountInfo('test2')
    expect(formatterModule.output).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'outlook' })
    )
  })

  test('accountInfo falls back to default if no alias provided', async () => {
    vi.mocked(getAccount).mockReturnValue({ provider: 'gmail', alias: 'test1', client_id: 'x', tokens: { expires_at: 1000 } } as any)
    await accountInfo(undefined)
    expect(formatterModule.output).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gmail', alias: 'test1' })
    )
  })

  test('accountSwitch updates config correctly', async () => {
    vi.mocked(setDefaultAccount).mockImplementation(() => {})
    await accountSwitch('test2')
    expect(setDefaultAccount).toHaveBeenCalledWith('test2')
    expect(formatterModule.outputSuccess).toHaveBeenCalledWith(
      expect.stringContaining('test2'),
      expect.objectContaining({ alias: 'test2' }),
    )
  })
})

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error('Timed out waiting for validation work')
}
