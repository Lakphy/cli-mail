import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// Output Formatter Tests
// ==========================================================

import {
  output, outputList, outputSuccess, outputError, outputPartial, outputRaw, setGlobalFormat,
} from '../../src/output/formatter'

describe('Output Formatter', () => {
  let originalWrite: typeof process.stdout.write
  let originalStderrWrite: typeof process.stderr.write
  let captured: string
  let capturedStderr: string

  beforeEach(() => {
    captured = ''
    capturedStderr = ''
    originalWrite = process.stdout.write
    originalStderrWrite = process.stderr.write
    process.stdout.write = ((chunk: string) => {
      captured += chunk
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string) => {
      capturedStderr += chunk
      return true
    }) as typeof process.stderr.write
  })

  afterEach(() => {
    process.stdout.write = originalWrite
    process.stderr.write = originalStderrWrite
    setGlobalFormat('markdown')
    process.exitCode = undefined
  })

  describe('markdown format', () => {
    test('output renders object as markdown key-value', () => {
      output({ name: 'Alice', email: 'alice@example.com' }, { format: 'markdown' })
      expect(captured).toContain('**name**: Alice')
      expect(captured).toContain('**email**: alice@example.com')
    })

    test('output renders nextToken metadata in markdown', () => {
      output({ history: [] }, {
        format: 'markdown',
        meta: { nextToken: 'opaque-next' },
      })
      expect(captured).toContain('**nextToken**: opaque-next')
    })

    test('outputPartial renders nextToken metadata in markdown', () => {
      outputPartial([{ id: 'ok' }], [{ code: 'FAILED', message: 'bad' }], {
        format: 'markdown',
        meta: { nextToken: 'partial-next' },
      })
      expect(captured).toContain('**nextToken**: partial-next')
    })

    test('outputList renders markdown table', () => {
      outputList(
        [{ id: '1', name: 'Inbox' }, { id: '2', name: 'Sent' }],
        [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }],
        { format: 'markdown' },
      )
      expect(captured).toContain('| ID | Name |')
      expect(captured).toContain('| 1 | Inbox |')
      expect(captured).toContain('| 2 | Sent |')
    })

    test('outputList includes separator row', () => {
      outputList(
        [{ id: '1' }],
        [{ key: 'id', label: 'ID' }],
        { format: 'markdown' },
      )
      expect(captured).toContain('| --- |')
    })

    test('outputList shows empty message', () => {
      outputList([], [{ key: 'id', label: 'ID' }], { format: 'markdown' })
      expect(captured).toContain('No items found.')
    })

    test('outputList escapes pipes in cell values', () => {
      outputList(
        [{ content: 'a|b|c' }],
        [{ key: 'content', label: 'Content' }],
        { format: 'markdown' },
      )
      expect(captured).toContain('a\\|b\\|c')
    })

    test('outputList replaces newlines in cell values', () => {
      outputList(
        [{ content: 'line1\nline2' }],
        [{ key: 'content', label: 'Content' }],
        { format: 'markdown' },
      )
      // Newlines in cell values should be replaced with spaces
      expect(captured).toContain('line1 line2')
    })

    test('outputList auto-formats booleans as checkmarks', () => {
      outputList(
        [{ name: 'msg1', read: true, flagged: false }],
        [
          { key: 'name', label: 'Name' },
          { key: 'read', label: 'Read' },
          { key: 'flagged', label: 'Flagged' },
        ],
        { format: 'markdown' },
      )
      expect(captured).toContain('✓')
      expect(captured).toContain('✗')
    })

    test('outputList supports a Markdown-only cell formatter', () => {
      outputList(
        [{ name: 'file.bin', size: 1536 }],
        [
          { key: 'name', label: 'Name' },
          { key: 'size', label: 'Size', format: (value) => `${Number(value) / 1024} KB` },
        ],
        { format: 'markdown' },
      )
      expect(captured).toContain('| file.bin | 1.5 KB |')
    })

    test('outputSuccess shows checkmark in blockquote', () => {
      outputSuccess('Done!')
      expect(captured).toContain('> ✓ Done!')
    })

    test('outputRaw preserves bytes without adding a newline', () => {
      outputRaw('raw content')
      expect(captured).toBe('raw content')
    })

    test('outputRaw does not add extra newline if already present', () => {
      outputRaw('content\n')
      expect(captured).toBe('content\n')
    })

    test('output handles nested objects', () => {
      output({ user: { name: 'Alice', age: 30 } }, { format: 'markdown' })
      expect(captured).toContain('**user**:')
      expect(captured).toContain('**name**: Alice')
    })

    test('output handles arrays in objects', () => {
      output({ tags: ['a', 'b', 'c'] }, { format: 'markdown' })
      expect(captured).toContain('**tags**:')
      expect(captured).toContain('- a')
      expect(captured).toContain('- b')
    })

    test('output handles empty arrays', () => {
      output({ tags: [] }, { format: 'markdown' })
      expect(captured).toContain('(empty)')
    })

    test('output handles null', () => {
      output(null, { format: 'markdown' })
      expect(captured).toContain('null')
    })

    test('output handles primitive values', () => {
      output('hello', { format: 'markdown' })
      expect(captured).toContain('hello')
    })

    test('output skips undefined values in objects', () => {
      output({ a: 'visible', b: undefined }, { format: 'markdown' })
      expect(captured).toContain('**a**: visible')
      expect(captured).not.toContain('**b**')
    })

    test('output handles boolean values as checkmarks', () => {
      output({ active: true, disabled: false }, { format: 'markdown' })
      expect(captured).toContain('**active**: ✓')
      expect(captured).toContain('**disabled**: ✗')
    })

    test('output handles number values', () => {
      output({ count: 42 }, { format: 'markdown' })
      expect(captured).toContain('**count**: 42')
    })

    test('outputError renders markdown error to stderr', () => {
      outputError('Something went wrong', {
        code: 'TEST_ERROR',
        statusCode: 500,
        suggestion: 'Try again later',
      })
      expect(capturedStderr).toContain('❌ **Error**: Something went wrong')
      expect(capturedStderr).toContain('**Code**: TEST_ERROR')
      expect(capturedStderr).toContain('**Status**: 500')
      expect(capturedStderr).toContain('💡 **Suggestion**: Try again later')
    })

    test('strips terminal control sequences from formatted provider data', () => {
      output({ subject: 'safe\u001b]0;owned\u0007\rtext\u202e' }, { format: 'markdown' })
      expect(captured).not.toMatch(/[\u001b\u0007\r\u202e]/)
      expect(captured).toContain('safe]0;ownedtext')
    })
  })

  describe('json format', () => {
    test('output renders JSON with indentation', () => {
      output({ name: 'Alice' }, { format: 'json' })
      const parsed = JSON.parse(captured)
      expect(parsed).toMatchObject({ ok: true, data: { name: 'Alice' }, meta: {}, warnings: [] })
    })

    test('outputList renders JSON array with full items', () => {
      outputList(
        [{ id: '1', extra: 'data' }, { id: '2', extra: 'more' }],
        [{ key: 'id', label: 'ID' }],
        { format: 'json' },
      )
      const parsed = JSON.parse(captured)
      expect(parsed.data).toHaveLength(2)
      // JSON mode outputs full items, not just column-filtered data
      expect(parsed.data[0].extra).toBe('data')
      expect(parsed.data[1].extra).toBe('more')
    })

    test('outputList preserves boolean types in JSON', () => {
      outputList(
        [{ name: 'msg1', read: true, flagged: false }],
        [{ key: 'name', label: 'Name' }, { key: 'read', label: 'Read' }],
        { format: 'json' },
      )
      const parsed = JSON.parse(captured)
      expect(parsed.data[0].read).toBe(true)
      expect(parsed.data[0].flagged).toBe(false)
    })

    test('outputList ignores cell formatters in JSON and preserves raw values', () => {
      outputList(
        [{ size: 1536 }],
        [{ key: 'size', label: 'Size', format: () => '1.5 KB' }],
        { format: 'json' },
      )
      expect(JSON.parse(captured).data).toEqual([{ size: 1536 }])
    })

    test('outputSuccess renders JSON success object', () => {
      setGlobalFormat('json')
      outputSuccess('Operation complete')
      const parsed = JSON.parse(captured)
      expect(parsed.ok).toBe(true)
      expect(parsed.data.message).toBe('Operation complete')
    })

    test('outputError renders JSON error to stdout', () => {
      setGlobalFormat('json')
      outputError('Something failed', { code: 'FAIL', statusCode: 400 })
      const parsed = JSON.parse(captured)
      expect(parsed.ok).toBe(false)
      expect(parsed.error.message).toBe('Something failed')
      expect(parsed.error.code).toBe('FAIL')
      expect(parsed.error.statusCode).toBe(400)
    })

    test('outputPartial uses the partial envelope and exit code 2', () => {
      setGlobalFormat('json')
      outputPartial([{ id: 'ok' }], [{ code: 'FETCH_FAILED', message: 'bad', item: { id: 'bad' } }], {
        meta: { nextToken: 'next' },
      })
      expect(JSON.parse(captured)).toEqual({
        ok: false,
        partial: true,
        data: [{ id: 'ok' }],
        meta: { nextToken: 'next' },
        warnings: [],
        errors: [{ code: 'FETCH_FAILED', message: 'bad', item: { id: 'bad' } }],
      })
      expect(process.exitCode).toBe(2)
    })

    test('outputRaw returns base64 metadata in JSON mode', () => {
      setGlobalFormat('json')
      outputRaw(Buffer.from([0, 255, 10]))
      const parsed = JSON.parse(captured)
      expect(parsed.ok).toBe(true)
      expect(parsed.data).toEqual({
        content: 'AP8K',
        encoding: 'base64',
        mediaType: 'message/rfc822',
        byteLength: 3,
      })
    })

    test('redacts secrets from error messages and details', () => {
      setGlobalFormat('json')
      outputError('request failed: https://example.test/?access_token=secret-value', {
        code: 'API_ERROR',
        details: {
          refresh_token: 'refresh-value',
          note: 'Bearer raw-access-token',
        },
      })
      const parsed = JSON.parse(captured)
      expect(parsed.error.message).not.toContain('secret-value')
      expect(parsed.error.details.refresh_token).toBe('[REDACTED]')
      expect(parsed.error.details.note).toBe('Bearer [REDACTED]')
    })
  })

  describe('content parity between markdown and json', () => {
    test('outputList passes same data to both formats', () => {
      const items = [
        { id: '1', name: 'Inbox', active: true, count: 5 },
        { id: '2', name: 'Sent', active: false, count: 0 },
      ]
      const columns = [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name' },
        { key: 'active', label: 'Active' },
        { key: 'count', label: 'Count' },
      ]

      // Get JSON output
      outputList(items, columns, { format: 'json' })
      const jsonOutput = JSON.parse(captured).data
      captured = ''

      // Get markdown output
      outputList(items, columns, { format: 'markdown' })
      const mdOutput = captured

      // JSON should have all fields
      expect(jsonOutput[0].id).toBe('1')
      expect(jsonOutput[0].active).toBe(true)
      expect(jsonOutput[1].active).toBe(false)

      // Markdown should display all column fields
      expect(mdOutput).toContain('| ID | Name | Active | Count |')
      expect(mdOutput).toContain('1')
      expect(mdOutput).toContain('Inbox')
      expect(mdOutput).toContain('✓')
      expect(mdOutput).toContain('✗')
    })
  })

  describe('global format', () => {
    test('setGlobalFormat changes default', () => {
      setGlobalFormat('json')
      output({ test: true })
      expect(() => JSON.parse(captured)).not.toThrow()
    })

    test('markdown is the default format', () => {
      output({ test: true })
      expect(captured).toContain('**test**: ✓')
    })
  })
})
