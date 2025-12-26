// 主题切换 composable
export function useTheme() {
  const colorMode = useState<'light' | 'dark'>('color-mode', () => 'light')

  const isDark = computed(() => colorMode.value === 'dark')

  function toggleTheme() {
    colorMode.value = colorMode.value === 'light' ? 'dark' : 'light'
    updateDOM()
  }

  function setTheme(theme: 'light' | 'dark') {
    colorMode.value = theme
    updateDOM()
  }

  function updateDOM() {
    if (import.meta.client) {
      if (colorMode.value === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
      localStorage.setItem('theme', colorMode.value)
    }
  }

  // 初始化时从 localStorage 读取
  function initTheme() {
    if (import.meta.client) {
      const saved = localStorage.getItem('theme') as 'light' | 'dark' | null
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      colorMode.value = saved || (prefersDark ? 'dark' : 'light')
      updateDOM()
    }
  }

  return {
    colorMode,
    isDark,
    toggleTheme,
    setTheme,
    initTheme
  }
}
