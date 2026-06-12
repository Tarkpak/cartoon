<template>
  <n-layout has-sider style="min-height: 100vh">
    <n-layout-sider bordered width="224">
      <div style="padding: 18px 18px 10px">
        <div style="font-size: 18px; font-weight: 700">Playlet Admin</div>
        <div class="muted" style="margin-top: 4px; font-size: 12px">{{ meLabel }}</div>
      </div>
      <n-menu
        :value="selectedKey"
        :options="menuOptions"
        @update:value="handleNavigate"
      />
    </n-layout-sider>
    <n-layout>
      <n-layout-header bordered style="height: 56px; display: flex; align-items: center; justify-content: flex-end; padding: 0 20px">
        <n-space align="center">
          <n-tag v-if="me?.role" size="small" type="info">{{ me.role }}</n-tag>
          <n-button size="small" @click="logout">退出</n-button>
        </n-space>
      </n-layout-header>
      <n-layout-content>
        <slot />
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<script setup lang="ts">
const route = useRoute()
const router = useRouter()

const { data } = await useFetch<{ success: boolean, data: { user: { account: string, displayName: string, role: string } } }>('/api/me', {
  server: false
})

const me = computed(() => data.value?.data.user)
const meLabel = computed(() => me.value ? `${me.value.displayName || me.value.account}` : '未登录')

const menuOptions = [
  { label: '总览', key: '/' },
  { label: '用户管理', key: '/users' },
  { label: '供应商 Key', key: '/providers' },
  { label: '调用日志', key: '/logs' },
  { label: '系统设置', key: '/settings' }
]

const selectedKey = computed(() => {
  if (route.path.startsWith('/users')) return '/users'
  if (route.path.startsWith('/providers')) return '/providers'
  if (route.path.startsWith('/logs')) return '/logs'
  if (route.path.startsWith('/settings')) return '/settings'
  return '/'
})

function handleNavigate(key: string) {
  void router.push(key)
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
  await router.push('/login')
}
</script>

