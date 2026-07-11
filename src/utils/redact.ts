const SENSITIVE_KEY = /token|authorization|secret|password|code_verifier|client_secret/i

export function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /([?&](?:access_token|refresh_token|id_token|code|client_secret|code_verifier)=)[^&\s"'<>]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /(\b(?:access_token|refresh_token|id_token|client_secret|code_verifier)\b\s*[:=]\s*)[^\s,;"']+/gi,
      '$1[REDACTED]',
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
}

export function redactSensitive(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactText(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, seen))

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(item, seen)
  }
  return result
}
