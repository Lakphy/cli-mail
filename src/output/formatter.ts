// Central CLI output contract. Markdown remains human-friendly; JSON is stable for automation.

import { redactSensitive, redactText } from '../utils/redact.js'

export type OutputFormat = 'markdown' | 'json'

export type OutputMeta = Record<string, unknown>

export interface OutputOptions {
  format?: OutputFormat
  meta?: OutputMeta
  warnings?: string[]
}

export interface OutputColumn {
  key: string
  label: string
  /** Markdown-only display formatter. JSON always retains the original item value. */
  format?: (value: unknown, item: Record<string, unknown>) => string
}

export interface ErrorPayload {
  code: string
  message: string
  statusCode?: number
  details?: unknown
  suggestion?: string
}

export interface PartialError {
  code: string
  message: string
  item?: unknown
  details?: unknown
}

let globalFormat: OutputFormat = 'markdown'

export function setGlobalFormat(format: OutputFormat): void {
  globalFormat = format
}

export function output(
  data: unknown,
  options: OutputOptions = {},
): void {
  const format = options.format ?? globalFormat
  if (format === 'json') {
    writeJson({
      ok: true,
      data,
      meta: options.meta ?? {},
      warnings: redactWarnings(options.warnings),
    })
    return
  }

  process.stdout.write(`${formatAsMarkdown(data)}\n`)
  writeMarkdownMeta(options.meta)
  writeMarkdownWarnings(options.warnings)
}

export function outputList(
  items: Record<string, unknown>[],
  columns: OutputColumn[],
  options: OutputOptions = {},
): void {
  const format = options.format ?? globalFormat
  if (format === 'json') {
    writeJson({
      ok: true,
      data: items,
      meta: options.meta ?? {},
      warnings: redactWarnings(options.warnings),
    })
    return
  }

  if (items.length === 0) {
    process.stdout.write('No items found.\n')
    writeMarkdownMeta(options.meta)
    writeMarkdownWarnings(options.warnings)
    return
  }

  const header = `| ${columns.map((column) => column.label).join(' | ')} |`
  const separator = `| ${columns
    .map((column) => '-'.repeat(Math.max(column.label.length, 3)))
    .join(' | ')} |`
  const rows = items.map((item) => {
    const cells = columns.map((column) => {
      const value = getNestedValue(item, column.key)
      return formatCellValue(column.format ? column.format(value, item) : value)
    })
    return `| ${cells.join(' | ')} |`
  })

  process.stdout.write(`${[header, separator, ...rows].join('\n')}\n`)
  writeMarkdownMeta(options.meta)
  writeMarkdownWarnings(options.warnings)
}

export function outputSuccess(
  message: string,
  data?: Record<string, unknown>,
  options: OutputOptions = {},
): void {
  const value = data ? { message, ...data } : { message }
  if (globalFormat === 'json') {
    writeJson({
      ok: true,
      data: value,
      meta: options.meta ?? {},
      warnings: redactWarnings(options.warnings),
    })
    return
  }

  process.stdout.write(`> ✓ ${terminalSafe(message)}\n`)
  writeMarkdownWarnings(options.warnings)
}

export function outputPartial(
  data: unknown,
  errors: PartialError[],
  options: OutputOptions = {},
): void {
  process.exitCode = 2
  if (globalFormat === 'json') {
    writeJson({
      ok: false,
      partial: true,
      data,
      meta: options.meta ?? {},
      warnings: redactWarnings(options.warnings),
      errors: redactSensitive(errors),
    })
    return
  }

  process.stdout.write(`${formatAsMarkdown(data)}\n`)
  for (const error of errors) {
    process.stderr.write(`> ⚠ **${terminalSafe(error.code)}**: ${terminalSafe(redactText(error.message))}\n`)
  }
  writeMarkdownMeta(options.meta)
  writeMarkdownWarnings(options.warnings)
}

export function outputError(error: string, options: Omit<ErrorPayload, 'message' | 'code'> & { code?: string } = {}): void {
  outputFailure({
    code: options.code ?? 'UNKNOWN_ERROR',
    message: error,
    ...(options.statusCode !== undefined ? { statusCode: options.statusCode } : {}),
    ...(options.details !== undefined ? { details: options.details } : {}),
    ...(options.suggestion ? { suggestion: options.suggestion } : {}),
  })
}

export function outputFailure(error: ErrorPayload): void {
  const safeError = redactSensitive(error) as ErrorPayload
  if (globalFormat === 'json') {
    writeJson({ ok: false, error: safeError })
    return
  }

  let markdown = `> ❌ **Error**: ${terminalSafe(safeError.message)}\n> **Code**: ${terminalSafe(safeError.code)}\n`
  if (safeError.statusCode !== undefined) markdown += `> **Status**: ${safeError.statusCode}\n`
  if (safeError.details !== undefined) {
    const details = typeof safeError.details === 'string'
      ? terminalSafe(safeError.details)
      : JSON.stringify(safeError.details)
    markdown += `> **Details**: ${details}\n`
  }
  if (safeError.suggestion) markdown += `> 💡 **Suggestion**: ${terminalSafe(safeError.suggestion)}\n`
  process.stderr.write(markdown)
}

/** Write an RFC 822/MIME payload without changing its bytes. */
export function outputRaw(value: string | Buffer): void {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
  if (globalFormat === 'json') {
    output({
      content: bytes.toString('base64'),
      encoding: 'base64',
      mediaType: 'message/rfc822',
      byteLength: bytes.byteLength,
    })
    return
  }

  process.stdout.write(bytes)
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function writeMarkdownWarnings(warnings: string[] | undefined): void {
  for (const warning of redactWarnings(warnings)) process.stderr.write(`> ⚠ ${terminalSafe(warning)}\n`)
}

function writeMarkdownMeta(meta: OutputMeta | undefined): void {
  if (!meta) return
  if (typeof meta.nextToken === 'string') {
    process.stdout.write(`\n**nextToken**: ${terminalSafe(meta.nextToken)}\n`)
  }
}

function formatAsMarkdown(data: unknown, depth = 0): string {
  if (data === null || data === undefined) return 'null'
  if (typeof data === 'string') return terminalSafe(data)
  if (typeof data === 'number') return String(data)
  if (typeof data === 'boolean') return data ? '✓' : '✗'

  if (Array.isArray(data)) {
    if (data.length === 0) return '(empty list)'
    return data.map((item, index) => `${index + 1}. ${formatAsMarkdown(item, depth + 1)}`).join('\n')
  }

  if (typeof data === 'object') {
    const lines: string[] = []
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (value === undefined) continue
      const safeKey = terminalSafe(key)
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        lines.push(`**${safeKey}**:`)
        lines.push(formatAsMarkdown(value, depth + 1).split('\n').map((line) => `  ${line}`).join('\n'))
      } else if (Array.isArray(value)) {
        lines.push(`**${safeKey}**:`)
        if (value.length === 0) lines.push('  (empty)')
        else for (const item of value) lines.push(`  - ${formatAsMarkdown(item, depth + 1).replace(/\n/g, '\n    ')}`)
      } else {
        lines.push(`**${safeKey}**: ${formatCellValue(value)}`)
      }
    }
    return lines.join('\n')
  }

  return String(data)
}

function getNestedValue(object: Record<string, unknown>, path: string): unknown {
  let current: unknown = object
  for (const part of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (typeof value === 'object') return JSON.stringify(value)
  return terminalSafe(String(value)).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function redactWarnings(warnings: string[] | undefined): string[] {
  return (warnings ?? []).map(redactText)
}

function terminalSafe(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
}
