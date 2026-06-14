<script setup lang="ts">
import { Clapperboard, Loader2 } from 'lucide-vue-next'
import { useCloudAdmin } from '@/composables/useCloudAdmin'

const router = useRouter()
const route = useRoute()
const { login, loadStatus, loading, error } = useCloudAdmin()
const DEFAULT_CLOUD_ADMIN_BASE_URL = import.meta.env.DEV
  ? 'http://127.0.0.1:43200'
  : 'https://admin.tempocc.cn'

const form = reactive({
  baseUrl: DEFAULT_CLOUD_ADMIN_BASE_URL,
  account: '',
  password: ''
})

onMounted(async () => {
  const status = await loadStatus()
  if (status?.baseUrl) {
    form.baseUrl = status.baseUrl
  }
  if (status?.authenticated) {
    await router.replace(typeof route.query.redirect === 'string' ? route.query.redirect : '/')
  }
})

async function submit() {
  try {
    await login(form)
    await router.replace(typeof route.query.redirect === 'string' ? route.query.redirect : '/')
  } catch {
    // useCloudAdmin already exposes the readable error message for the form.
  }
}
</script>

<template>
  <div class="min-h-screen bg-background grid place-items-center px-4">
    <Card class="w-full max-w-md">
      <CardHeader>
        <div class="flex items-center gap-2">
          <Clapperboard class="h-6 w-6 text-primary" />
          <CardTitle>登录后台</CardTitle>
        </div>
        <CardDescription>
          客户端必须连接后台后才能使用生成能力。
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div
          v-if="error"
          class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {{ error }}
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium">账号</label>
          <Input
            v-model="form.account"
            placeholder="admin"
          />
        </div>
        <div class="space-y-2">
          <label class="text-sm font-medium">密码</label>
          <Input
            v-model="form.password"
            type="password"
            @keyup.enter="submit"
          />
        </div>
      </CardContent>
      <CardFooter>
        <Button
          class="w-full"
          :disabled="loading || !form.baseUrl || !form.account || !form.password"
          @click="submit"
        >
          <Loader2
            v-if="loading"
            class="mr-2 h-4 w-4 animate-spin"
          />
          登录并拉取 Key
        </Button>
      </CardFooter>
    </Card>
  </div>
</template>
