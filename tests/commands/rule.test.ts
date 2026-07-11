import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ruleList } from '../../src/commands/rule'
import * as resolveModule from '../../src/commands/resolve'
import * as formatter from '../../src/output/formatter'
import * as gmailFilters from '../../src/providers/gmail/filters'
import * as outlookRules from '../../src/providers/outlook/rules'

vi.mock('../../src/commands/resolve', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/commands/resolve')>(),
  resolveAccount: vi.fn(),
}))
vi.mock('../../src/output/formatter', () => ({
  output: vi.fn(),
  outputList: vi.fn(),
  outputSuccess: vi.fn(),
}))
vi.mock('../../src/providers/gmail/filters', () => ({ listFilters: vi.fn() }))
vi.mock('../../src/providers/outlook/rules', () => ({ listRules: vi.fn() }))

describe('rule command output contracts', () => {
  beforeEach(() => vi.clearAllMocks())

  test('Gmail rule data keeps condition and action objects', async () => {
    const client = {} as never
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'gmail' } as never,
      client,
    })
    vi.mocked(gmailFilters.listFilters).mockResolvedValue([{
      id: 'filter-1',
      conditions: { from: 'sender@example.com' },
      actions: { addLabelIds: ['STARRED'] },
    }])

    await ruleList({})

    expect(formatter.outputList).toHaveBeenCalledWith(
      [{
        id: 'filter-1',
        conditions: { from: 'sender@example.com' },
        actions: { addLabelIds: ['STARRED'] },
      }],
      expect.any(Array),
    )
  })

  test('Outlook rule data keeps enabled as a boolean', async () => {
    const client = {} as never
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'outlook' } as never,
      client,
    })
    vi.mocked(outlookRules.listRules).mockResolvedValue([{
      id: 'rule-1',
      name: 'Important',
      isEnabled: true,
      conditions: { importance: 'high' },
      actions: { moveToFolder: 'archive' },
    }])

    await ruleList({})

    expect(formatter.outputList).toHaveBeenCalledWith(
      [{
        id: 'rule-1',
        name: 'Important',
        enabled: true,
        conditions: { importance: 'high' },
        actions: { moveToFolder: 'archive' },
      }],
      expect.any(Array),
    )
  })
})
