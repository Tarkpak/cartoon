<script setup lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, RotateCcw } from 'lucide-vue-next'

const desktop = isTauri()
const directory = ref('')
const busy = ref(false)
const error = ref('')
const { toast } = useToast()

async function run(action: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

async function changeDirectory(reset = false) {
  await run(async () => {
    const selected = reset ? null : await open({
      title: '选择下载目录',
      directory: true,
      multiple: false,
      defaultPath: directory.value || undefined
    })
    if (!reset && !selected) return
    directory.value = await invoke<string>('set_download_directory', { directory: selected })
    toast.success(reset ? '已恢复系统下载目录' : '下载目录已更新')
  })
}

onMounted(() => {
  if (desktop) {
    void run(async () => {
      directory.value = await invoke<string>('get_download_directory')
    })
  }
})
</script>

<template>
  <div v-if="desktop" class="space-y-4 rounded-xl bg-muted/25 p-5">
    <div>
      <h3 class="text-sm font-medium">下载目录</h3>
      <p class="mt-1 text-xs text-muted-foreground">
        所有项目共用此目录，默认使用系统下载文件夹。分镜视频自动保存，同名文件自动编号。
      </p>
    </div>
    <p class="break-all rounded-lg bg-muted/30 px-3 py-2 text-xs" aria-live="polite">
      {{ directory || (busy ? '正在读取下载目录…' : '尚未读取下载目录') }}
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" class="h-8 gap-1.5" :disabled="busy" @click="changeDirectory()">
        <FolderOpen class="h-3.5 w-3.5" />更改目录
      </Button>
      <Button variant="ghost" size="sm" class="h-8 gap-1.5 text-muted-foreground" :disabled="busy" @click="changeDirectory(true)">
        <RotateCcw class="h-3.5 w-3.5" />恢复默认
      </Button>
    </div>
    <p v-if="error" class="text-xs text-destructive" role="alert">{{ error }}</p>
  </div>
</template>
