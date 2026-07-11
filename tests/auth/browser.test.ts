import { afterEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  factory: vi.fn(),
  open: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('open', () => {
  mocks.factory()
  return { default: mocks.open }
})

import { launchSystemBrowser, openOrShowUrl } from '../../src/auth/browser'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('browser authorization helpers', () => {
  test('loads and caches open only when the system launcher is used', async () => {
    expect(mocks.factory).not.toHaveBeenCalled()

    await launchSystemBrowser('https://example.test/one')
    await launchSystemBrowser('https://example.test/two')

    expect(mocks.factory).toHaveBeenCalledTimes(1)
    expect(mocks.open).toHaveBeenNthCalledWith(
      1,
      'https://example.test/one',
      { wait: false },
    )
    expect(mocks.open).toHaveBeenNthCalledWith(
      2,
      'https://example.test/two',
      { wait: false },
    )
  })

  test('shows the URL and reports a failed browser launch without throwing', async () => {
    const notify = vi.fn()
    const launch = vi.fn().mockRejectedValue(new Error('no browser'))
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(openOrShowUrl(
      'https://example.test/authorize',
      launch,
      notify,
    )).resolves.toBeUndefined()

    expect(notify).toHaveBeenCalledWith('https://example.test/authorize')
    expect(launch).toHaveBeenCalledWith('https://example.test/authorize')
    expect(stderr).toHaveBeenCalledWith(
      'Could not open the system browser; use the authorization URL above.\n',
    )
  })
})
