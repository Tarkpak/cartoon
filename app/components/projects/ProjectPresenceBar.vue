<script setup lang="ts">
import { Users } from 'lucide-vue-next'
defineProps<{ participants?: Array<{ userId: string, displayName: string, locations: string[] }> }>()
</script>

<template>
  <div v-if="participants?.length" class="flex shrink-0 flex-wrap items-center gap-2 py-1 text-xs text-muted-foreground" role="status" title="约每 10 秒更新；停止输入后会自动切换为查看状态">
    <Users class="h-3.5 w-3.5" />
    <span v-for="(member, index) in participants" :key="`${member.userId}:${index}`" class="rounded-md bg-muted/40 px-2 py-1">
      {{ member.displayName }} · {{ member.locations.length ? `正在编辑 ${member.locations.join('、')}` : '正在查看' }}
    </span>
  </div>
</template>
