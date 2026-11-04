<script setup lang="ts">
import { Puzzle, Folder, Settings, Clapperboard, Workflow, FileText, Palette, ScrollText, Cloud, SlidersHorizontal, FlaskConical, ChevronsLeft, ChevronsRight, LogOut, Sun, Moon, FileVideo, Wrench, WandSparkles, Download, Database, ChevronDown, AudioLines, Images, Library, MicVocal, PenLine, ChevronsUpDown, Monitor, Check, Minus, Square, Copy, X } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useCloudAdmin } from '@/composables/useCloudAdmin'
import { createClickRipple } from '@/lib/ripple'
import type { ThemePreference } from '@/composables/useTheme'
import { hasOverlayTitlebar, hasWindowsTitlebarControls } from '@/lib/desktop-titlebar'
import { pageScrollMemory } from '@/lib/keep-alive-scroll-restore'

const route = useRoute()
const router = useRouter()

// Shared page scroll container: remember each page's offset across navigation.
const pageScrollContainer = ref<HTMLElement | null>(null)
watch(pageScrollContainer, element => pageScrollMemory.setContainer(element), { immediate: true })
const removePageScrollGuard = router.beforeEach((to, from) => {
  if (to.path !== from.path) pageScrollMemory.save(from.path)
})
onBeforeUnmount(removePageScrollGuard)
const { isDark, preference: themePreference, colorMode, resolveTheme, setPreference, initTheme } = useTheme()

const themeOptions = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon }
] as const satisfies ReadonlyArray<{ value: ThemePreference, label: string, icon: unknown }>
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

const currentUserInitial = computed(() => {
  const name = (currentUser.value?.displayName || currentUser.value?.account || '').trim()
  return name ? Array.from(name)[0]!.toUpperCase() : '我'
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
    { name: 'AI 剧本创作', path: '/tools/script-writing', icon: PenLine },
    { name: '视频转项目', path: '/import/video', icon: FileVideo },
    { name: '媒体处理', path: '/tools/enhance', icon: WandSparkles },
    { name: '语音识别', path: '/tools/asr', icon: AudioLines },
    { name: '声音工作台', path: '/tools/voice', icon: MicVocal },
    { name: '视频图文下载', path: '/tools/short-video-download', icon: Download }
  ]

  const assetChildren = [
    { name: '个人资源库', path: '/library', icon: Library },
    { name: '火山素材库', path: '/ark-assets', icon: Database },
    { name: '云端素材', path: '/tos-files', icon: Cloud }
  ]

  return [
    { name: '项目', path: '/projects', icon: Folder },
    {
      name: '素材',
      path: assetChildren[0].path,
      icon: Images,
      children: assetChildren
    },
    { name: '日志', path: '/logs', icon: ScrollText },
    {
      name: '工具',
      path: toolChildren[0].path,
      icon: Wrench,
      children: toolChildren
    },
    { name: '设置', path: '/settings', icon: Settings }
  ]
})

type SettingsSection = 'general' | 'workflow' | 'test' | 'prompts' | 'styles' | 'skills'

const DEFAULT_SETTINGS_SECTION: SettingsSection = 'general'
const SETTINGS_SECTIONS: SettingsSection[] = ['general', 'workflow', 'test', 'prompts', 'styles', 'skills']

const settingsSubNavigation: Array<{
  name: string
  section: SettingsSection
  icon: unknown
}> = [
  { name: '通用', section: 'general', icon: SlidersHorizontal },
  { name: '模型分配', section: 'workflow', icon: Workflow },
  { name: '模型测试', section: 'test', icon: FlaskConical },
  { name: '提示词模板', section: 'prompts', icon: FileText },
  { name: '画风预设', section: 'styles', icon: Palette },
  { name: '技能中心', section: 'skills', icon: Puzzle }
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

// macOS desktop: no native title bar. The traffic lights sit at (16, 18) above the sidebar logo
// (src-tauri/src/lib.rs). Sidebar pages get a short drag strip that puts the page header's center on
// the logo row's center; full-width pages need a taller strip because the lights overlap their left edge.
// SPA only (no SSR), so this is resolved synchronously to avoid a layout shift on first paint.
const overlayTitlebar = hasOverlayTitlebar()
const windowsTitlebarControls = hasWindowsTitlebarControls()
const inlineWindowControls = computed(() => windowsTitlebarControls && route.path === '/asset-workbench')
const windowMaximized = ref(false)
if (windowsTitlebarControls) {
  onMounted(async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    windowMaximized.value = await getCurrentWindow().isMaximized()
  })
}
async function controlWindow(action: 'minimize' | 'toggleMaximize' | 'close') {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const currentWindow = getCurrentWindow()
  await currentWindow[action]()
  if (action === 'toggleMaximize') windowMaximized.value = await currentWindow.isMaximized()
}
const titlebarStripClass = computed(() => {
  if (!overlayTitlebar) return ''
  return hideSidebar.value ? 'h-8' : 'h-5'
})

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

function handleThemeToggle(event: Event) {
  handleThemeSelect(colorMode.value === 'light' ? 'dark' : 'light', event)
}

