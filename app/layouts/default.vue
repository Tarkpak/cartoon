<script setup lang="ts">
import { Home, Folder, Settings, Moon, Sun, Clapperboard, Workflow, FileText, Palette, ScrollText, Cloud, SlidersHorizontal, Boxes, FlaskConical, CloudCog, ChevronsLeft, ChevronsRight, LogOut, UserCheck } from 'lucide-vue-next'
import { useCloudAdmin } from '@/composables/useCloudAdmin'

const route = useRoute()
const router = useRouter()
const { isDark, toggleTheme, initTheme } = useTheme()
const { currentUser, authenticated, logout: cloudLogout, loadStatus } = useCloudAdmin()

const appVersion = __APP_VERSION__
const currentYear = new Date().getFullYear()

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

type SettingsSection = 'general' | 'providers' | 'workflow' | 'test' | 'storage' | 'prompts' | 'styles'

const DEFAULT_SETTINGS_SECTION: SettingsSection = 'general'
const SETTINGS_SECTIONS: SettingsSection[] = ['general', 'providers', 'workflow', 'test', 'prompts', 'styles', 'storage']

const settingsSubNavigation: Array<{
  name: string
  section: SettingsSection
  icon: unknown
}> = [
  { name: '通用', section: 'general', icon: SlidersHorizontal },
  { name: '模型供应商', section: 'providers', icon: Boxes },
  { name: '模型分配', section: 'workflow', icon: Workflow },
  { name: '模型测试', section: 'test', icon: FlaskConical },
  { name: '提示词模板', section: 'prompts', icon: FileText },
  { name: '画风预设', section: 'styles', icon: Palette },
  { name: '云存储设置', section: 'storage', icon: CloudCog }
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

// 是否显示页脚（设置页与自动工作台不显示）
const showFooter = computed(() => !['/settings', '/asset-workbench'].includes(route.path))
const visualSidebarCollapsed = computed(() => isCollapsed.value || isNarrowSidebar.value)

// 初始化主题
onMounted(() => {
  initTheme()
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
  if (!sidebarMediaQuery || !syncNarrowSidebar) return
  sidebarMediaQuery.removeEventListener('change', syncNarrowSidebar)
})

async function handleCloudLogout() {
  await cloudLogout()
  await router.push('/login')
}
</script>

<template>
  <div class="flex h-screen bg-background transition-colors duration-300">
    <!-- 左侧菜单栏 -->
    <aside
      v-if="!hideSidebar"
      class="bg-card border-r flex flex-col transition-all duration-300 relative"
      :class="visualSidebarCollapsed ? 'w-20' : 'w-56'"
    >
      <!-- 折叠按钮 - 使用双箭头图标避免与返回按钮混淆 -->
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="absolute -right-3 top-20 w-6 h-6 bg-muted border rounded-full flex items-center justify-center shadow-sm hover:bg-accent transition z-10"
        :title="visualSidebarCollapsed ? '展开菜单' : '收起菜单'"
        :aria-label="visualSidebarCollapsed ? '展开菜单' : '收起菜单'"
        @click="isCollapsed = !isCollapsed"
      >
        <ChevronsLeft
          v-if="!visualSidebarCollapsed"
          class="h-3.5 w-3.5 text-muted-foreground"
        />
        <ChevronsRight
          v-else
          class="h-3.5 w-3.5 text-muted-foreground"
        />
      </Button>

      <!-- Logo -->
      <div
        class="h-16 flex items-center border-b"
        :class="visualSidebarCollapsed ? 'justify-center px-2' : 'px-6'"
      >
        <NuxtLink
          to="/"
          class="font-bold text-foreground flex items-center"
          :class="visualSidebarCollapsed ? 'text-xl' : 'text-2xl'"
        >
          <Clapperboard class="w-6 h-6 text-primary" />
          <span
            v-if="!visualSidebarCollapsed"
            class="ml-1"
          >playlet</span>
        </NuxtLink>
      </div>

      <!-- 导航菜单 -->
      <nav class="flex-1 p-4 space-y-1">
        <div
          v-for="(item, index) in navigation"
          :key="item.path"
          class="relative group"
        >
          <NuxtLink
            :to="item.path"
            class="flex items-center rounded-md transition-colors duration-200"
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
              class="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors"
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
            class="absolute left-full top-0 z-30 w-48 rounded-md border bg-popover p-1 shadow-md opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto"
          >
            <NuxtLink
              v-for="sub in settingsSubNavigation"
              :key="`collapsed-${sub.section}`"
              :to="getSettingsSubRoute(sub)"
              class="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors"
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
        v-if="authenticated"
        class="px-4 pb-2"
      >
        <div
          class="rounded-md border bg-background/60 p-2 text-xs"
          :class="visualSidebarCollapsed ? 'text-center' : ''"
        >
          <div class="flex items-center gap-2 text-foreground">
            <UserCheck class="h-4 w-4 text-primary" />
            <span
              v-if="!visualSidebarCollapsed"
              class="truncate"
            >{{ currentUser?.displayName || currentUser?.account || '已登录' }}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="mt-2 w-full justify-start px-2 text-xs"
            :class="visualSidebarCollapsed ? 'justify-center' : ''"
            title="退出后台"
            @click="handleCloudLogout"
          >
            <LogOut class="h-3.5 w-3.5" />
            <span v-if="!visualSidebarCollapsed" class="ml-1">退出后台</span>
          </Button>
        </div>
      </div>

      <!-- 主题切换 -->
      <div class="px-4 pb-4">
        <Button
          type="button"
          variant="ghost"
          class="w-full flex items-center rounded-md transition-colors duration-200 text-muted-foreground hover:bg-accent hover:text-foreground"
          :class="visualSidebarCollapsed ? 'justify-center px-2 py-2.5' : 'space-x-3 px-3 py-2.5'"
          :title="visualSidebarCollapsed ? (isDark ? '浅色模式' : '深色模式') : undefined"
          :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
          @click="toggleTheme"
        >
          <Moon
            v-if="!isDark"
            class="w-5 h-5 flex-shrink-0"
          />
          <Sun
            v-else
            class="w-5 h-5 flex-shrink-0"
          />
          <span v-if="!visualSidebarCollapsed">{{ isDark ? '浅色模式' : '深色模式' }}</span>
        </Button>
      </div>
    </aside>

    <!-- 右侧内容区 -->
    <main class="flex-1 overflow-hidden flex flex-col">
      <div
        class="flex-1 overflow-y-auto"
        :class="{ 'overflow-hidden': !showFooter }"
      >
        <slot />
      </div>

      <!-- 页脚 - 设置页面不显示 -->
      <footer
        v-if="showFooter"
        class="flex-shrink-0 px-8 py-6 border-t bg-card/50"
      >
        <div class="flex items-center justify-between text-sm text-muted-foreground">
          <span>© {{ currentYear }} playlet</span>
          <div>v{{ appVersion }}</div>
        </div>
      </footer>
    </main>
  </div>
</template>
