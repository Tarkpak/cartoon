<script setup lang="ts">
import { Home, Folder, Settings, Clapperboard, Workflow, FileText, Palette, ScrollText, Cloud, SlidersHorizontal, FlaskConical, ChevronsLeft, ChevronsRight, LogOut, UserCheck } from 'lucide-vue-next'
import { useCloudAdmin } from '@/composables/useCloudAdmin'

const route = useRoute()
const router = useRouter()
const { isDark, toggleTheme, initTheme } = useTheme()
const { currentUser, authenticated, logout: cloudLogout, loadStatus } = useCloudAdmin()

// 侧边栏折叠状态
const isCollapsed = useState('sidebar-collapsed', () => false)
const SIDEBAR_COLLAPSE_STORAGE_KEY = 'playlet:sidebar-collapsed'
const isNarrowSidebar = ref(false)
let sidebarMediaQuery: MediaQueryList | null = null
let syncNarrowSidebar: (() => void) | null = null

const navigation = [
  { name: '首页', path: '/', icon: Home },
  { name: '我的项目', path: '/projects', icon: Folder },
  { name: '云端素材', path: '/tos-files', icon: Cloud },
  { name: '日志', path: '/logs', icon: ScrollText },
  { name: '设置', path: '/settings', icon: Settings }
]

type SettingsSection = 'general' | 'workflow' | 'test' | 'prompts' | 'styles'

const DEFAULT_SETTINGS_SECTION: SettingsSection = 'general'
const SETTINGS_SECTIONS: SettingsSection[] = ['general', 'workflow', 'test', 'prompts', 'styles']

const settingsSubNavigation: Array<{
  name: string
  section: SettingsSection
  icon: unknown
}> = [
  { name: '通用', section: 'general', icon: SlidersHorizontal },
  { name: '模型分配', section: 'workflow', icon: Workflow },
  { name: '模型测试', section: 'test', icon: FlaskConical },
  { name: '提示词模板', section: 'prompts', icon: FileText },
  { name: '画风预设', section: 'styles', icon: Palette }
]

function getSingleQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

const currentSettingsSection = computed<SettingsSection>(() => {
  const raw = getSingleQueryValue(route.query.section as string | string[] | undefined)
  if (SETTINGS_SECTIONS.includes(raw as SettingsSection)) {
    return raw as SettingsSection
  }
  return DEFAULT_SETTINGS_SECTION
})

function isSettingsSubActive(item: { section: SettingsSection }): boolean {
  if (route.path !== '/settings') return false
  return currentSettingsSection.value === item.section
}

function getSettingsSubRoute(item: { section: SettingsSection }) {
  return {
    path: '/settings',
    query: { section: item.section }
  }
}

const activeStates = computed(() => {
  return navigation.map(item => route.path === item.path)
})

const hideSidebar = computed(() => route.meta.hideSidebar === true)

const visualSidebarCollapsed = computed(() => isCollapsed.value || isNarrowSidebar.value)
const themeIconDark = ref(false)
let themeIconTimer: number | null = null

type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => {
    ready: Promise<void>
    finished: Promise<void>
  }
}

// 初始化主题
onMounted(() => {
  initTheme()
  themeIconDark.value = isDark.value
  void loadStatus()

  if (typeof window === 'undefined') return

  const stored = window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY)
  if (stored === '1' || stored === 'true') {
    isCollapsed.value = true
  } else if (stored === '0' || stored === 'false') {
    isCollapsed.value = false
  }

  sidebarMediaQuery = window.matchMedia('(max-width: 1023px)')
  syncNarrowSidebar = () => {
    isNarrowSidebar.value = sidebarMediaQuery?.matches === true
  }

  syncNarrowSidebar()
  sidebarMediaQuery.addEventListener('change', syncNarrowSidebar)
})

watch(isCollapsed, (value) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, value ? '1' : '0')
})

