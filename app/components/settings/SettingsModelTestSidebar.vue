<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  ExternalLink
} from 'lucide-vue-next'
import {
  getModelDocUrl,
  getModelMaxDuration,
  getSettingsProviderColor,
  modelSupportsReferenceImage,
  modelSupportsThinking,
  type ModelTestTab,
  type ProviderGroup
} from '@/lib/settings-models'

const props = defineProps<{
  groupedModels: ProviderGroup[]
  activeTab: ModelTestTab
  currentSelectedModel: string
}>()

const emit = defineEmits<{
  (e: 'select-model', payload: { type: ModelTestTab, modelId: string }): void
  (e: 'toggle-provider', provider: string): void
}>()

const PROVIDER_DOT_CLASS: Record<string, string> = {
  blue: 'bg-blue-500',
  orange: 'bg-orange-500',
  cyan: 'bg-cyan-500',
  green: 'bg-green-500',
  purple: 'bg-purple-500',
  red: 'bg-red-500',
  gray: 'bg-gray-500'
}

function getProviderDotClass(provider: string): string {
  return PROVIDER_DOT_CLASS[getSettingsProviderColor(provider)] || 'bg-gray-500'
}
</script>

<template>
  <div class="flex w-72 flex-shrink-0 flex-col border-r bg-muted/30">
    <div class="flex-1 overflow-y-auto py-1">
      <div
        v-for="group in props.groupedModels"
        :key="group.provider"
        class="select-none"
      >
        <div
          class="flex cursor-pointer items-center gap-1 px-2 py-1.5 transition-colors hover:bg-accent/50"
          @click="emit('toggle-provider', group.provider)"
        >
          <component
            :is="group.expanded ? ChevronDown : ChevronRight"
            class="h-4 w-4 flex-shrink-0 text-muted-foreground"
          />
          <div
            class="h-2 w-2 flex-shrink-0 rounded-full"
            :class="getProviderDotClass(group.provider)"
          />
          <span class="flex-1 truncate text-sm font-medium">{{ group.displayName }}</span>
          <span class="text-xs text-muted-foreground">{{ group.models.length }}</span>
        </div>

        <div
          v-show="group.expanded"
          class="pb-1"
        >
          <div
            v-for="model in group.models"
            :key="model.model"
            class="flex cursor-pointer items-start gap-2 py-1.5 pl-7 pr-2 transition-colors"
            :class="model.model === props.currentSelectedModel ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50'"
            @click="emit('select-model', { type: props.activeTab, modelId: model.model })"
          >
            <div
              class="mt-1 flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full border-2"
              :class="model.model === props.currentSelectedModel ? 'border-primary' : 'border-muted-foreground/40'"
            >
              <div
                v-if="model.model === props.currentSelectedModel"
                class="h-1.5 w-1.5 rounded-full bg-primary"
              />
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1">
                <span class="truncate text-sm">{{ model.displayName }}</span>
                <a
                  v-if="getModelDocUrl(model)"
                  :href="getModelDocUrl(model)"
                  class="text-muted-foreground hover:text-primary"
                  target="_blank"
                  @click.stop
                >
                  <ExternalLink class="h-3 w-3" />
                </a>
              </div>

              <div class="mt-0.5 flex flex-wrap gap-1">
                <span
                  v-if="modelSupportsThinking(model)"
                  class="rounded bg-purple-100 px-1 py-0.5 text-[9px] text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                >思考</span>
                <span
                  v-if="modelSupportsReferenceImage(model)"
                  class="rounded bg-cyan-100 px-1 py-0.5 text-[9px] text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300"
                >参考图</span>
                <span
                  v-if="getModelMaxDuration(model)"
                  class="rounded bg-gray-100 px-1 py-0.5 text-[9px] text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                >{{ getModelMaxDuration(model) }}s</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
