// 主题切换 composable
type ThemeMode = 'light' | 'dark'

function isClient() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function getSavedTheme(): ThemeMode | null {
  const saved = window.localStorage.getItem('theme')
  return saved === 'light' || saved === 'dark' ? saved : null
}

export function useTheme() {
  const colorMode = useState<ThemeMode>('color-mode', () => 'light')

  const isDark = computed(() => colorMode.value === 'dark')

  function toggleTheme() {
    colorMode.value = colorMode.value === 'light' ? 'dark' : 'light'
    updateDOM()
  }

  function setTheme(theme: ThemeMode) {
    colorMode.value = theme
    updateDOM()
  }

  function updateDOM() {
    if (!isClient()) return

    const root = document.documentElement
    root.classList.toggle('dark', colorMode.value === 'dark')
    root.dataset.theme = colorMode.value
    root.style.colorScheme = colorMode.value
    root.classList.add('theme-ready')
    window.localStorage.setItem('theme', colorMode.value)
  }

  // 初始化时从 localStorage 读取
  function initTheme() {
    if (!isClient()) return

    const saved = getSavedTheme()
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    colorMode.value = saved || (prefersDark ? 'dark' : 'light')
    updateDOM()
  }

  return {
    colorMode,
    isDark,
    toggleTheme,
    setTheme,
    initTheme
  }
}