onUnmounted(() => {
  if (sidebarMediaQuery && syncNarrowSidebar) {
    sidebarMediaQuery.removeEventListener('change', syncNarrowSidebar)
  }
  if (themeIconTimer !== null) {
    window.clearTimeout(themeIconTimer)
    themeIconTimer = null
  }
})

async function handleCloudLogout() {
  await cloudLogout()
  await router.push('/login')
}

function shouldReduceMotion(): boolean {
  if (typeof window === 'undefined') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function runThemeViewTransition(x: number, y: number, endRadius: number) {
  const viewTransitionDocument = document as ViewTransitionDocument

  try {
    const transition = viewTransitionDocument.startViewTransition?.(() => {
      toggleTheme()
    })

    if (!transition) {
      toggleTheme()
      themeIconDark.value = isDark.value
      themeIconTimer = null
      return
    }

    void transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`
          ]
        },
        {
          duration: 520,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
          pseudoElement: '::view-transition-new(root)'
        }
      )
    }).catch(() => {
      // Theme has already been applied by the view transition callback.
    }).finally(() => {
      themeIconDark.value = isDark.value
      themeIconTimer = null
    })
  } catch {
    toggleTheme()
    themeIconDark.value = isDark.value
    themeIconTimer = null
  }
}

function handleThemeToggle(event: MouseEvent) {
  const nextIconDark = !isDark.value
  themeIconDark.value = nextIconDark
  if (themeIconTimer !== null) {
    window.clearTimeout(themeIconTimer)
    themeIconTimer = null
  }

  if (typeof document === 'undefined' || typeof window === 'undefined' || shouldReduceMotion()) {
    toggleTheme()
    themeIconDark.value = isDark.value
    return
  }

  const viewTransitionDocument = document as ViewTransitionDocument
  if (!viewTransitionDocument.startViewTransition) {
    themeIconTimer = window.setTimeout(() => {
      toggleTheme()
      themeIconDark.value = isDark.value
      themeIconTimer = null
    }, 220)
    return
  }

  const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  const rect = trigger?.getBoundingClientRect()
  const x = rect ? rect.left + rect.width / 2 : event.clientX
  const y = rect ? rect.top + rect.height / 2 : event.clientY
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  )

  themeIconTimer = window.setTimeout(() => {
    runThemeViewTransition(x, y, endRadius)
  }, 180)
}
</script>

<template>
  <div class="theme-page-surface flex h-screen bg-background">
    <!-- 左侧菜单栏 -->
    <aside
      v-if="!hideSidebar"
      class="theme-surface relative flex flex-col border-r bg-card transition-[width,background-color,border-color,box-shadow] duration-300 ease-out"
      :class="visualSidebarCollapsed ? 'w-16' : 'w-56'"
    >
      <!-- Logo with collapse toggle -->
      <button
        type="button"
        class="theme-surface group relative h-16 flex items-center justify-center border-b transition-colors hover:bg-accent/50"
        :class="visualSidebarCollapsed ? 'px-2' : 'px-6'"
        :title="visualSidebarCollapsed ? '展开菜单' : '收起菜单'"
        :aria-label="visualSidebarCollapsed ? '展开菜单' : '收起菜单'"
        @click="isCollapsed = !isCollapsed"
      >
        <!-- Logo - 默认显示，hover 时隐藏 -->
        <div
          class="font-bold text-foreground flex items-center transition-opacity duration-200 group-hover:opacity-0"
          :class="visualSidebarCollapsed ? 'text-xl' : 'text-2xl'"
        >
          <Clapperboard class="w-6 h-6 text-primary" />
          <span
            v-if="!visualSidebarCollapsed"
            class="ml-1"
          >playlet</span>
        </div>

        <!-- 箭头 - hover 时显示 -->
        <div class="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <ChevronsLeft
            v-if="!visualSidebarCollapsed"
            class="h-4 w-4 text-muted-foreground"
          />
          <ChevronsRight
            v-else
            class="h-4 w-4 text-muted-foreground"
          />
        </div>
      </button>

      <!-- 导航菜单 -->
      <nav class="flex-1 p-4 space-y-1">
        <div
          v-for="(item, index) in navigation"
          :key="item.path"
          class="relative group"
        >
          <NuxtLink
            :to="item.path"
            class="theme-content flex items-center rounded-md transition-colors duration-200"
            :class="[
              visualSidebarCollapsed ? 'justify-center px-2 py-2.5' : 'space-x-3 px-3 py-2.5',
              activeStates[index]
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            ]"
            :title="visualSidebarCollapsed ? item.name : undefined"
          >
            <component
              :is="item.icon"
              class="w-5 h-5 flex-shrink-0"
            />
            <span v-if="!visualSidebarCollapsed">{{ item.name }}</span>
          </NuxtLink>

          <div
            v-if="item.path === '/settings' && route.path === '/settings' && !visualSidebarCollapsed"
            class="mt-1 ml-8 space-y-0.5"
          >
            <NuxtLink
              v-for="sub in settingsSubNavigation"
              :key="sub.section"
              :to="getSettingsSubRoute(sub)"
              class="theme-content flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors"
              :class="isSettingsSubActive(sub)
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
            >
              <component
                :is="sub.icon"
                class="w-3.5 h-3.5 flex-shrink-0"
              />
              <span>{{ sub.name }}</span>
            </NuxtLink>
          </div>

          <div
            v-if="item.path === '/settings' && visualSidebarCollapsed"
            class="theme-surface absolute left-full top-0 z-30 w-48 rounded-md border bg-popover p-1 shadow-md opacity-0 pointer-events-none transition-[background-color,border-color,box-shadow,opacity] duration-150 group-hover:opacity-100 group-hover:pointer-events-auto"
          >
            <NuxtLink
              v-for="sub in settingsSubNavigation"
              :key="`collapsed-${sub.section}`"
              :to="getSettingsSubRoute(sub)"
              class="theme-content flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors"
              :class="isSettingsSubActive(sub)
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
            >
              <component
                :is="sub.icon"
                class="w-3.5 h-3.5 flex-shrink-0"
              />
              <span>{{ sub.name }}</span>
            </NuxtLink>
          </div>
        </div>
      </nav>

      <div
        class="pb-4"
        :class="visualSidebarCollapsed ? 'px-2' : 'px-4'"
      >
        <div
          class="theme-surface rounded-md border bg-background/60 p-1"
          :class="visualSidebarCollapsed ? 'grid gap-1' : 'flex items-center gap-1'"
        >
          <template v-if="authenticated">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="theme-content h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              :title="currentUser?.displayName || currentUser?.account || '已登录'"
              :aria-label="currentUser?.displayName || currentUser?.account || '已登录'"
            >
              <UserCheck class="h-4 w-4 text-primary" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="theme-content h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              title="退出后台"
              aria-label="退出后台"
              @click="handleCloudLogout"
            >
              <LogOut class="h-4 w-4" />
            </Button>
          </template>

          <div
            v-if="!visualSidebarCollapsed"
            class="flex-1"
          />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="theme-content relative h-8 w-8 shrink-0 overflow-hidden rounded-md text-muted-foreground hover:text-foreground"
            :title="isDark ? '浅色模式' : '深色模式'"
            :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
            @click="handleThemeToggle"
          >
            <span
              class="theme-morph-icon"
              :class="{ 'is-dark': themeIconDark }"
              aria-hidden="true"
            >
              <span class="theme-morph-orb">
                <span class="theme-morph-cutout" />
              </span>
              <span
                v-for="ray in 8"
                :key="ray"
                class="theme-morph-ray"
                :style="{ '--ray-index': ray - 1 }"
              />
            </span>
          </Button>
        </div>
      </div>
    </aside>

    <!-- 右侧内容区 -->
    <main class="flex-1 overflow-hidden flex flex-col">
      <div class="flex-1 overflow-y-auto">
        <slot />
      </div>
    </main>
  </div>
</template>
