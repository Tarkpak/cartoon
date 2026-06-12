<template>
  <AdminShell>
    <div class="page">
      <div class="page-header page-header--actions">
        <n-button @click="$router.push('/users')">返回用户列表</n-button>
      </div>

      <n-spin :show="pending">
        <n-grid v-if="detail" :cols="4" :x-gap="16" style="margin-bottom: 16px">
          <n-gi><n-card><n-statistic label="项目" :value="detail.stats.projectCount" /></n-card></n-gi>
          <n-gi><n-card><n-statistic label="提示词模板" :value="detail.stats.promptTemplateCount" /></n-card></n-gi>
          <n-gi><n-card><n-statistic label="模型偏好" :value="detail.stats.preferenceCount" /></n-card></n-gi>
          <n-gi><n-card><n-statistic label="调用日志" :value="detail.stats.logCount" /></n-card></n-gi>
        </n-grid>

        <n-tabs type="line">
          <n-tab-pane name="projects" tab="项目">
            <n-data-table :columns="projectColumns" :data="projects" />
            <n-drawer v-model:show="projectDrawer" width="720">
              <n-drawer-content title="项目快照">
                <pre class="json-view">{{ selectedProjectJson }}</pre>
              </n-drawer-content>
            </n-drawer>
          </n-tab-pane>
          <n-tab-pane name="prompts" tab="提示词">
            <n-card title="当前提示词快照">
              <pre class="json-view">{{ promptJson }}</pre>
            </n-card>
          </n-tab-pane>
          <n-tab-pane name="models" tab="模型选择">
            <n-data-table :columns="preferenceColumns" :data="preferences" />
          </n-tab-pane>
          <n-tab-pane name="devices" tab="设备">
            <n-data-table :columns="deviceColumns" :data="devices" />
          </n-tab-pane>
        </n-tabs>
      </n-spin>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NButton, NTag } from 'naive-ui'

const route = useRoute()
const userId = computed(() => String(route.params.id))
const pending = ref(false)
const detail = ref<any>(null)
const projects = ref<any[]>([])
const promptState = ref<any>(null)
const preferences = ref<any[]>([])
const devices = ref<any[]>([])
const projectDrawer = ref(false)
const selectedProjectJson = ref('')

const promptJson = computed(() => JSON.stringify(promptState.value?.snapshot || {}, null, 2))

const projectColumns = [
  { title: '名称', key: 'name' },
  { title: '状态', key: 'status' },
  { title: '风格', key: 'style_id' },
  { title: '画幅', key: 'aspect_ratio' },
  { title: '同步时间', key: 'last_synced_at' },
  {
    title: '操作',
    key: 'actions',
    render(row: any) {
      return h(NButton, { size: 'small', onClick: () => openProject(row.id) }, { default: () => '查看快照' })
    }
  }
]

const preferenceColumns = [
  { title: '业务步骤', key: 'workflow_step' },
  { title: '模型', key: 'model_id' },
  {
    title: '参数',
    key: 'modelOptions',
    render(row: any) {
      return h('span', { class: 'mono' }, JSON.stringify(row.modelOptions || {}))
    }
  },
  { title: '更新时间', key: 'updated_at' }
]

const deviceColumns = [
  { title: '设备 ID', key: 'device_id' },
  { title: '名称', key: 'device_name' },
  { title: '系统', key: 'os' },
  { title: '版本', key: 'client_version' },
  {
    title: '状态',
    key: 'status',
    render(row: any) {
      return h(NTag, { size: 'small', type: row.status === 'active' ? 'success' : 'error' }, { default: () => row.status })
    }
  },
  { title: '最后在线', key: 'last_seen_at' },
  {
    title: '操作',
    key: 'actions',
    render(row: any) {
      return h(
        NButton,
        {
          size: 'small',
          type: row.status === 'active' ? 'error' : 'success',
          onClick: () => updateDeviceStatus(row)
        },
        { default: () => row.status === 'active' ? '禁用' : '启用' }
      )
    }
  }
]

async function load() {
  pending.value = true
  try {
    const [detailResponse, projectsResponse, promptsResponse, preferencesResponse, devicesResponse] = await Promise.all([
      $fetch<any>(`/api/admin/users/${userId.value}`),
      $fetch<any>(`/api/admin/users/${userId.value}/projects`),
      $fetch<any>(`/api/admin/users/${userId.value}/prompts`),
      $fetch<any>(`/api/admin/users/${userId.value}/model-preferences`),
      $fetch<any>(`/api/admin/users/${userId.value}/devices`)
    ])
    detail.value = detailResponse.data
    projects.value = projectsResponse.data.projects
    promptState.value = promptsResponse.data.state
    preferences.value = preferencesResponse.data.preferences
    devices.value = devicesResponse.data.devices
  } finally {
    pending.value = false
  }
}

async function openProject(projectId: string) {
  const response = await $fetch<any>(`/api/admin/users/${userId.value}/projects/${projectId}`)
  selectedProjectJson.value = JSON.stringify(response.data.snapshot?.data || response.data.project, null, 2)
  projectDrawer.value = true
}

async function updateDeviceStatus(row: any) {
  await $fetch(`/api/admin/devices/${row.id}/status`, {
    method: 'PATCH',
    body: { status: row.status === 'active' ? 'disabled' : 'active' }
  })
  await load()
}

onMounted(load)
</script>

<style scoped>
.json-view {
  max-height: 70vh;
  overflow: auto;
  padding: 12px;
  border-radius: 6px;
  background: #101828;
  color: #f2f4f7;
  font-size: 12px;
}
</style>
