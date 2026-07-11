import { describe, expect, test } from 'vitest'
import { sanitizeAttachmentFileName } from '../../src/commands/attachment'

describe('attachment filename safety', () => {
  test.each([
    ['../../.zshenv', 'attachment-zshenv'],
    ['.bash_profile', 'attachment-bash_profile'],
    ['CON', 'attachment-CON'],
    ['..\\..\\NUL.txt', 'attachment-._.._NUL.txt'],
    ['report\u001b]0;owned.pdf', 'report]0;owned.pdf'],
  ])('sanitizes %s', (input, expected) => {
    expect(sanitizeAttachmentFileName(input, 'a1')).toBe(expected)
  })

  test('uses a safe fallback for empty or traversal-only names', () => {
    expect(sanitizeAttachmentFileName('../..', 'id/1')).toBe('attachment-id_1')
    expect(sanitizeAttachmentFileName('\0\r\n', 'x')).toBe('attachment-x')
  })
})
