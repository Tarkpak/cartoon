<template>
  <div class="auth-page">
    <n-card title="登录后台" style="width: 420px">
      <n-alert v-if="error" type="error" style="margin-bottom: 16px">{{ error }}</n-alert>
      <n-form>
        <n-form-item label="账号">
          <n-input v-model:value="form.account" />
        </n-form-item>
        <n-form-item label="密码">
          <n-input v-model:value="form.password" type="password" show-password-on="click" @keyup.enter="submit" />
        </n-form-item>
        <n-button type="primary" block :loading="submitting" @click="submit">登录</n-button>
      </n-form>
    </n-card>
  </div>
</template>

<script setup lang="ts">
const router = useRouter()
const form = reactive({
  account: 'admin',
  password: ''
})
const submitting = ref(false)
const error = ref('')

onMounted(async () => {
  const status = await $fetch<{ success: boolean, data: { initialized: boolean } }>('/api/setup/status')
  if (!status.data.initialized) await router.push('/setup')
})

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: form
    })
    await router.push('/')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '登录失败'
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

