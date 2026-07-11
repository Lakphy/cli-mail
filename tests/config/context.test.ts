import { beforeEach, describe, expect, test } from 'vitest'
import {
  _resetGlobalAccount,
  createCli,
  getGlobalAccount,
} from '../../src/cli'
import {
  getGlobalAccount as getContextAccount,
  setGlobalAccount,
} from '../../src/config/context'

describe('CLI account context', () => {
  beforeEach(() => {
    _resetGlobalAccount()
  })

  test('preserves the CLI helper exports over the lower context module', () => {
    setGlobalAccount('shared-account')
    expect(getGlobalAccount()).toBe('shared-account')

    _resetGlobalAccount()
    expect(getContextAccount()).toBeUndefined()
  })

  test('the root --account option updates the shared resolution context', async () => {
    const program = createCli()
    program.command('context-probe').action(() => undefined)

    await program.parseAsync([
      'node',
      'cli-mail',
      '--account',
      'global-account',
      'context-probe',
    ])

    expect(getContextAccount()).toBe('global-account')
  })
})
