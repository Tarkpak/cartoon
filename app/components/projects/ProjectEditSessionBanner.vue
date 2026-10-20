<script setup lang="ts">
import { AlertCircle, Loader2, LockKeyhole } from 'lucide-vue-next'
import type { ProjectEditSessionState } from '~/composables/useProjectEditSession'

defineProps<{ session: ProjectEditSessionState, busy: boolean }>()
defineEmits<{ (event: 'retry'): void, (event: 'takeover'): void, (event: 'download-backup'): void }>()
</script>

<template>
  <div v-if="busy || !session.editable || session.scopeConflict || session.reason" class="flex shrink-0 flex-wrap items-center gap-2 rounded-md bg-muted/45 px-3 py-2 text-xs text-muted-foreground" role="status">
    <Loader2 v-if="busy" class="h-4 w-4 shrink-0 animate-spin" />
    <AlertCircle v-else-if="session.editable" class="h-4 w-4 shrink-0" />
    <LockKeyhole v-else class="h-4 w-4 shrink-0" />
    <span class="min-w-0 flex-1">{{ session.reason || (session.holderName ? `${session.holderName} 正在编辑，当前为只读模式。` : '当前为只读模式。') }}</span>
    <Button v-if="session.backupId || session.scopeConflict" size="sm" variant="outline" @click="$emit('download-backup')">下载未同步修改</Button>
    <Button v-if="!busy" size="sm" variant="outline" @click="$emit('retry')">
      {{ session.scopeConflict && session.editable && session.collaboration ? '对比并合并' : session.scopeConflict && !session.collaboration ? '读取最新内容' : session.collaboration ? '重新连接' : '重新取得编辑权' }}
    </Button>
    <Button v-if="session.canTakeover && session.holderName" size="sm" variant="outline" :disabled="busy" @click="$emit('takeover')">接管编辑权</Button>
  </div>
</template>
