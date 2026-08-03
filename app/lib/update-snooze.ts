export const UPDATE_SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000

interface UpdateSnoozeRecord {
  version: string
  until: number
}

type UpdateSnoozeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function isUpdateSnoozed(
  storage: UpdateSnoozeStorage,
  key: string,
  version: string,
  now = Date.now()
): boolean {
  const stored = storage.getItem(key)
  if (!stored) return false

  try {
    const record = JSON.parse(stored) as Partial<UpdateSnoozeRecord>
    const isActive = record.version === version
      && typeof record.until === 'number'
      && record.until > now

    if (!isActive) storage.removeItem(key)
    return isActive
  } catch {
    storage.removeItem(key)
    return false
  }
}

export function snoozeUpdate(
  storage: UpdateSnoozeStorage,
  key: string,
  version: string,
  duration = UPDATE_SNOOZE_DURATION_MS,
  now = Date.now()
) {
  storage.setItem(key, JSON.stringify({
    version,
    until: now + duration
  } satisfies UpdateSnoozeRecord))
}
