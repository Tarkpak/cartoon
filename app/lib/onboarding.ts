export const ONBOARDING_COMPLETED_STORAGE_KEY = 'playlet:onboarding-completed'

/** People who already opened a project on this device skip the first-run guide. */
const LAST_PROJECT_KEY_PREFIX = 'playlet:last-project-id:'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'length' | 'key'>

function safeStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function isOnboardingCompleted(storage: StorageLike | null = safeStorage()): boolean {
  if (!storage) return true
  try {
    if (storage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY) === '1') return true
    for (let index = 0; index < storage.length; index += 1) {
      if (storage.key(index)?.startsWith(LAST_PROJECT_KEY_PREFIX)) return true
    }
    return false
  } catch {
    // Without readable storage, never trap the user on the guide.
    return true
  }
}

export function markOnboardingCompleted(storage: StorageLike | null = safeStorage()) {
  try {
    storage?.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, '1')
  } catch {
    // Storage can be unavailable; the guide simply shows again next time.
  }
}

/** Where "/" should go: the guide on first launch, the project list afterwards. */
export function resolveHomeRoute(storage: StorageLike | null = safeStorage()): string {
  return isOnboardingCompleted(storage) ? '/projects' : '/welcome'
}
