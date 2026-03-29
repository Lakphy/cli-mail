// Global test setup — redirect config path to a temp directory
// to prevent tests from modifying ~/.cli-mail/accounts.json

import { join } from 'node:path'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { setConfigPath, resetConfigPath } from '../src/config/store'
import { afterAll, beforeAll } from 'vitest'

const TEST_CONFIG_DIR = join(import.meta.dirname, '..', '.test-config')
const TEST_CONFIG_FILE = join(TEST_CONFIG_DIR, 'accounts.json')

beforeAll(() => {
  // Ensure test config directory exists
  if (!existsSync(TEST_CONFIG_DIR)) {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true })
  }
  // Redirect all config operations to the test directory
  setConfigPath(TEST_CONFIG_FILE)
})

afterAll(() => {
  // Reset config path back to default
  resetConfigPath()
  // Clean up test config directory
  if (existsSync(TEST_CONFIG_DIR)) {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true })
  }
})
