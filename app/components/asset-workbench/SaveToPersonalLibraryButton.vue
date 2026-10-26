<script setup lang="ts">
import { Bookmark, Loader2 } from 'lucide-vue-next'
import { computed, inject } from 'vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { personalLibraryFavoriteKeys } from '~/lib/personal-library-assets'

const props = defineProps<{ available: boolean, busy?: boolean, saving?: boolean, assetKey: string, iconOnly?: boolean }>()
const favoriteKeys = inject(personalLibraryFavoriteKeys, computed(() => new Set<string>()))
const favorite = computed(() => favoriteKeys.value.has(props.assetKey))
const hint = computed(() => favorite.value
  ? '当前资产已收藏到个人资源库'
  : props.available ? '将当前资产收藏到个人资源库，供其他项目复用' : '生成或上传素材后即可收藏')
const label = computed(() => props.saving ? '收藏中…' : favorite.value ? '已收藏' : '收藏到个人库')
defineEmits<{ save: [] }>()
</script>

<template>
  <Tooltip v-if="iconOnly">
    <TooltipTrigger as-child>
      <span class="inline-flex">
        <Button
          data-library-save
          type="button"
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          :class="favorite ? 'text-success disabled:opacity-100' : 'text-muted-foreground hover:text-foreground'"
          :disabled="!available || busy || favorite"
          :aria-busy="saving || undefined"
          :aria-label="label"
          @click="$emit('save')"
        >
          <Loader2 v-if="saving" class="h-3.5 w-3.5 animate-spin" />
          <Bookmark v-else class="h-3.5 w-3.5" :class="favorite ? 'fill-current' : ''" />
        </Button>
      </span>
    </TooltipTrigger>
    <TooltipContent>{{ favorite ? '已收藏到个人库' : available ? '收藏到个人库' : hint }}</TooltipContent>
  </Tooltip>
  <Button
    v-else
    data-library-save
    type="button"
    size="sm"
    variant="ghost"
    class="h-7 gap-1 px-2 text-xs"
    :class="favorite ? 'bg-success/10 text-success disabled:opacity-100' : 'text-muted-foreground hover:text-foreground'"
    :disabled="!available || busy || favorite"
    :aria-busy="saving || undefined"
    :title="hint"
    @click="$emit('save')"
  >
    <Loader2 v-if="saving" class="h-3 w-3 animate-spin" />
    <Bookmark v-else class="h-3 w-3" :class="favorite ? 'fill-current' : ''" />
    {{ label }}
  </Button>
</template>
