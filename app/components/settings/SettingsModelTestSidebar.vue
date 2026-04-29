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
  SETTINGS_MODEL_TEST_TABS,
  type ModelTestTab,
  type ProviderGroup
} from '@/lib/settings-models'

const activeTab = defineModel<ModelTestTab>('activeTab', { required: true })

const props = defineProps<{
  groupedModels: ProviderGroup[]
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
  <div class="flex w-64 shrink-0 flex-col border-r bg-muted/20">
    <!-- Type tabs -->
    <div class="border-b px-2 py-2">
      <div class="grid grid-cols-2 gap-1">
        <Button
          v-for="tab in SETTINGS_MODEL_TEST_TABS"
          :key="tab.key"
          type="button"
          variant="ghost"
          class="h-auto gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
          :class="activeTab === tab.key
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
          @click="activeTab = tab.key"
        >
          <component
            :is="tab.icon"
            class="h-3.5 w-3.5"
          />
          <span>{{ tab.label }}</span>
        </Button>
      </div>
    </div>

    <!-- Models header -->
    <div class="px-3 py-2">
      <h3 class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
        可用模型
      </h3>
    </div>

    <!-- Models list -->
    <div class="flex-1 overflow-y-auto pb-2">
      <div
        v-for="group in props.groupedModels"
        :key="group.provider"
        class="select-none"
      >
        <!-- Provider group header -->
        <div
          class="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 transition-colors hover:bg-accent/50"
          @click="emit('toggle-provider', group.provider)"
        >
          <component
            :is="group.expanded ? ChevronDown : ChevronRight"
            class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
          />
          <div
            class="h-1.5 w-1.5 shrink-0 rounded-full"
            :class="getProviderDotClass(group.provider)"
          />
          <span class="flex-1 truncate text-sm font-medium">{{ group.displayName }}</span>
          <span class="text-[11px] text-muted-foreground/60">{{ group.models.length }}</span>
        </div>

        <!-- Models list -->
        <div
          v-show="group.expanded"
          class="pb-1"
        >
          <div
            v-for="model in group.models"
            :key="model.model"
            class="flex cursor-pointer items-start gap-2 py-1.5 pl-7 pr-3 transition-colors"
            :class="model.model === props.currentSelectedModel
              ? 'bg-primary/8 text-primary'
              : 'hover:bg-accent/40'"
            @click="emit('select-model', { type: activeTab, modelId: model.model })"
          >
            <div
              class="mt-1.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2"
              :class="model.model === props.currentSelectedModel ? 'border-primary' : 'border-muted-foreground/30'"
            >
              <div
                v-if="model.model === props.currentSelectedModel"
                class="h-1.5 w-1.5 rounded-full bg-primary"
              />
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1">
                <span class="truncate text-[13px]">{{ model.displayName }}</span>
                <a
                  v-if="getModelDocUrl(model)"
                  :href="getModelDocUrl(model)"
                  class="shrink-0 text-muted-foreground/50 hover:text-primary"
                  target="_blank"
                  @click.stop
                >
                  <ExternalLink class="h-2.5 w-2.5" />
                </a>
              </div>

              <div
                v-if="modelSupportsThinking(model) || modelSupportsReferenceImage(model) || getModelMaxDuration(model)"
                class="mt-0.5 flex flex-wrap gap-1"
              >
                <span
                  v-if="modelSupportsThinking(model)"
                  class="rounded bg-purple-500/10 px-1 py-0.5 text-[9px] text-purple-600 dark:text-purple-400"
                >思考</span>
                <span
                  v-if="modelSupportsReferenceImage(model)"
                  class="rounded bg-cyan-500/10 px-1 py-0.5 text-[9px] text-cyan-600 dark:text-cyan-400"
                >参考图</span>
                <span
                  v-if="getModelMaxDuration(model)"
                  class="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground"
                >{{ getModelMaxDuration(model) }}s</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
