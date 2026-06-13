<script setup lang="ts">
import {
  CheckCircle2,
  Download,
  Loader2,
  ShieldCheck,
  TriangleAlert,
  Upload
} from 'lucide-vue-next'
import { useSettingsModelCatalog } from '@/composables/useSettingsModelCatalog'
import {
  downloadSettingsConfigExportUrl,
  parseSettingsConfigImportFile
} from '@/lib/settings-config-transfer'

interface SettingsConfigImportResponse {
  success: boolean
  data?: {
    imported?: string[]
  }
}

const SETTINGS_CONFIG_IMPORTED_EVENT = 'playlet:settings-config-imported'
const IMPORTED_SECTION_LABELS: Record<string, string> = {
  modelProviders: '模型供应商',
  workflowModels: '模型配置',
  tosStorage: '云存储'
}

const importing = ref(false)
const exporting = ref(false)
const message = ref('')
const errorMessage = ref('')
const importInputRef = ref<{ click: () => void } | null>(null)
const { loadModels } = useSettingsModelCatalog()

function triggerImport() {
  importInputRef.value?.click()
}

function formatImportedSections(sections?: string[]): string {
  const labels = (sections || [])
    .map(section => IMPORTED_SECTION_LABELS[section] || section)
    .filter(Boolean)

  if (labels.length === 0) {
    return '已导入通用配置'
  }
  return `已导入${labels.join('、')}配置`
}

async function handleImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  importing.value = true
  message.value = ''
  errorMessage.value = ''

  try {
    const payload = await parseSettingsConfigImportFile(file)
    const response = await $fetch<SettingsConfigImportResponse>('/api/settings/config/import', {
      method: 'POST',
      body: { payload }
    })

    if (response.success) {
      message.value = formatImportedSections(response.data?.imported)
      window.dispatchEvent(new CustomEvent(SETTINGS_CONFIG_IMPORTED_EVENT))
      await loadModels(true)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '导入通用配置失败'
  } finally {
    importing.value = false
    input.value = ''
  }
}

async function exportConfig() {
  exporting.value = true
  message.value = ''
  errorMessage.value = ''

  try {
    const result = await downloadSettingsConfigExportUrl('/api/settings/config/download', 'settings')
    if (result.status === 'cancelled') {
      message.value = '已取消导出通用配置'
    } else if (result.status === 'saved') {
      message.value = `已导出通用配置：${result.fileName}。保存位置：${result.path}`
    } else {
      message.value = `已开始下载通用配置：${result.fileName}。请在浏览器或系统默认下载目录查看。`
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '导出通用配置失败'
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="space-y-4 rounded-lg border bg-background p-5">
    <div class="flex flex-col gap-3 @xl:flex-row @xl:items-start @xl:justify-between">
      <div class="flex min-w-0 items-start gap-3">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted/30">
          <ShieldCheck class="h-4 w-4 text-primary" />
        </div>
        <div class="min-w-0">
          <h3 class="text-sm font-medium">
            配置迁移
          </h3>
          <p class="mt-1 text-xs text-muted-foreground">
            一次导入或导出模型供应商与模型配置，导出文件内容已加密。
          </p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Input
          ref="importInputRef"
          type="file"
          accept=".json,application/json"
          class="hidden"
          @change="handleImport"
        />
        <Button
          variant="outline"
          size="sm"
          class="h-8 gap-1.5"
          :disabled="importing || exporting"
          title="导入通用配置"
          @click="triggerImport"
        >
          <Loader2
            v-if="importing"
            class="h-3.5 w-3.5 animate-spin"
          />
          <Upload
            v-else
            class="h-3.5 w-3.5"
          />
          导入配置
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-8 gap-1.5"
          :disabled="importing || exporting"
          title="导出通用配置"
          @click="exportConfig"
        >
          <Loader2
            v-if="exporting"
            class="h-3.5 w-3.5 animate-spin"
          />
          <Download
            v-else
            class="h-3.5 w-3.5"
          />
          导出配置
        </Button>
      </div>
    </div>

    <div
      v-if="message"
      class="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-600"
    >
      <CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0" />
      <span class="min-w-0 flex-1 break-all">{{ message }}</span>
    </div>

    <div
      v-if="errorMessage"
      class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
      {{ errorMessage }}
    </div>
  </div>
</template>
