<script setup lang="ts">
import { Home, Folder, Settings, Clapperboard, Workflow, FileText, Palette, ScrollText, Cloud, SlidersHorizontal, FlaskConical, ChevronsLeft, ChevronsRight, LogOut, UserCheck, Sun, Moon, FileVideo, Wrench, WandSparkles, Download, Database, ChevronDown, AudioLines, Library } from 'lucide-vue-next'
import { useCloudAdmin } from '@/composables/useCloudAdmin'
import { createClickRipple } from '@/lib/ripple'

const route = useRoute()
const router = useRouter()
const { isDark, toggleTheme, initTheme } = useTheme()
const {
  currentUser,
  authenticated,
  logout: cloudLogout,
  loadStatus,
  bootstrap: cloudBootstrap,
  heartbeat: cloudHeartbeat,
  status: cloudStatus
} = useCloudAdmin()

// 侧边栏折叠状态
const isCollapsed = useState('sidebar-collapsed', () => false)
const SIDEBAR_COLLAPSE_STORAGE_KEY = 'playlet:sidebar-collapsed'
const isNarrowSidebar = ref(false)
let sidebarMediaQuery: MediaQueryList | null = null
let syncNarrowSidebar: (() => void) | null = null
let creditRefreshTimer: ReturnType<typeof setInterval> | null = null

const currentUserCreditBalance = computed(() => {
  const balance = Number(currentUser.value?.creditBalance ?? 0)
  return Number.isFinite(balance) ? balance : 0
})

const currentUserTitle = computed(() => {
  const name = currentUser.value?.displayName || currentUser.value?.account || '已登录'
  return `${name} · 积分 ${currentUserCreditBalance.value.toLocaleString('zh-CN')}`
})

async function refreshCloudCredit() {
  if (!authenticated.value) return
  await cloudHeartbeat().catch(() => undefined)
}

function handleWindowFocus() {
  void refreshCloudCredit()
}

const navigation = computed(() => {
  const toolChildren = [
    { name: '视频转项目', path: '/import/video', icon: FileVideo },
    { name: '画质增强', path: '/tools/enhance', icon: WandSparkles },
    { name: '语音识别', path: '/tools/asr', icon: AudioLines },
    { name: '视频图文下载', path: '/tools/short-video-download', icon: Download }
  ]

  return [
    { name: '首页', path: '/', icon: Home },
    { name: '我的项目', path: '/projects', icon: Folder },
    { name: '个人资源库', path: '/library', icon: Library },
    { name: '火山素材库', path: '/ark-assets', icon: Database },
    { name: '云端素材', path: '/tos-files', icon: Cloud },
    { name: '日志', path: '/logs', icon: ScrollText },
    {
      name: '工具',
      path: '/import/video',
      icon: Wrench,
      children: toolChildren
    },
    { name: '设置', path: '/settings', icon: Settings }
  ]
})

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

function isNavigationChildActive(item: { path: string }): boolean {
  return route.path === item.path || route.path.startsWith(`${item.path}/`)
}

function handleSidebarPointerDown(event: PointerEvent) {
  createClickRipple(event)
}

const activeStates = computed(() => {
  return navigation.value.map((item) => {
    if (route.path === item.path || (item.path !== '/' && route.path.startsWith(`${item.path}/`))) {
      return true
    }
    return 'children' in item && item.children?.some(child => isNavigationChildActive(child)) === true
  })
})

const expandedNavigationPaths = ref<string[]>([])

function hasNavigationChildren(item: { path: string, children?: unknown[] }): boolean {
  return item.path === '/settings' || Boolean(item.children?.length)
}

function isNavigationExpanded(item: { path: string }): boolean {
  return expandedNavigationPaths.value.includes(item.path)
}

function toggleNavigationExpanded(item: { path: string }) {
  if (isNavigationExpanded(item)) {
    expandedNavigationPaths.value = expandedNavigationPaths.value.filter(path => path !== item.path)
    return
  }
  expandedNavigationPaths.value = [...expandedNavigationPaths.value, item.path]
}

