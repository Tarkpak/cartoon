interface ApiErrorPayload {
  data?: {
    message?: unknown
  }
  message?: unknown
  statusMessage?: unknown
}

interface FetchErrorLike {
  data?: ApiErrorPayload
  response?: {
    _data?: ApiErrorPayload
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function resolveApiErrorMessage(error: unknown, fallback: string): string {
  const fetchError = error as FetchErrorLike
  const payload = fetchError?.data || fetchError?.response?._data

  return nonEmptyString(payload?.data?.message)
    || nonEmptyString(payload?.message)
    || nonEmptyString(payload?.statusMessage)
    || (error instanceof Error ? nonEmptyString(error.message) : undefined)
    || fallback
}
