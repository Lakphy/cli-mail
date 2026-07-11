import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ vacationSet: vi.fn() }))

vi.mock('../src/commands/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/settings')>()
  return { ...actual, vacationSet: mocks.vacationSet }
})

import { createCli } from '../src/cli'

describe('async Commander actions', () => {
  beforeEach(() => vi.clearAllMocks())

  test('waits for vacation settings mutation', async () => {
    let release!: () => void
    mocks.vacationSet.mockImplementation(() => new Promise<void>((resolve) => {
      release = resolve
    }))

    let completed = false
    const parsing = createCli()
      .parseAsync(['node', 'cli-mail', 'settings', 'vacation', 'set', '--disabled'])
      .then(() => { completed = true })

    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(completed).toBe(false)
    release()
    await parsing
    expect(completed).toBe(true)
  })
})
