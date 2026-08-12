<template>
  <AdminShell>
    <div class="page prompt-templates-page">
      <n-spin :show="pending">
        <n-space vertical size="large">
          <n-card :bordered="false">
            <div class="settings-section-heading">
              <span class="settings-section-title">默认提示词模板</span>
            </div>
            <n-text depth="3" class="settings-help">
              在这里配置的内容会作为系统默认提示词，通过客户端登录 / 心跳同步下发，覆盖客户端内置默认值。
              用户在客户端里自定义过的模板不受影响。内容留空并保存即恢复为客户端内置默认。
            </n-text>
            <n-grid :cols="1" :y-gap="12" style="margin-top: 16px">
              <n-grid-item>
                <n-select
                  v-model:value="selectedKey"
                  :options="templateOptions"
                  placeholder="选择要配置的提示词模板"
                />
              </n-grid-item>
              <n-grid-item v-if="selectedMeta">
                <n-text depth="3">{{ selectedMeta.description }}</n-text>
              </n-grid-item>
              <n-grid-item v-if="selectedKey">
                <n-input
                  v-model:value="draftContent"
                  type="textarea"
                  :autosize="{ minRows: 14, maxRows: 32 }"
                  placeholder="留空表示使用客户端内置默认提示词"
                />
              </n-grid-item>
              <n-grid-item v-if="selectedKey">
                <n-space justify="space-between" align="center">
                  <n-text v-if="currentOverride" depth="3">
                    已配置云端默认，更新于 {{ currentOverride.updatedAt }}
                  </n-text>
                  <n-text v-else depth="3">当前使用客户端内置默认</n-text>
                  <n-space>
                    <n-button
                      v-if="currentOverride"
                      tertiary
                      type="error"
                      :loading="saving"
                      @click="reset"
                    >
                      恢复内置默认
                    </n-button>
                    <n-button type="primary" :loading="saving" @click="save">保存</n-button>
                  </n-space>
                </n-space>
              </n-grid-item>
            </n-grid>
          </n-card>
        </n-space>
      </n-spin>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui'
import { PROMPT_TEMPLATE_METADATA } from '@playlet-shared/types/prompt-template'

interface PromptTemplateOverride {
  templateKey: string
  title: string | null
  content: string
  updatedAt: string
}

const message = useMessage()
const pending = ref(false)
const saving = ref(false)
const overrides = ref<PromptTemplateOverride[]>([])
const selectedKey = ref<string>('')
const draftContent = ref('')

const templateOptions = PROMPT_TEMPLATE_METADATA.map(meta => ({
  label: `${meta.name}（${meta.id}）`,
  value: meta.id
}))

const selectedMeta = computed(() => {
  return PROMPT_TEMPLATE_METADATA.find(meta => meta.id === selectedKey.value) || null
})

const currentOverride = computed(() => {
  return overrides.value.find(item => item.templateKey === selectedKey.value) || null
})

watch(selectedKey, () => {
  draftContent.value = currentOverride.value?.content || ''
})

async function load() {
  pending.value = true
  try {
    const response = await $fetch<{ data: { templates: Array<{ template_key: string, title: string | null, content: string, updated_at: string }> } }>('/api/admin/prompt-templates')
    overrides.value = response.data.templates.map(item => ({
      templateKey: item.template_key,
      title: item.title,
      content: item.content,
      updatedAt: item.updated_at
    }))
    draftContent.value = currentOverride.value?.content || ''
  } catch {
    message.error('默认提示词加载失败')
  } finally {
    pending.value = false
  }
}

async function submit(content: string) {
  if (!selectedKey.value) return
  saving.value = true
  try {
    await $fetch('/api/admin/prompt-templates', {
      method: 'PUT',
      body: {
        templateKey: selectedKey.value,
        title: selectedMeta.value?.name || '',
        content
      }
    })
    message.success(content.trim() ? '默认提示词已保存' : '已恢复客户端内置默认')
    await load()
  } catch {
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

function save() {
  submit(draftContent.value)
}

function reset() {
  draftContent.value = ''
  submit('')
}

onMounted(load)
</script>
