<template>
  <AdminShell>
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">系统设置</h1>
          <p class="page-subtitle">设备限制和日志归档阈值均为单机后台配置。</p>
        </div>
      </div>

      <n-card style="max-width: 680px">
        <n-spin :show="pending">
          <n-form label-placement="left" label-width="160">
            <n-form-item label="每用户最大设备数">
              <n-input-number v-model:value="form.maxDevicesPerUser" :min="1" />
            </n-form-item>
            <n-form-item label="限制同时在线">
              <n-switch v-model:value="form.restrictConcurrentDevices" />
            </n-form-item>
            <n-form-item label="最大同时在线设备">
              <n-input-number v-model:value="form.maxConcurrentDevices" :min="1" />
            </n-form-item>
            <n-form-item label="禁用失效秒数">
              <n-input-number v-model:value="form.disabledGraceSeconds" :min="0" />
            </n-form-item>
            <n-form-item label="日志归档阈值">
              <n-input-number v-model:value="form.logArchiveMaxRows" :min="1000" />
            </n-form-item>
            <n-space justify="end">
              <n-button type="primary" :loading="saving" @click="save">保存设置</n-button>
            </n-space>
          </n-form>
        </n-spin>
      </n-card>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui'

const message = useMessage()
const pending = ref(false)
const saving = ref(false)
const form = reactive({
  maxDevicesPerUser: 3,
  restrictConcurrentDevices: false,
  maxConcurrentDevices: 1,
  disabledGraceSeconds: 60,
  logArchiveMaxRows: 50000
})

async function load() {
  pending.value = true
  try {
    const response = await $fetch<{ data: typeof form }>('/api/admin/settings')
    Object.assign(form, response.data)
  } finally {
    pending.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const response = await $fetch<{ data: typeof form }>('/api/admin/settings', {
      method: 'PUT',
      body: form
    })
    Object.assign(form, response.data)
    message.success('设置已保存')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

