import { beforeEach, describe, expect, test, vi } from 'vitest'
import { groupShow } from '../../src/commands/group'
import * as configStore from '../../src/config/store'
import * as formatter from '../../src/output/formatter'

vi.mock('../../src/config/store', () => ({
  loadConfig: vi.fn(),
  getAccountsByTag: vi.fn(),
  listTags: vi.fn(),
}))
vi.mock('../../src/output/formatter', () => ({
  output: vi.fn(),
  outputList: vi.fn(),
}))
vi.mock('../../src/utils/error', () => ({ handleError: vi.fn() }))

describe('group commands', () => {
  beforeEach(() => vi.clearAllMocks())

  test('groupShow filters the config it already loaded', () => {
    const account = {
      id: 'account-1',
      alias: 'work',
      provider: 'gmail',
      email: 'work@example.com',
      tag: 'team',
    } as never
    const config = { defaultAccountId: 'account-1', accounts: [account] } as never
    vi.mocked(configStore.loadConfig).mockReturnValue(config)
    vi.mocked(configStore.getAccountsByTag).mockReturnValue([account])

    groupShow('team')

    expect(configStore.loadConfig).toHaveBeenCalledTimes(1)
    expect(configStore.getAccountsByTag).toHaveBeenCalledWith('team', config)
    expect(formatter.outputList).toHaveBeenCalledWith(
      [{
        alias: 'work',
        provider: 'gmail',
        email: 'work@example.com',
        default: true,
      }],
      expect.any(Array),
    )
  })
})