function syncExpandedNavigationWithRoute() {
  const nextExpandedPaths = new Set(expandedNavigationPaths.value)

  navigation.value.forEach((item, index) => {
    if (hasNavigationChildren(item) && activeStates.value[index]) {
      nextExpandedPaths.add(item.path)
    }
  })

  expandedNavigationPaths.value = Array.from(nextExpandedPaths)
}

function handleNavigationClick(event: MouseEvent, item: { path: string, children?: unknown[] }) {
  if (visualSidebarCollapsed.value || !hasNavigationChildren(item)) return

  event.preventDefault()
  toggleNavigationExpanded(item)
}

const hideSidebar = computed(() => route.meta.hideSidebar === true)

const visualSidebarCollapsed = computed(() => isCollapsed.value || isNarrowSidebar.value)

type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => {
    ready: Promise<void>
    finished: Promise<void>
  }
}

// 初始化主题
onMounted(() => {
  initTheme()
  void cloudBootstrap().catch(() => loadStatus())

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
  window.addEventListener('focus', handleWindowFocus)
  creditRefreshTimer = setInterval(() => void refreshCloudCredit(), 30_000)
})

watch(isCollapsed, (value) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, value ? '1' : '0')
})

watch(
  () => route.fullPath,
  () => syncExpandedNavigationWithRoute(),
  { immediate: true }
)

onUnmounted(() => {
  if (sidebarMediaQuery && syncNarrowSidebar) {
    sidebarMediaQuery.removeEventListener('change', syncNarrowSidebar)
  }
  if (creditRefreshTimer) {
    clearInterval(creditRefreshTimer)
    creditRefreshTimer = null
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('focus', handleWindowFocus)
  }
})

async function handleCloudLogout() {
  await cloudLogout()
  await router.push('/login')
}

