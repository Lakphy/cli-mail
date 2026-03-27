// Output formatter — Markdown text (default) and JSON modes
// Designed for AI consumption: markdown is default, JSON available via --format json

export type OutputFormat = 'text' | 'json'

let globalFormat: OutputFormat = 'text'

export function setGlobalFormat(format: OutputFormat): void {
  globalFormat = format
}

export function getGlobalFormat(): OutputFormat {
  return globalFormat
}

/**
 * Output a single object (e.g., a message, a folder)
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
 * Output a list of objects as a table
 */
export function outputList(
  items: Record<string, unknown>[],
  columns: { key: string; label: string }[],
  format?: OutputFormat,
): void {
  const fmt = format || globalFormat
  if (fmt === 'json') {
    process.stdout.write(JSON.stringify(items, null, 2) + '\n')
    return
  }

  if (items.length === 0) {
    process.stdout.write('No items found.\n')
    return
  }

  // Markdown table
  const header = '| ' + columns.map((c) => c.label).join(' | ') + ' |'
  const separator = '| ' + columns.map((c) => '-'.repeat(Math.max(c.label.length, 3))).join(' | ') + ' |'

  const rows = items.map((item) => {
    const cells = columns.map((c) => {
      const val = getNestedValue(item, c.key)
      return formatCell(val)
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
    process.stdout.write(`✓ ${message}\n`)
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

  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    return String(data)
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
        lines.push(`**${key}**: ${formatCell(value)}`)
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

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
