import { describe, expect, it } from 'vitest'
import { isOnboardingCompleted, markOnboardingCompleted, ONBOARDING_COMPLETED_STORAGE_KEY, resolveHomeRoute } from './onboarding'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size }
  }
}

describe('onboarding', () => {
  it('sends a fresh install to the guide', () => {
    const storage = memoryStorage({ 'playlet:sidebar-collapsed': '0' })
    expect(isOnboardingCompleted(storage)).toBe(false)
    expect(resolveHomeRoute(storage)).toBe('/welcome')
  })

  it('goes to projects once the guide is completed', () => {
    const storage = memoryStorage()
    markOnboardingCompleted(storage)
    expect(storage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY)).toBe('1')
    expect(resolveHomeRoute(storage)).toBe('/projects')
  })

  it('treats people who already opened a project as onboarded', () => {
    expect(isOnboardingCompleted(memoryStorage({ 'playlet:last-project-id:user_1': 'proj_1' }))).toBe(true)
  })

  it('never traps the user when storage is unavailable or broken', () => {
    expect(isOnboardingCompleted(null)).toBe(true)
    const broken = { ...memoryStorage(), getItem: () => { throw new Error('denied') } }
    expect(isOnboardingCompleted(broken)).toBe(true)
  })
})
