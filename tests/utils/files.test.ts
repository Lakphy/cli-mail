import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { getRegularFileSize, readRegularFile } from '../../src/utils/files'

describe('bounded regular file input', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cli-mail-files-'))
  })

  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  test('reads a bounded regular file', () => {
    const path = join(directory, 'message.eml')
    writeFileSync(path, Buffer.from([0, 1, 255]))
    expect(getRegularFileSize(path, 'Message', 10)).toBe(3)
    expect(readRegularFile(path, 'Message', 10)).toEqual(Buffer.from([0, 1, 255]))
  })

  test('rejects directories and oversized input', () => {
    expect(() => readRegularFile(directory, 'Message', 10)).toThrow(/regular file/)
    const path = join(directory, 'large')
    writeFileSync(path, '12345')
    expect(() => readRegularFile(path, 'Message', 4)).toThrow(/must not exceed/)
  })
})
