<script setup lang="ts">
import { BookmarkPlus, Loader2 } from 'lucide-vue-next'

defineProps<{ available: boolean, busy?: boolean, saving?: boolean }>()
defineEmits<{ save: [] }>()
</script>

<template>
  <Button
    data-library-save
    type="button"
    size="sm"
    variant="ghost"
    class="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
    :disabled="!available || busy"
    :aria-busy="saving || undefined"
    :title="available ? '将当前资产收藏到个人资源库，供其他项目复用' : '生成或上传素材后即可收藏'"
    @click="$emit('save')"
  >
    <Loader2 v-if="saving" class="h-3 w-3 animate-spin" />
    <BookmarkPlus v-else class="h-3 w-3" />
    {{ saving ? '收藏中…' : '收藏到个人库' }}
  </Button>
</template>
