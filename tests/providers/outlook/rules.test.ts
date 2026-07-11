import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import { getRule, listRules } from '../../../src/providers/outlook/rules'

describe('Outlook message rules', () => {
  const mockClient = createMockHttpClient()

  beforeEach(() => vi.clearAllMocks())

  test('retains sequence and exceptions when normalizing list results', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({
      value: [{
        id: 'r1', displayName: 'Route mail', isEnabled: true, sequence: 7,
        conditions: { subjectContains: ['invoice'] },
        actions: { moveToFolder: 'finance' },
        exceptions: { senderContains: ['boss@example.com'] },
      }],
    })
    const [rule] = await listRules(mockClient)
    expect(rule).toMatchObject({
      id: 'r1', sequence: 7,
      exceptions: { senderContains: ['boss@example.com'] },
    })
  })

  test('retains sequence and exceptions for a single rule', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({
      id: 'r2', sequence: 2, exceptions: { isRead: true },
    })
    const rule = await getRule(mockClient, 'r2')
    expect(rule.sequence).toBe(2)
    expect(rule.exceptions).toEqual({ isRead: true })
  })
})
