<template>
  <div class="auth-page">
    <n-card title="初始化管理员" style="width: 420px">
      <n-alert v-if="error" type="error" style="margin-bottom: 16px">{{ error }}</n-alert>
      <n-form>
        <n-form-item label="账号">
          <n-input v-model:value="form.account" placeholder="admin" />
        </n-form-item>
        <n-form-item label="显示名称">
          <n-input v-model:value="form.displayName" placeholder="管理员" />
        </n-form-item>
        <n-form-item label="密码">
          <n-input v-model:value="form.password" type="password" show-password-on="click" />
        </n-form-item>
        <n-button type="primary" block :loading="submitting" @click="submit">创建管理员</n-button>
      </n-form>
    </n-card>
  </div>
</template>

<script setup lang="ts">
const router = useRouter()
const form = reactive({
  account: 'admin',
  displayName: '管理员',
  password: ''
})
const submitting = ref(false)
const error = ref('')

onMounted(async () => {
  const status = await $fetch<{ success: boolean, data: { initialized: boolean } }>('/api/setup/status')
  if (status.data.initialized) await router.push('/login')
})

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    await $fetch('/api/setup/initialize', {
      method: 'POST',
      body: form
    })
    await router.push('/')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '初始化失败'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
}
</style>

