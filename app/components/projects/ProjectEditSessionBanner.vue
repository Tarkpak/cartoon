<script setup lang="ts">
import { computed } from 'vue'
import { Check, CloudOff, Loader2, LockKeyhole, Users } from 'lucide-vue-next'
import type { ProjectEditSessionState } from '~/composables/useProjectEditSession'
import { summarizeProjectPresence, type ProjectParticipant } from '~/lib/project-presence'

const props = defineProps<{ session: ProjectEditSessionState, busy: boolean, participants?: ProjectParticipant[] }>()
defineEmits<{ (event: 'retry'): void, (event: 'takeover'): void, (event: 'download-backup'): void }>()
const needsAttention = computed(() => !props.session.editable || props.session.scopeConflict || props.session.syncStatus === 'offline')
const syncLabel = computed(() => ({ connecting: '正在连接', synced: '已同步', editing: '有未保存修改', saving: '正在保存', offline: '连接中断，修改保留在本机' })[props.session.syncStatus || 'connecting'])
const members = computed(() => summarizeProjectPresence(props.session.collaborators, props.participants))
const memberSummary = computed(() => members.value.map(member => `${member.displayName} · ${member.activity}`).join('\n'))
</script>

<template>
  <div v-if="session.collaboration || needsAttention" class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-muted/45 px-3 py-2 text-xs text-muted-foreground" role="status" aria-live="polite">
    <span v-if="session.collaboration" class="inline-flex shrink-0 items-center gap-1.5">
      <Users class="h-3.5 w-3.5" :stroke-width="1.5" />协作模式
    </span>
    <span v-if="!needsAttention" class="inline-flex items-center gap-1.5">
      <Loader2 v-if="session.syncStatus === 'saving'" class="h-3.5 w-3.5 animate-spin" :stroke-width="1.5" />
      <Check v-else-if="session.syncStatus === 'synced'" class="h-3.5 w-3.5" :stroke-width="1.5" />
      {{ syncLabel }}
    </span>
    <template v-else>
      <CloudOff v-if="session.syncStatus === 'offline'" class="h-3.5 w-3.5 shrink-0" :stroke-width="1.5" />
      <LockKeyhole v-else class="h-3.5 w-3.5 shrink-0" :stroke-width="1.5" />
      <span class="min-w-0 flex-1">{{ session.reason || (session.holderName ? `${session.holderName} 正在编辑，当前为只读模式。` : session.collaboration ? syncLabel : '当前为只读模式。') }}</span>
    </template>
    <span v-if="!needsAttention && session.lastRemoteUpdate" class="text-muted-foreground/80">{{ session.lastRemoteUpdate }}</span>
    <div v-if="session.collaboration" class="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1.5" :title="memberSummary">
      <span v-if="session.presenceAvailable && session.onlineCount" class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap tabular-nums">
        <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />{{ session.onlineCount }} 人在线
      </span>
      <span v-else-if="session.presenceAvailable === false" class="shrink-0">成员状态暂不可用</span>
      <span v-for="member in members.slice(0, 2)" :key="member.userId" class="inline-flex min-w-0 max-w-[min(20rem,70vw)] items-center gap-1.5 rounded bg-background/60 px-2 py-1" :class="member.locked ? 'text-foreground' : ''" :title="`${member.displayName} · ${member.activity}`">
        <LockKeyhole v-if="member.locked" class="h-3 w-3 shrink-0" :stroke-width="1.5" />
        <span class="truncate"><span class="font-medium text-foreground">{{ member.displayName }}</span><span class="mx-1.5 text-muted-foreground/50">·</span>{{ member.activity }}</span>
      </span>
      <span v-if="members.length > 2" class="shrink-0 whitespace-nowrap" :title="memberSummary">另 {{ members.length - 2 }} 人</span>
    </div>
    <Button v-if="needsAttention && (session.backupId || session.scopeConflict)" size="sm" variant="outline" @click="$emit('download-backup')">下载未同步修改</Button>
    <Button v-if="needsAttention && (session.editable || session.syncStatus !== 'synced')" size="sm" variant="outline" :disabled="busy" @click="$emit('retry')">
      <Loader2 v-if="busy" class="mr-1 h-3 w-3 animate-spin" />{{ session.pendingSave ? '确认上次提交' : session.scopeConflict && session.collaboration && session.editable ? '对比并合并' : session.scopeConflict ? '读取最新内容' : session.collaboration ? '重试协作连接' : '重新取得编辑权' }}
    </Button>
    <Button v-if="session.canTakeover && session.holderName" size="sm" variant="outline" :disabled="busy" @click="$emit('takeover')">接管编辑权</Button>
  </div>
</template>
