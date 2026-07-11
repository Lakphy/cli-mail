import { z } from 'zod'
import { ConfigError, errorMessage } from './error.js'

const objectSchema = z.record(z.string(), z.unknown())

export function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch (error) {
    throw new ConfigError(`${label} must be valid JSON`, {
      reason: errorMessage(error),
    })
  }

  const result = objectSchema.safeParse(parsed)
  if (!result.success) {
    throw new ConfigError(`${label} must be a JSON object`, {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
  }
  return result.data
}
