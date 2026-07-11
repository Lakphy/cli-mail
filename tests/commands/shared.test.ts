import { beforeEach, describe, expect, test, vi } from 'vitest'
import { outputPageResult } from '../../src/commands/shared'
import * as formatter from '../../src/output/formatter'

vi.mock('../../src/output/formatter', () => ({
  outputList: vi.fn(),
  outputPartial: vi.fn(),
}))

describe('paginated command output', () => {
  beforeEach(() => vi.clearAllMocks())

  test('emits the shared exit-code-2 item error contract', () => {
    outputPageResult(
      [{ id: 'ok' }],
      [{ key: 'id', label: 'ID' }],
      {
        meta: { nextToken: 'next' },
        errors: [{ id: 'bad', message: 'failed' }],
        failCode: 'PAGE_FAILED',
        failMessage: 'Every item failed',
        itemCode: 'ITEM_FAILED',
      },
    )

    expect(formatter.outputPartial).toHaveBeenCalledWith(
      [{ id: 'ok' }],
      [{ code: 'ITEM_FAILED', message: 'failed', item: { id: 'bad' } }],
      { meta: { nextToken: 'next' } },
    )
  })

  test('throws the configured page error when every item failed', () => {
    expect(() => outputPageResult(
      [],
      [{ key: 'id', label: 'ID' }],
      {
        errors: [{ id: 'bad', message: 'failed' }],
        failCode: 'PAGE_FAILED',
        failMessage: 'Every item failed',
        itemCode: 'ITEM_FAILED',
      },
    )).toThrow(expect.objectContaining({
      code: 'PAGE_FAILED',
      message: 'Every item failed',
    }))
  })
})
