import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// Output Formatter Tests
// ==========================================================

import {
  output, outputList, outputSuccess, outputError, outputRaw, setGlobalFormat, getGlobalFormat,
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
  })

  describe('markdown format', () => {
    test('output renders object as markdown key-value', () => {
      output({ name: 'Alice', email: 'alice@example.com' }, 'markdown')
      expect(captured).toContain('**name**: Alice')
      expect(captured).toContain('**email**: alice@example.com')
    })

    test('outputList renders markdown table', () => {
      outputList(
        [{ id: '1', name: 'Inbox' }, { id: '2', name: 'Sent' }],
        [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }],
        'markdown',
      )
      expect(captured).toContain('| ID | Name |')
      expect(captured).toContain('| 1 | Inbox |')
      expect(captured).toContain('| 2 | Sent |')
    })

    test('outputList includes separator row', () => {
      outputList(
        [{ id: '1' }],
        [{ key: 'id', label: 'ID' }],
        'markdown',
      )
      expect(captured).toContain('| --- |')
    })

    test('outputList shows empty message', () => {
      outputList([], [{ key: 'id', label: 'ID' }], 'markdown')
      expect(captured).toContain('No items found.')
    })

    test('outputList escapes pipes in cell values', () => {
      outputList(
        [{ content: 'a|b|c' }],
        [{ key: 'content', label: 'Content' }],
        'markdown',
      )
      expect(captured).toContain('a\\|b\\|c')
    })

    test('outputList replaces newlines in cell values', () => {
      outputList(
        [{ content: 'line1\nline2' }],
        [{ key: 'content', label: 'Content' }],
        'markdown',
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
        'markdown',
      )
      expect(captured).toContain('✓')
      expect(captured).toContain('✗')
    })

    test('outputSuccess shows checkmark in blockquote', () => {
      outputSuccess('Done!')
      expect(captured).toContain('> ✓ Done!')
    })

    test('outputRaw outputs as-is with trailing newline', () => {
      outputRaw('raw content')
      expect(captured).toBe('raw content\n')
    })

    test('outputRaw does not add extra newline if already present', () => {
      outputRaw('content\n')
      expect(captured).toBe('content\n')
    })

    test('output handles nested objects', () => {
      output({ user: { name: 'Alice', age: 30 } }, 'markdown')
      expect(captured).toContain('**user**:')
      expect(captured).toContain('**name**: Alice')
    })

    test('output handles arrays in objects', () => {
      output({ tags: ['a', 'b', 'c'] }, 'markdown')
      expect(captured).toContain('**tags**:')
      expect(captured).toContain('- a')
      expect(captured).toContain('- b')
    })

    test('output handles empty arrays', () => {
      output({ tags: [] }, 'markdown')
      expect(captured).toContain('(empty)')
    })

    test('output handles null', () => {
      output(null, 'markdown')
      expect(captured).toContain('null')
    })

    test('output handles primitive values', () => {
      output('hello', 'markdown')
      expect(captured).toContain('hello')
    })

    test('output skips undefined values in objects', () => {
      output({ a: 'visible', b: undefined }, 'markdown')
      expect(captured).toContain('**a**: visible')
      expect(captured).not.toContain('**b**')
    })

    test('output handles boolean values as checkmarks', () => {
      output({ active: true, disabled: false }, 'markdown')
      expect(captured).toContain('**active**: ✓')
      expect(captured).toContain('**disabled**: ✗')
    })

    test('output handles number values', () => {
      output({ count: 42 }, 'markdown')
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
  })

  describe('json format', () => {
    test('output renders JSON with indentation', () => {
      output({ name: 'Alice' }, 'json')
      const parsed = JSON.parse(captured)
      expect(parsed.name).toBe('Alice')
    })

    test('outputList renders JSON array with full items', () => {
      outputList(
        [{ id: '1', extra: 'data' }, { id: '2', extra: 'more' }],
        [{ key: 'id', label: 'ID' }],
        'json',
      )
      const parsed = JSON.parse(captured)
      expect(parsed).toHaveLength(2)
      // JSON mode outputs full items, not just column-filtered data
      expect(parsed[0].extra).toBe('data')
      expect(parsed[1].extra).toBe('more')
    })

    test('outputList preserves boolean types in JSON', () => {
      outputList(
        [{ name: 'msg1', read: true, flagged: false }],
        [{ key: 'name', label: 'Name' }, { key: 'read', label: 'Read' }],
        'json',
      )
      const parsed = JSON.parse(captured)
      expect(parsed[0].read).toBe(true)
      expect(parsed[0].flagged).toBe(false)
    })

    test('outputSuccess renders JSON success object', () => {
      setGlobalFormat('json')
      outputSuccess('Operation complete')
      const parsed = JSON.parse(captured)
      expect(parsed.success).toBe(true)
      expect(parsed.message).toBe('Operation complete')
    })

    test('outputError renders JSON error to stdout', () => {
      setGlobalFormat('json')
      outputError('Something failed', { code: 'FAIL', statusCode: 400 })
      const parsed = JSON.parse(captured)
      expect(parsed.error).toBe('Something failed')
      expect(parsed.code).toBe('FAIL')
      expect(parsed.statusCode).toBe(400)
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
      outputList(items, columns, 'json')
      const jsonOutput = JSON.parse(captured)
      captured = ''

      // Get markdown output
      outputList(items, columns, 'markdown')
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
      expect(getGlobalFormat()).toBe('json')
      output({ test: true })
      expect(() => JSON.parse(captured)).not.toThrow()
    })

    test('markdown is the default format', () => {
      expect(getGlobalFormat()).toBe('markdown')
    })
  })
})