function handleThemeToggle(event: MouseEvent) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    toggleTheme()
    return
  }

  const viewTransitionDocument = document as ViewTransitionDocument
  if (!viewTransitionDocument.startViewTransition) {
    toggleTheme()
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

  const transition = viewTransitionDocument.startViewTransition(() => {
    toggleTheme()
  })

  void transition.ready.then(() => {
    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`
        ]
      },
      {
        duration: 400,
        easing: 'ease-in-out',
        pseudoElement: '::view-transition-new(root)'
      }
    )
  }).catch(() => {
    // View transition failed, theme already toggled
  })
}
</script>

<template>
  <div class="theme-page-surface flex h-screen bg-background">
    <!-- 左侧菜单栏 -->
    <aside
      v-if="!hideSidebar"
      class="theme-surface relative z-20 flex min-h-0 flex-col bg-background transition-[width,background-color,border-color,box-shadow] duration-300 ease-out"
      :class="visualSidebarCollapsed ? 'w-14 overflow-visible' : 'w-48 overflow-hidden'"
    >
      <!-- Logo with collapse toggle -->
      <div
        class="theme-surface flex h-16 shrink-0 items-center"
        :class="visualSidebarCollapsed ? 'justify-center px-2' : 'justify-start px-4'"
      >
        <!-- Logo 图标按钮 - hover 时显示箭头 -->
        <button
          type="button"
          class="group relative grid h-5 w-5 flex-shrink-0 place-items-center overflow-hidden"
          :title="visualSidebarCollapsed ? '展开菜单' : '收起菜单'"
          :aria-label="visualSidebarCollapsed ? '展开菜单' : '收起菜单'"
          @pointerdown="handleSidebarPointerDown"
          @click="isCollapsed = !isCollapsed"
        >
          <Clapperboard class="pointer-events-none absolute inset-0 h-5 w-5 text-primary transition-opacity duration-150 group-hover:opacity-0" />
          <div class="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
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

        <!-- Logo 文字 - 始终显示 -->
        <span
          v-if="!visualSidebarCollapsed"
          class="ml-2 font-bold text-xl text-foreground"
        >Playlet</span>
      </div>

      <!-- 导航菜单 -->
      <nav
        class="min-h-0 flex-1 space-y-0.5 p-3 [scrollbar-width:thin] [scrollbar-color:transparent_transparent] hover:[scrollbar-color:hsl(var(--border))_transparent]"
        :class="visualSidebarCollapsed ? 'overflow-visible' : 'overflow-y-auto overflow-x-hidden overscroll-contain'"
      >
        <div
          v-for="(item, index) in navigation"
          :key="item.path"
          class="relative group"
        >
          <NuxtLink
            :to="item.path"
            class="theme-content relative flex items-center overflow-hidden rounded-md transition-colors duration-200"
            :class="[
              visualSidebarCollapsed ? 'justify-center px-2 py-2' : 'space-x-2.5 px-2.5 py-2 text-sm',
              activeStates[index]
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            ]"
            :title="visualSidebarCollapsed ? item.name : undefined"
            @pointerdown="handleSidebarPointerDown"
            @click="handleNavigationClick($event, item)"
          >
            <component
              :is="item.icon"
              class="h-[1.125rem] w-[1.125rem] flex-shrink-0"
            />
            <span
              v-if="!visualSidebarCollapsed"
              class="min-w-0 flex-1 truncate"
            >{{ item.name }}</span>
            <ChevronDown
              v-if="!visualSidebarCollapsed && hasNavigationChildren(item)"
              class="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200"
              :class="isNavigationExpanded(item) ? 'rotate-180' : 'rotate-0'"
            />
          </NuxtLink>

          <Transition name="sidebar-submenu">
            <div
              v-if="item.path === '/settings' && isNavigationExpanded(item) && !visualSidebarCollapsed"
              class="mt-1 ml-7 space-y-0.5 overflow-hidden"
            >
              <NuxtLink
                v-for="sub in settingsSubNavigation"
                :key="sub.section"
                :to="getSettingsSubRoute(sub)"
                class="theme-content relative flex items-center gap-2 overflow-hidden px-2 py-1.5 rounded-md text-xs transition-colors"
                :class="isSettingsSubActive(sub)
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
                @pointerdown="handleSidebarPointerDown"
              >
                <component
                  :is="sub.icon"
                  class="w-3.5 h-3.5 flex-shrink-0"
                />
                <span>{{ sub.name }}</span>
              </NuxtLink>
            </div>
          </Transition>

          <Transition name="sidebar-submenu">
            <div
              v-if="'children' in item && item.children?.length && isNavigationExpanded(item) && !visualSidebarCollapsed"
              class="mt-1 ml-7 space-y-0.5 overflow-hidden"
            >
              <NuxtLink
                v-for="sub in item.children"
                :key="sub.path"
                :to="sub.path"
                class="theme-content relative flex items-center gap-2 overflow-hidden px-2 py-1.5 rounded-md text-xs transition-colors"
                :class="isNavigationChildActive(sub)
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
                @pointerdown="handleSidebarPointerDown"
              >
                <component
                  :is="sub.icon"
                  class="w-3.5 h-3.5 flex-shrink-0"
                />
                <span>{{ sub.name }}</span>
              </NuxtLink>
            </div>
          </Transition>

          <div
            v-if="item.path === '/settings' && visualSidebarCollapsed"
            class="theme-surface absolute left-full top-0 z-30 w-48 rounded-md border bg-popover p-1 shadow-md opacity-0 pointer-events-none transition-[background-color,border-color,box-shadow,opacity] duration-150 group-hover:opacity-100 group-hover:pointer-events-auto"
          >
            <NuxtLink
              v-for="sub in settingsSubNavigation"
              :key="`collapsed-${sub.section}`"
              :to="getSettingsSubRoute(sub)"
              class="theme-content relative flex items-center gap-2 overflow-hidden px-2 py-1.5 rounded-md text-xs transition-colors"
              :class="isSettingsSubActive(sub)
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
              @pointerdown="handleSidebarPointerDown"
            >
              <component
                :is="sub.icon"
                class="w-3.5 h-3.5 flex-shrink-0"
              />
              <span>{{ sub.name }}</span>
            </NuxtLink>
          </div>

          <div
            v-if="'children' in item && item.children?.length && visualSidebarCollapsed"
            class="theme-surface absolute left-full top-0 z-30 w-48 rounded-md border bg-popover p-1 shadow-md opacity-0 pointer-events-none transition-[background-color,border-color,box-shadow,opacity] duration-150 group-hover:opacity-100 group-hover:pointer-events-auto"
          >
            <NuxtLink
              v-for="sub in item.children"
              :key="`collapsed-${sub.path}`"
              :to="sub.path"
              class="theme-content relative flex items-center gap-2 overflow-hidden px-2 py-1.5 rounded-md text-xs transition-colors"
              :class="isNavigationChildActive(sub)
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
              @pointerdown="handleSidebarPointerDown"
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
        class="shrink-0 pb-4"
        :class="visualSidebarCollapsed ? 'px-2' : 'px-4'"
      >
        <div
          class="theme-surface rounded-md border bg-background"
          :class="visualSidebarCollapsed ? 'grid gap-1 p-1' : 'p-2'"
        >
          <template v-if="authenticated && !visualSidebarCollapsed">
            <div class="flex min-w-0 items-center gap-2 px-1 pb-2">
              <div class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10">
                <UserCheck class="h-4 w-4 text-primary" />
              </div>
              <div class="flex min-w-0 flex-1 flex-col leading-tight">
                <span class="truncate text-xs font-medium text-foreground">
                  {{ currentUser?.displayName || currentUser?.account || '已登录' }}
                </span>
                <span class="mt-0.5 truncate text-[11px] text-muted-foreground">
                  积分 {{ currentUserCreditBalance.toLocaleString('zh-CN') }}
                </span>
              </div>
            </div>
            <div class="flex items-center justify-between border-t px-0.5 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="theme-content relative h-8 w-8 text-muted-foreground hover:text-foreground"
                :title="isDark ? '浅色模式' : '深色模式'"
                :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
                @click="handleThemeToggle"
              >
                <Sun class="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon class="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="theme-content h-8 w-8 text-muted-foreground hover:text-foreground"
                title="退出后台"
                aria-label="退出后台"
                @click="handleCloudLogout"
              >
                <LogOut class="h-4 w-4" />
              </Button>
            </div>
          </template>

          <template v-else-if="authenticated">
            <div
              class="theme-content grid h-8 w-8 place-items-center text-muted-foreground"
              :title="currentUserTitle"
              :aria-label="currentUserTitle"
            >
              <UserCheck class="h-4 w-4 text-primary" />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="theme-content relative h-8 w-8 text-muted-foreground hover:text-foreground"
              :title="isDark ? '浅色模式' : '深色模式'"
              :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
              @click="handleThemeToggle"
            >
              <Sun class="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon class="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="theme-content h-8 w-8 text-muted-foreground hover:text-foreground"
              title="退出后台"
              aria-label="退出后台"
              @click="handleCloudLogout"
            >
              <LogOut class="h-4 w-4" />
            </Button>
          </template>

          <Button
            v-else
            type="button"
            variant="ghost"
            size="icon"
            class="theme-content relative h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            :title="isDark ? '浅色模式' : '深色模式'"
            :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
            @click="handleThemeToggle"
          >
            <Sun class="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon class="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>
        </div>
      </div>
    </aside>

    <!-- 右侧内容区 -->
    <main
      class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      :class="hideSidebar ? '' : 'pl-4'"
    >
      <div class="min-h-0 flex-1 overflow-y-auto">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.sidebar-submenu-enter-active,
.sidebar-submenu-leave-active {
  transition:
    max-height 180ms ease,
    opacity 160ms ease,
    transform 180ms ease;
}

.sidebar-submenu-enter-from,
.sidebar-submenu-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-4px);
}

.sidebar-submenu-enter-to,
.sidebar-submenu-leave-from {
  max-height: 18rem;
  opacity: 1;
  transform: translateY(0);
}
</style>
