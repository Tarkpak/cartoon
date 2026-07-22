const sensitiveKeys = /^(authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|cookie|set-cookie|signature)$/i

function redactString(value: string) {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveKeys.test(key) || /token|signature|credential|key/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]')
      }
    }
    return url.toString()
  } catch {
    return value.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
  }
}

export function redactLogPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLogPayload)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      sensitiveKeys.test(key) || /private[_-]?key/i.test(key) ? '[REDACTED]' : redactLogPayload(child)
    ]))
  }
  return typeof value === 'string' ? redactString(value) : value
}
