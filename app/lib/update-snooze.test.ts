import { describe, expect, it, vi } from 'vitest'
import { isUpdateSnoozed, snoozeUpdate, UPDATE_SNOOZE_DURATION_MS } from './update-snooze'

function createStorage() {
  const values = new Map<string, string>()

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key))
  }
}

describe('update snooze', () => {
  it('keeps the same version snoozed for 24 hours', () => {
    const storage = createStorage()
    const now = new Date('2026-08-03T08:00:00Z').getTime()

    snoozeUpdate(storage, 'update', '1.2.0', UPDATE_SNOOZE_DURATION_MS, now)

    expect(isUpdateSnoozed(storage, 'update', '1.2.0', now + UPDATE_SNOOZE_DURATION_MS - 1)).toBe(true)
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('clears expired, malformed, and different-version reminders', () => {
    const storage = createStorage()
    const now = new Date('2026-08-03T08:00:00Z').getTime()

    snoozeUpdate(storage, 'update', '1.2.0', 1000, now)
    expect(isUpdateSnoozed(storage, 'update', '1.2.0', now + 1000)).toBe(false)

    storage.setItem('update', '{invalid')
    expect(isUpdateSnoozed(storage, 'update', '1.2.0', now)).toBe(false)

    snoozeUpdate(storage, 'update', '1.3.0', 1000, now)
    expect(isUpdateSnoozed(storage, 'update', '1.4.0', now)).toBe(false)
    expect(storage.removeItem).toHaveBeenCalledTimes(3)
  })
})
