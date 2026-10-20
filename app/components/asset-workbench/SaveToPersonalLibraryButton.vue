<script setup lang="ts">
import { Bookmark, Loader2 } from 'lucide-vue-next'
import { computed, inject } from 'vue'
import { personalLibraryFavoriteKeys } from '~/lib/personal-library-assets'

const props = defineProps<{ available: boolean, busy?: boolean, saving?: boolean, assetKey: string }>()
const favoriteKeys = inject(personalLibraryFavoriteKeys, computed(() => new Set<string>()))
const favorite = computed(() => favoriteKeys.value.has(props.assetKey))
defineEmits<{ save: [] }>()
</script>

<template>
  <Button
    data-library-save
    type="button"
    size="sm"
    variant="ghost"
    class="h-7 gap-1 px-2 text-xs"
    :class="favorite ? 'bg-emerald-500/10 text-emerald-700 disabled:opacity-100 dark:text-emerald-400' : 'text-muted-foreground hover:text-foreground'"
    :disabled="!available || busy || favorite"
    :aria-busy="saving || undefined"
    :title="favorite ? '当前资产已收藏到个人资源库' : available ? '将当前资产收藏到个人资源库，供其他项目复用' : '生成或上传素材后即可收藏'"
    @click="$emit('save')"
  >
    <Loader2 v-if="saving" class="h-3 w-3 animate-spin" />
    <Bookmark v-else class="h-3 w-3" :class="favorite ? 'fill-current' : ''" />
    {{ saving ? '收藏中…' : favorite ? '已收藏' : '收藏到个人库' }}
  </Button>
</template>
