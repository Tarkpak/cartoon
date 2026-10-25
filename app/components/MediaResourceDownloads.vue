<script setup lang="ts">
import { Download } from 'lucide-vue-next'
import { mediaResourceDownloads } from '@/lib/media-parser-resources'
import type { MediaResourceDownload, MediaResources } from '@/lib/media-parser-resources'

const props = defineProps<{ profile: MediaResources, disabled?: boolean }>()
const emit = defineEmits<{ download: [resource: MediaResourceDownload] }>()
const resources = computed(() => mediaResourceDownloads(props.profile))
</script>

<template>
  <div v-if="resources.length" class="space-y-2 border-t border-border/70 pt-4">
    <p class="text-sm font-medium">更多素材</p>
    <div class="flex flex-wrap gap-2">
      <Button
        v-for="resource in resources"
        :key="`${resource.kind}-${resource.index ?? 'all'}`"
        type="button"
        variant="outline"
        size="sm"
        class="gap-1.5"
        :disabled="disabled"
        :aria-label="`下载${resource.label}`"
        @click="emit('download', resource)"
      >
        <Download class="h-3.5 w-3.5" />
        {{ resource.label }}
      </Button>
    </div>
  </div>
</template>