// Accepts a click or a menu `select` event; the reveal animation grows from the trigger's
// center and only plays when the visible light/dark mode actually changes.
function handleThemeSelect(pref: ThemePreference, event: Event) {
  const applyTheme = () => setPreference(pref)
  if (typeof document === 'undefined' || typeof window === 'undefined' || resolveTheme(pref) === colorMode.value) {
    applyTheme()
    return
  }

  const viewTransitionDocument = document as ViewTransitionDocument
  if (!viewTransitionDocument.startViewTransition) {
    applyTheme()
    return
  }

  const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  const rect = trigger?.getBoundingClientRect()
  const pointer = event instanceof MouseEvent ? event : null
  const x = rect ? rect.left + rect.width / 2 : pointer?.clientX ?? window.innerWidth / 2
  const y = rect ? rect.top + rect.height / 2 : pointer?.clientY ?? window.innerHeight / 2
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  )

  const transition = viewTransitionDocument.startViewTransition(applyTheme)

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
        class="theme-surface flex shrink-0 items-center"
        :class="[
          visualSidebarCollapsed ? 'justify-center px-2' : 'justify-start px-4',
          overlayTitlebar ? 'h-[4.75rem] pt-7' : 'h-16'
        ]"
        data-tauri-drag-region
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
            class="theme-surface absolute left-full top-0 z-30 w-48 rounded-xl border-0 bg-popover p-1 shadow-[0_16px_48px_hsl(var(--foreground)/0.14)] opacity-0 pointer-events-none transition-[background-color,box-shadow,opacity] duration-150 group-hover:opacity-100 group-hover:pointer-events-auto"
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
            class="theme-surface absolute left-full top-0 z-30 w-48 rounded-xl border-0 bg-popover p-1 shadow-[0_16px_48px_hsl(var(--foreground)/0.14)] opacity-0 pointer-events-none transition-[background-color,box-shadow,opacity] duration-150 group-hover:opacity-100 group-hover:pointer-events-auto"
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

      <!-- Account: the user chip opens a menu holding theme + logout, so the name and credits get the row's width. -->
      <div
        class="shrink-0 border-t border-border/60 py-3"
        :class="visualSidebarCollapsed ? 'flex flex-col items-center gap-1 px-2' : 'flex items-center gap-1 px-3'"
      >
        <DropdownMenu v-if="authenticated">
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="flex min-w-0 items-center gap-2 rounded-lg text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
              :class="visualSidebarCollapsed ? 'p-1' : 'flex-1 px-1.5 py-1'"
              :title="currentUserTitle"
              :aria-label="`账号菜单：${currentUserTitle}`"
            >
              <span
                class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                aria-hidden="true"
              >
                {{ currentUserInitial }}
              </span>
              <template v-if="!visualSidebarCollapsed">
                <span class="flex min-w-0 flex-1 flex-col leading-tight">
                  <span class="truncate text-xs font-medium text-foreground">
                    {{ currentUser?.displayName || currentUser?.account || '已登录' }}
                  </span>
                  <span class="truncate text-xs tabular-nums text-muted-foreground">
                    积分 {{ currentUserCreditBalance.toLocaleString('zh-CN') }}
                  </span>
                </span>
                <ChevronsUpDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </template>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            :side="visualSidebarCollapsed ? 'right' : 'top'"
            align="start"
            class="w-52"
          >
            <DropdownMenuLabel class="flex flex-col gap-0.5 font-normal">
              <span class="truncate text-sm font-medium text-foreground">
                {{ currentUser?.displayName || currentUser?.account || '已登录' }}
              </span>
              <span class="text-xs tabular-nums text-muted-foreground">
                积分 {{ currentUserCreditBalance.toLocaleString('zh-CN') }}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel class="py-1 text-xs font-normal text-muted-foreground">
              外观
            </DropdownMenuLabel>
            <DropdownMenuItem
              v-for="option in themeOptions"
              :key="option.value"
              :aria-checked="themePreference === option.value"
              role="menuitemradio"
              @select="handleThemeSelect(option.value, $event)"
            >
              <component :is="option.icon" />
              {{ option.label }}
              <Check
                v-if="themePreference === option.value"
                class="ml-auto text-primary"
              />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              @select="handleCloudLogout"
            >
              <LogOut />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <LayoutGlobalTaskCenter v-if="authenticated" />
        <IconActionButton
          v-else
          :label="isDark ? '切换到浅色模式' : '切换到深色模式'"
          @click="handleThemeToggle"
        >
          <Sun class="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon class="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </IconActionButton>
      </div>
    </aside>

    <!-- 右侧内容区 -->
    <main
      class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      :class="hideSidebar ? '' : 'pl-4'"
    >
      <div v-if="windowsTitlebarControls" class="z-30 flex h-9 items-center justify-end" :class="inlineWindowControls ? 'absolute right-0 top-0' : 'shrink-0'" data-tauri-drag-region>
        <button type="button" class="grid h-9 w-11 place-items-center text-muted-foreground hover:bg-accent" aria-label="最小化" @click="controlWindow('minimize')"><Minus class="h-4 w-4" /></button>
        <button type="button" class="grid h-9 w-11 place-items-center text-muted-foreground hover:bg-accent" :aria-label="windowMaximized ? '还原窗口' : '最大化'" @click="controlWindow('toggleMaximize')"><Copy v-if="windowMaximized" class="h-3.5 w-3.5" /><Square v-else class="h-3.5 w-3.5" /></button>
        <button type="button" class="grid h-9 w-11 place-items-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground" aria-label="关闭" @click="controlWindow('close')"><X class="h-4 w-4" /></button>
      </div>
      <div v-else-if="titlebarStripClass" class="shrink-0" :class="titlebarStripClass" data-tauri-drag-region />
      <div
        ref="pageScrollContainer"
        data-page-scroll-container
        class="min-h-0 flex-1 overflow-y-auto"
      >
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
