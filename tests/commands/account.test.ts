import { describe, test, expect, beforeEach, vi } from 'vitest'
import { accountList, accountInfo, accountSwitch } from '../../src/commands/account'
import { loadConfig, saveConfig, getAccount, setDefaultAccount } from '../../src/config/store'
import * as formatterModule from '../../src/output/formatter'

vi.mock('../../src/config/store', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  getAccount: vi.fn(),
  setDefaultAccount: vi.fn(),
}))
vi.mock('../../src/output/formatter', () => ({
  outputList: vi.fn(),
  output: vi.fn(),
  outputSuccess: vi.fn(),
  getGlobalFormat: vi.fn().mockReturnValue('text'),
}))
vi.mock('../../src/utils/error', () => ({
  handleError: vi.fn()
}))

describe('Account Command Handlers', () => {
  const dummyConfig = {
    default_account: 'test1',
    accounts: [
      { provider: 'gmail', alias: 'test1', client_id: 'x' },
      { provider: 'outlook', alias: 'test2', client_id: 'y' }
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
    expect(formatterModule.outputSuccess).toHaveBeenCalledWith(expect.stringContaining('test2'))
  })
})
