// 主题切换 composable
// preference 是用户选择（可跟随系统），colorMode 是实际生效的浅色/深色。
type ThemeMode = 'light' | 'dark'
export type ThemePreference = ThemeMode | 'system'

const THEME_STORAGE_KEY = 'theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

let systemListenerAttached = false

function isClient() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function getSavedPreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark() {
  return isClient() && window.matchMedia(DARK_QUERY).matches
}

export function useTheme() {
  const preference = useState<ThemePreference>('color-mode-preference', () => 'system')
  const colorMode = useState<ThemeMode>('color-mode', () => 'light')

  const isDark = computed(() => colorMode.value === 'dark')

  function resolveTheme(pref: ThemePreference): ThemeMode {
    if (pref !== 'system') return pref
    return systemPrefersDark() ? 'dark' : 'light'
  }

  function apply() {
    colorMode.value = resolveTheme(preference.value)
    if (!isClient()) return

    const root = document.documentElement
    root.classList.toggle('dark', colorMode.value === 'dark')
    root.dataset.theme = colorMode.value
    root.style.colorScheme = colorMode.value
    root.classList.add('theme-ready')
  }

  function setPreference(pref: ThemePreference) {
    preference.value = pref
    apply()
    if (!isClient()) return
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, pref)
    } catch {
      // Storage unavailable; the choice still applies for this session.
    }
  }

  function toggleTheme() {
    setPreference(colorMode.value === 'light' ? 'dark' : 'light')
  }

  function initTheme() {
    if (!isClient()) return

    preference.value = getSavedPreference()
    apply()

    if (!systemListenerAttached) {
      systemListenerAttached = true
      window.matchMedia(DARK_QUERY).addEventListener('change', () => {
        if (preference.value === 'system') apply()
      })
    }
  }

  return {
    preference,
    colorMode,
    isDark,
    resolveTheme,
    setPreference,
    toggleTheme,
    initTheme
  }
}
