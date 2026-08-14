<template>
  <n-layout
    has-sider
    class="admin-shell"
  >
    <n-layout-sider
      bordered
      class="admin-shell__sider"
      collapse-mode="width"
      :collapsed="menuCollapsed"
      :collapsed-width="56"
      :width="200"
    >
      <div
        class="admin-brand"
        :class="{ 'admin-brand--collapsed': menuCollapsed }"
      >
        <button
          class="admin-brand__mark"
          type="button"
          :aria-label="menuToggleLabel"
          :title="menuToggleLabel"
          @click="toggleMenuCollapsed"
        >
          <span class="admin-brand__logo">P</span>
          <svg
            class="admin-brand__toggle-icon"
            aria-hidden="true"
            fill="none"
            height="18"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            viewBox="0 0 24 24"
            width="18"
          >
            <path :d="menuCollapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'" />
          </svg>
        </button>
        <div v-if="!menuCollapsed" class="admin-brand__body">
          <div class="admin-brand__title">Playlet Admin</div>
          <div class="muted admin-brand__meta">管理后台</div>
        </div>
      </div>
      <div class="admin-shell__navigation">
        <ClientOnly>
          <n-menu
            :value="selectedKey"
            :options="menuOptions"
            :collapsed="menuCollapsed"
            :collapsed-icon-size="20"
            :collapsed-width="56"
            @update:value="handleNavigate"
          />
          <template #fallback>
            <nav class="admin-menu-fallback" aria-label="后台菜单">
              <a
                v-for="item in menuOptions"
                :key="item.key"
                class="admin-menu-fallback__item"
                :href="item.key"
              >
                {{ item.label }}
              </a>
            </nav>
          </template>
        </ClientOnly>
      </div>
      <footer
        class="admin-account"
        :class="{ 'admin-account--collapsed': menuCollapsed }"
      >
        <div class="admin-account__avatar" aria-hidden="true">{{ meInitial }}</div>
        <div v-if="!menuCollapsed" class="admin-account__body">
          <strong class="admin-account__name" :title="meLabel">{{ meLabel }}</strong>
          <span class="admin-account__meta" :title="accountMeta">{{ accountMeta }}</span>
        </div>
        <button
          class="admin-account__logout"
          type="button"
          aria-label="退出登录"
          title="退出登录"
          @click="logout"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="17"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
            viewBox="0 0 24 24"
            width="17"
          >
            <path d="M10 17l5-5-5-5" />
            <path d="M15 12H3" />
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
          </svg>
        </button>
      </footer>
    </n-layout-sider>
    <n-layout class="admin-shell__main">
      <n-layout-content
        class="admin-shell__content"
        :class="{ 'admin-shell__content--fixed': contentMode === 'fixed' }"
      >
        <slot />
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { userRoleLabel } from '@playlet-shared/utils/display-labels'

const SIDEBAR_COLLAPSED_KEY = 'playlet-admin-sidebar-collapsed'

const { contentMode = 'scroll' } = defineProps<{
  contentMode?: 'scroll' | 'fixed'
}>()

const route = useRoute()
const router = useRouter()
const menuCollapsed = ref(false)

const { data } = await useFetch<{ success: boolean, data: { user: { account: string, displayName: string, role: string } } }>('/api/me', {
  server: false
})

const me = computed(() => data.value?.data.user)
const meLabel = computed(() => me.value ? `${me.value.displayName || me.value.account}` : '未登录')
const meInitial = computed(() => meLabel.value.trim().charAt(0).toUpperCase() || '?')
const accountMeta = computed(() => {
  if (!me.value) return '身份未知'
  const role = userRoleLabel(me.value.role)
  return me.value.displayName && me.value.displayName !== me.value.account
    ? `${role} · ${me.value.account}`
    : role
})
const menuToggleLabel = computed(() => menuCollapsed.value ? '展开菜单' : '折叠菜单')

const menuIconPaths = {
  overview: [
    'M3 3h7v7H3V3Z',
    'M14 3h7v4h-7V3Z',
    'M14 11h7v10h-7V11Z',
    'M3 17h7v4H3v-4Z'
  ],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75'
  ],
  providers: [
    'M21 2l-2 2',
    'M15 7l2 2',
    'M11.39 11.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78Z',
    'M14 8l-4.5 4.5',
    'M16.5 5.5l2 2'
  ],
  assets: [
    'M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25',
    'M8 16h8',
    'M8 20h8',
    'M12 12v8'
  ],
  versions: [
    'M21 16v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
    'M7 10l5 5 5-5',
    'M12 15V3',
    'M5 6h14'
  ],
  logs: [
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z',
    'M14 2v6h6',
    'M8 13h8',
    'M8 17h6'
  ],
  settings: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z'
  ]
} as const

function renderMenuIcon(name: keyof typeof menuIconPaths) {
  return h(
    'svg',
    {
      'aria-hidden': 'true',
      fill: 'none',
      height: '1em',
      stroke: 'currentColor',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-width': '1.8',
      style: 'display: block;',
      viewBox: '0 0 24 24',
      width: '1em'
    },
    menuIconPaths[name].map((d) => h('path', { d }))
  )
}

