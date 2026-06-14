import { computed, ref } from 'vue'

interface CloudAdminStatus {
  configured: boolean
  baseUrl: string
  authenticated: boolean
  user?: {
    account?: string
    displayName?: string
    role?: string
  } | null
  deviceId?: string
  lastBootstrapAt?: string | null
  credentials?: Record<string, unknown>
}

const status = ref<CloudAdminStatus | null>(null)
const loading = ref(false)
const error = ref('')

function errorPayload(error: unknown) {
  return error as {
    data?: { message?: string, statusMessage?: string }
    response?: { _data?: { message?: string, statusMessage?: string } }
    message?: string
  }
}

function normalizeCloudError(error: unknown, fallback: string) {
  const payload = errorPayload(error)
  const message = payload.data?.message
    || payload.data?.statusMessage
    || payload.response?._data?.message
    || payload.response?._data?.statusMessage
    || payload.message
    || fallback

  const cleaned = String(message).replace(/^后台接口失败[:：]\s*/u, '').trim()
  if (cleaned === 'Invalid account or password') return '账号或密码错误'
  if (cleaned === 'User disabled') return '账号已被禁用'
  if (cleaned === 'Device disabled') return '当前设备已被禁用'
  if (cleaned === 'Device limit reached') return '登录设备数量已达到上限'
  if (/^\[(GET|POST|PUT|PATCH|DELETE)\]/u.test(cleaned)) return fallback
  return cleaned || fallback
}

export function useCloudAdmin() {
  const authenticated = computed(() => status.value?.authenticated === true)
  const baseUrl = computed(() => status.value?.baseUrl || '')
  const currentUser = computed(() => status.value?.user || null)

  async function loadStatus() {
    loading.value = true
    error.value = ''
    try {
      const response = await $fetch<{ success: boolean, data: CloudAdminStatus }>('/api/cloud/status')
      status.value = response.data
      return response.data
    } catch (err) {
      error.value = normalizeCloudError(err, '后台状态加载失败')
      status.value = null
      return null
    } finally {
      loading.value = false
    }
  }

  async function login(input: { baseUrl: string, account: string, password: string }) {
    loading.value = true
    error.value = ''
    try {
      const response = await $fetch<{ success: boolean, data: CloudAdminStatus }>('/api/cloud/login', {
        method: 'POST',
        body: input
      })
      status.value = response.data
      return response.data
    } catch (err) {
      error.value = normalizeCloudError(err, '登录后台失败')
      throw err
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    const response = await $fetch<{ success: boolean, data: CloudAdminStatus }>('/api/cloud/logout', {
      method: 'POST'
    })
    status.value = response.data
  }

  async function bootstrap() {
    const response = await $fetch<{ success: boolean, data: CloudAdminStatus }>('/api/cloud/bootstrap', {
      method: 'POST'
    })
    status.value = response.data
    return response.data
  }

  async function heartbeat() {
    await $fetch('/api/cloud/heartbeat', { method: 'POST' })
  }

  return {
    status,
    loading,
    error,
    authenticated,
    baseUrl,
    currentUser,
    loadStatus,
    login,
    logout,
    bootstrap,
    heartbeat
  }
}
