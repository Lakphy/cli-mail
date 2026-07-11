import { describe, test, expect, beforeEach, vi } from 'vitest'
import { accountList, accountInfo, accountSwitch, accountValidate } from '../../src/commands/account'
import { loadConfig, getAccountsByTag, getAccount, setDefaultAccount } from '../../src/config/store'
import * as formatterModule from '../../src/output/formatter'

vi.mock('../../src/config/store', () => ({
  loadConfig: vi.fn(),
  getAccountsByTag: vi.fn(),
  getAccount: vi.fn(),
  setDefaultAccount: vi.fn(),
}))
vi.mock('../../src/output/formatter', () => ({
  outputList: vi.fn(),
  output: vi.fn(),
  outputSuccess: vi.fn(),
}))
vi.mock('../../src/utils/error', () => ({
  handleError: vi.fn()
}))

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

  test('accountList filters with the config already loaded', async () => {
    vi.mocked(getAccountsByTag).mockReturnValue([dummyConfig.accounts[1]] as any)
    await accountList({ tag: 'work' })
    expect(loadConfig).toHaveBeenCalledTimes(1)
    expect(getAccountsByTag).toHaveBeenCalledWith('work', dummyConfig)
    const outputArg = vi.mocked(formatterModule.outputList).mock.calls[0][0]
    expect(outputArg.map((account) => account.alias)).toEqual(['test2'])
  })

  test('accountValidate selects an alias from its single config load', async () => {
    await accountValidate('test2')
    expect(loadConfig).toHaveBeenCalledTimes(1)
    expect(getAccount).not.toHaveBeenCalled()
    expect(formatterModule.output).toHaveBeenCalledWith(
      expect.objectContaining({
        accounts: [expect.objectContaining({ alias: 'test2' })],
      }),
      { warnings: [] },
    )
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
