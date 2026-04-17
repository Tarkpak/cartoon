<script setup lang="ts">
import { computed } from 'vue'
import SettingsModelTestSection from '@/components/settings/SettingsModelTestSection.vue'
import SettingsPromptSection from '@/components/settings/SettingsPromptSection.vue'
import SettingsStyleSection from '@/components/settings/SettingsStyleSection.vue'
import SettingsWorkflowModelsSection from '@/components/settings/SettingsWorkflowModelsSection.vue'

type MenuSection = 'models' | 'prompts' | 'styles'
type ModelSubMenu = 'workflow' | 'test'

definePageMeta({ layout: 'default' })

const route = useRoute()

const activeSection = ref<MenuSection>('models')
const activeModelSubMenu = ref<ModelSubMenu>('workflow')

function normalizeMenuSection(value: unknown): MenuSection {
  if (value === 'prompts' || value === 'styles' || value === 'models') return value
  return 'models'
}

function normalizeModelSubMenu(value: unknown): ModelSubMenu {
  return value === 'test' ? 'test' : 'workflow'
}

function applyRouteMenuState() {
  activeSection.value = normalizeMenuSection(route.query.section)
  activeModelSubMenu.value = normalizeModelSubMenu(route.query.sub)
}

const currentSectionComponent = computed(() => {
  if (activeSection.value === 'models') {
    return activeModelSubMenu.value === 'test'
      ? SettingsModelTestSection
      : SettingsWorkflowModelsSection
  }

  if (activeSection.value === 'styles') {
    return SettingsStyleSection
  }

  return SettingsPromptSection
})

watch(() => [route.query.section, route.query.sub], () => {
  applyRouteMenuState()
})

onMounted(() => {
  applyRouteMenuState()
})
</script>

<template>
  <div class="h-full flex overflow-hidden">
    <div class="flex-1 flex flex-col overflow-hidden">
      <KeepAlive>
        <component
          :is="currentSectionComponent"
          class="h-full"
        />
      </KeepAlive>
    </div>
  </div>
</template>