const menuOptions = [
  { label: '总览', key: '/', icon: () => renderMenuIcon('overview') },
  { label: '用户管理', key: '/users', icon: () => renderMenuIcon('users') },
  { label: '云端素材', key: '/tos-files', icon: () => renderMenuIcon('assets') },
  { label: '资源库管理', key: '/library-assets', icon: () => renderMenuIcon('assets') },
  { label: '调用日志', key: '/logs', icon: () => renderMenuIcon('logs') },
  { label: '供应商 Key', key: '/providers', icon: () => renderMenuIcon('providers') },
  { label: '默认提示词', key: '/prompt-templates', icon: () => renderMenuIcon('settings') },
  { label: '客户端版本', key: '/client-versions', icon: () => renderMenuIcon('versions') },
  { label: '系统设置', key: '/settings', icon: () => renderMenuIcon('settings') }
]

const selectedKey = computed(() => {
  if (route.path.startsWith('/users')) return '/users'
  if (route.path.startsWith('/providers')) return '/providers'
  if (route.path.startsWith('/tos-files')) return '/tos-files'
  if (route.path.startsWith('/library-assets')) return '/library-assets'
  if (route.path.startsWith('/client-versions')) return '/client-versions'
  if (route.path.startsWith('/logs')) return '/logs'
  if (route.path.startsWith('/settings')) return '/settings'
  return '/'
})

function handleNavigate(key: string) {
  void router.push(key)
}

function toggleMenuCollapsed() {
  menuCollapsed.value = !menuCollapsed.value
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
  await router.push('/login')
}

onMounted(() => {
  menuCollapsed.value = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
})

watch(menuCollapsed, (value) => {
  if (import.meta.client) {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(value))
  }
})
</script>

<style scoped>
.admin-shell {
  height: 100vh;
  overflow: hidden;
}

.admin-shell__main {
  height: 100vh;
  overflow: hidden;
}

.admin-shell__sider :deep(.n-layout-sider-scroll-container) {
  display: flex;
  height: 100%;
  flex-direction: column;
}

.admin-shell__content {
  height: 100vh;
  overflow: auto;
}

.admin-shell__content--fixed {
  overflow: hidden;
}

.admin-shell__navigation {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}

.admin-brand {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 64px;
  padding: 16px 14px 12px;
}

.admin-brand--collapsed {
  justify-content: center;
  padding-right: 0;
  padding-left: 0;
}

.admin-brand__mark {
  display: grid;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: #18a058;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  line-height: 1;
  padding: 0;
}

.admin-brand__mark:focus-visible {
  outline: 2px solid rgba(24, 160, 88, 0.3);
  outline-offset: 2px;
}

.admin-brand__logo,
.admin-brand__toggle-icon {
  grid-area: 1 / 1;
  transition: opacity 0.15s ease;
}

.admin-brand__toggle-icon {
  opacity: 0;
}

.admin-brand__mark:hover .admin-brand__logo,
.admin-brand__mark:focus-visible .admin-brand__logo {
  opacity: 0;
}

.admin-brand__mark:hover .admin-brand__toggle-icon,
.admin-brand__mark:focus-visible .admin-brand__toggle-icon {
  opacity: 1;
}

.admin-brand__body {
  min-width: 0;
}

.admin-brand__title {
  overflow: hidden;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-brand__meta {
  overflow: hidden;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-menu-fallback {
  display: grid;
  gap: 2px;
  padding: 8px 6px;
}

.admin-menu-fallback__item {
  display: flex;
  align-items: center;
  min-height: 42px;
  border-radius: 4px;
  padding: 0 12px;
  color: #333639;
  font-size: 14px;
}

.admin-menu-fallback__item:hover {
  background: #f3f3f5;
}

.admin-account {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 30px;
  align-items: center;
  gap: 8px;
  margin: 8px;
  border-top: 1px solid #e4e7ec;
  padding: 12px 4px 4px;
}

.admin-account--collapsed {
  grid-template-columns: 32px;
  justify-content: center;
  gap: 8px;
  margin-right: 8px;
  margin-left: 8px;
  padding-right: 4px;
  padding-left: 4px;
}

.admin-account__avatar {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 6px;
  background: #e8f5ee;
  color: #137a43;
  font-size: 13px;
  font-weight: 700;
}

.admin-account__body {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.admin-account__name,
.admin-account__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-account__name {
  color: #1f2328;
  font-size: 13px;
  font-weight: 600;
}

.admin-account__meta {
  color: #667085;
  font-size: 11px;
}

.admin-account__logout {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 0;
  border-radius: 5px;
  padding: 0;
  background: transparent;
  color: #667085;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.admin-account__logout:hover {
  background: #f2f4f7;
  color: #b42318;
}

.admin-account__logout:focus-visible {
  outline: 2px solid rgba(24, 160, 88, 0.3);
  outline-offset: 1px;
}
</style>
