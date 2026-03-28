// Output formatter — Markdown (default) and JSON modes
// Designed for AI consumption: markdown is default, JSON available via --format json
// IMPORTANT: Both modes MUST output identical data fields and values.

export type OutputFormat = 'markdown' | 'json'

let globalFormat: OutputFormat = 'markdown'

export function setGlobalFormat(format: OutputFormat): void {
  globalFormat = format
}

export function getGlobalFormat(): OutputFormat {
  return globalFormat
}

/**
 * Output a single object (e.g., a message, a folder)
 * Both markdown and JSON modes output the same data.
 */
export function output(data: unknown, format?: OutputFormat): void {
  const fmt = format || globalFormat
  if (fmt === 'json') {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  } else {
    process.stdout.write(formatAsMarkdown(data) + '\n')
  }
}

/**
 * Output a list of objects.
 *
 * - `columns` controls which fields appear in the markdown table and their display labels.
 * - In JSON mode, the full `items` array is always output (ignoring `columns`).
 * - Boolean values are automatically rendered as ✓/✗ in markdown.
 */
export function outputList(
  items: Record<string, unknown>[],
  columns: { key: string; label: string }[],
  format?: OutputFormat,
): void {
  const fmt = format || globalFormat
  if (fmt === 'json') {
    // JSON mode: output complete items, not filtered by columns
    process.stdout.write(JSON.stringify(items, null, 2) + '\n')
    return
  }

  if (items.length === 0) {
    process.stdout.write('No items found.\n')
    return
  }

  // Markdown table using the provided columns
  const header = '| ' + columns.map((c) => c.label).join(' | ') + ' |'
  const separator = '| ' + columns.map((c) => '-'.repeat(Math.max(c.label.length, 3))).join(' | ') + ' |'

  const rows = items.map((item) => {
    const cells = columns.map((c) => {
      const val = getNestedValue(item, c.key)
      return formatCellValue(val)
    })
    return '| ' + cells.join(' | ') + ' |'
  })

  process.stdout.write([header, separator, ...rows].join('\n') + '\n')
}

/**
 * Output a success message
 */
export function outputSuccess(message: string): void {
  if (globalFormat === 'json') {
    process.stdout.write(JSON.stringify({ success: true, message }) + '\n')
  } else {
    process.stdout.write(`> ✓ ${message}\n`)
  }
}

/**
 * Output an error in the current format
 */
export function outputError(
  error: string,
  opts?: { code?: string; statusCode?: number; details?: unknown; suggestion?: string },
): void {
  if (globalFormat === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          error,
          ...(opts?.code ? { code: opts.code } : {}),
          ...(opts?.statusCode ? { statusCode: opts.statusCode } : {}),
          ...(opts?.details ? { details: opts.details } : {}),
          ...(opts?.suggestion ? { suggestion: opts.suggestion } : {}),
        },
        null,
        2,
      ) + '\n',
    )
  } else {
    let md = `> ❌ **Error**: ${error}\n`
    if (opts?.code) {
      md += `> **Code**: ${opts.code}\n`
    }
    if (opts?.statusCode) {
      md += `> **Status**: ${opts.statusCode}\n`
    }
    if (opts?.details) {
      md += `> **Details**: ${typeof opts.details === 'string' ? opts.details : JSON.stringify(opts.details)}\n`
    }
    if (opts?.suggestion) {
      md += `> 💡 **Suggestion**: ${opts.suggestion}\n`
    }
    process.stderr.write(md)
  }
}

/**
 * Output raw text (for raw MIME content, etc.)
 */
export function outputRaw(text: string): void {
  process.stdout.write(text)
  if (!text.endsWith('\n')) {
    process.stdout.write('\n')
  }
}

// --- Internal helpers ---

function formatAsMarkdown(data: unknown, depth = 0): string {
  if (data === null || data === undefined) {
    return 'null'
  }

  if (typeof data === 'string' || typeof data === 'number') {
    return String(data)
  }

  if (typeof data === 'boolean') {
    return data ? '✓' : '✗'
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return '(empty list)'
    return data
      .map((item, i) => {
        const prefix = `${i + 1}. `
        const content = formatAsMarkdown(item, depth + 1)
        return prefix + content
      })
      .join('\n')
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const lines: string[] = []
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        lines.push(`**${key}**:`)
        const nested = formatAsMarkdown(value, depth + 1)
        const indented = nested
          .split('\n')
          .map((l) => '  ' + l)
          .join('\n')
        lines.push(indented)
      } else if (Array.isArray(value)) {
        lines.push(`**${key}**:`)
        if (value.length === 0) {
          lines.push('  (empty)')
        } else {
          for (const item of value) {
            lines.push('  - ' + formatAsMarkdown(item, depth + 1).replace(/\n/g, '\n    '))
          }
        }
      } else {
        lines.push(`**${key}**: ${formatCellValue(value)}`)
      }
    }
    return lines.join('\n')
  }

  return String(data)
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) return ''
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part]
    } else {
      return ''
    }
  }
  return current
}

/**
 * Format a cell value for markdown display.
 * Booleans are rendered as ✓/✗ for AI readability.
 */
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
