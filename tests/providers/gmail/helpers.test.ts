import { describe, expect, test } from 'vitest'
import {
  headersToRecord,
  normalizeInternalDate,
  normalizeMessageSummary,
  sanitizeRemoteFilename,
  toMimeAttachments,
} from '../../../src/providers/gmail/helpers'

describe('Gmail shared helpers', () => {
  test('normalizes valid internal dates and returns undefined for every failure', () => {
    expect(normalizeInternalDate('0')).toBe('1970-01-01T00:00:00.000Z')
    expect(normalizeInternalDate()).toBeUndefined()
    expect(normalizeInternalDate('not-a-date')).toBeUndefined()
    expect(normalizeInternalDate(String(Number.MAX_VALUE))).toBeUndefined()
  })

  test('adapts an invalid internal date to the required empty summary date', () => {
    expect(normalizeMessageSummary({
      id: 'message-1',
      internalDate: 'not-a-date',
    }).date).toBe('')
  })

  test('maps headers with the same last-value-wins behavior', () => {
    expect(headersToRecord([
      { name: 'X-Test', value: 'first' },
      { name: 'X-Test', value: 'second' },
    ])).toEqual({ 'X-Test': 'second' })
  })

  test('sanitizes remote filenames and maps parsed attachment fields', () => {
    const content = Buffer.from('attachment')
    expect(sanitizeRemoteFilename('safe\r\nname\0.txt')).toBe('safe__name_.txt')
    expect(toMimeAttachments([{
      filename: 'safe\r\nname.txt',
      content,
      contentType: 'text/plain',
      contentDisposition: 'inline',
      cid: 'part-1',
    }])).toEqual([{
      filename: 'safe__name.txt',
      content,
      contentType: 'text/plain',
      contentDisposition: 'inline',
      cid: 'part-1',
    }])
  })
})
