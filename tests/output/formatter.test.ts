import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ==========================================================
// Output Formatter Tests
// ==========================================================

import {
  output, outputList, outputSuccess, outputRaw, setGlobalFormat, getGlobalFormat,
} from '../../src/output/formatter'

describe('Output Formatter', () => {
  let originalWrite: typeof process.stdout.write
  let captured: string

  beforeEach(() => {
    captured = ''
    originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string) => {
      captured += chunk
      return true
    }) as typeof process.stdout.write
  })

  afterEach(() => {
    process.stdout.write = originalWrite
    setGlobalFormat('text')
  })

  describe('text format (markdown)', () => {
    test('output renders object as markdown key-value', () => {
      output({ name: 'Alice', email: 'alice@example.com' }, 'text')
      expect(captured).toContain('**name**: Alice')
      expect(captured).toContain('**email**: alice@example.com')
    })

    test('outputList renders markdown table', () => {
      outputList(
        [{ id: '1', name: 'Inbox' }, { id: '2', name: 'Sent' }],
        [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }],
        'text',
      )
      expect(captured).toContain('| ID | Name |')
      expect(captured).toContain('| 1 | Inbox |')
      expect(captured).toContain('| 2 | Sent |')
    })

    test('outputList includes separator row', () => {
      outputList(
        [{ id: '1' }],
        [{ key: 'id', label: 'ID' }],
        'text',
      )
      expect(captured).toContain('| --- |')
    })

    test('outputList shows empty message', () => {
      outputList([], [{ key: 'id', label: 'ID' }], 'text')
      expect(captured).toContain('No items found.')
    })

    test('outputList escapes pipes in cell values', () => {
      outputList(
        [{ content: 'a|b|c' }],
        [{ key: 'content', label: 'Content' }],
        'text',
      )
      expect(captured).toContain('a\\|b\\|c')
    })

    test('outputList replaces newlines in cell values', () => {
      outputList(
        [{ content: 'line1\nline2' }],
        [{ key: 'content', label: 'Content' }],
        'text',
      )
      // Newlines in cell values should be replaced with spaces
      expect(captured).toContain('line1 line2')
    })

    test('outputSuccess shows checkmark', () => {
      outputSuccess('Done!')
      expect(captured).toContain('✓ Done!')
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
      output({ user: { name: 'Alice', age: 30 } }, 'text')
      expect(captured).toContain('**user**:')
      expect(captured).toContain('**name**: Alice')
    })

    test('output handles arrays in objects', () => {
      output({ tags: ['a', 'b', 'c'] }, 'text')
      expect(captured).toContain('**tags**:')
      expect(captured).toContain('- a')
      expect(captured).toContain('- b')
    })

    test('output handles empty arrays', () => {
      output({ tags: [] }, 'text')
      expect(captured).toContain('(empty)')
    })

    test('output handles null', () => {
      output(null, 'text')
      expect(captured).toContain('null')
    })

    test('output handles primitive values', () => {
      output('hello', 'text')
      expect(captured).toContain('hello')
    })

    test('output skips undefined values in objects', () => {
      output({ a: 'visible', b: undefined }, 'text')
      expect(captured).toContain('**a**: visible')
      expect(captured).not.toContain('**b**')
    })

    test('output handles boolean and number values', () => {
      output({ active: true, count: 42 }, 'text')
      expect(captured).toContain('**active**: true')
      expect(captured).toContain('**count**: 42')
    })
  })

  describe('json format', () => {
    test('output renders JSON with indentation', () => {
      output({ name: 'Alice' }, 'json')
      const parsed = JSON.parse(captured)
      expect(parsed.name).toBe('Alice')
    })

    test('outputList renders JSON array', () => {
      outputList([{ id: '1' }, { id: '2' }], [{ key: 'id', label: 'ID' }], 'json')
      const parsed = JSON.parse(captured)
      expect(parsed).toHaveLength(2)
    })

    test('outputSuccess renders JSON success object', () => {
      setGlobalFormat('json')
      outputSuccess('Operation complete')
      const parsed = JSON.parse(captured)
      expect(parsed.success).toBe(true)
      expect(parsed.message).toBe('Operation complete')
    })
  })

  describe('global format', () => {
    test('setGlobalFormat changes default', () => {
      setGlobalFormat('json')
      expect(getGlobalFormat()).toBe('json')
      output({ test: true })
      expect(() => JSON.parse(captured)).not.toThrow()
    })

    test('text is the default format', () => {
      expect(getGlobalFormat()).toBe('text')
    })
  })
})
