<script setup lang="ts">
import { computed } from 'vue'
import SettingsGeneralSection from '@/components/settings/SettingsGeneralSection.vue'
import SettingsWorkflowModelsSection from '@/components/settings/SettingsWorkflowModelsSection.vue'
import SettingsModelTestSection from '@/components/settings/SettingsModelTestSection.vue'
import SettingsPromptSection from '@/components/settings/SettingsPromptSection.vue'
import SettingsStyleSection from '@/components/settings/SettingsStyleSection.vue'
import {
  SETTINGS_MODEL_TEST_TABS,
  type ModelTestTab
} from '@/lib/settings-models'
import {
  WORKFLOW_CATEGORY_CONFIG,
  WORKFLOW_CATEGORY_ORDER,
  type WorkflowCategoryKey
} from '@/composables/useSettingsWorkflowModels'
import {
  PROMPT_STAGE_CONFIG,
  type PromptStageMeta
} from '@/composables/useSettingsPrompts'
import {
  PROMPT_FLOW_STAGES,
  type PromptFlowStage
} from '#shared/types/prompt-template'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

type MenuSection = 'general' | 'workflow' | 'test' | 'prompts' | 'styles'

definePageMeta({ layout: 'default' })

const route = useRoute()
const SETTINGS_MENU_STORAGE_KEY = 'playlet:settings-menu-state'
const DEFAULT_SETTINGS_SECTION: MenuSection = 'general'
const SETTINGS_SECTIONS: MenuSection[] = ['general', 'workflow', 'test', 'prompts', 'styles']

// 旧版菜单状态（section=models + sub=...）到扁平 section 的映射
const LEGACY_SUB_TO_SECTION: Record<string, MenuSection> = {
  providers: 'general',
  workflow: 'workflow',
  test: 'test',
  storage: 'general'
}

const activeSection = ref<MenuSection>(DEFAULT_SETTINGS_SECTION)
const restoringMenuState = ref(true)
const activeWorkflowCategory = useState<WorkflowCategoryKey>('settings:workflow-category', () => 'text')
const activeModelTestTab = useState<ModelTestTab>('settings:model-test-tab', () => 'text')
const activePromptStage = useState<PromptFlowStage>('settings:prompt-stage', () => 'parse')

const workflowCategoryTabs = WORKFLOW_CATEGORY_ORDER.map(key => ({
  key,
  ...WORKFLOW_CATEGORY_CONFIG[key]
}))

const promptStageTabs: Array<PromptStageMeta & { key: PromptFlowStage }> = PROMPT_FLOW_STAGES.map(key => ({
  key,
  ...PROMPT_STAGE_CONFIG[key]
}))

function getSingleQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function normalizeMenuSection(rawSection: unknown, rawSub?: unknown): MenuSection {
  if (typeof rawSection === 'string') {
    if (SETTINGS_SECTIONS.includes(rawSection as MenuSection)) {
      return rawSection as MenuSection
    }
    // 兼容旧版：section=models 时由 sub 决定具体分区
    if (rawSection === 'models') {
      const sub = typeof rawSub === 'string' ? rawSub : ''
      return LEGACY_SUB_TO_SECTION[sub] || DEFAULT_SETTINGS_SECTION
    }
  }
  return DEFAULT_SETTINGS_SECTION
}

function saveSection(section: MenuSection) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(SETTINGS_MENU_STORAGE_KEY, JSON.stringify({ section }))
  } catch {
    // ignore localStorage write failures
  }
}

function switchWorkflowCategory(category: WorkflowCategoryKey) {
  activeWorkflowCategory.value = category
}

function switchModelTestTab(tab: ModelTestTab) {
  activeModelTestTab.value = tab
}

function switchPromptStage(stage: PromptFlowStage) {
  activePromptStage.value = stage
}

function getSectionFromRoute(): MenuSection | null {
  const sectionQuery = getSingleQueryValue(route.query.section as string | string[] | undefined)
  if (!sectionQuery) return null
  return normalizeMenuSection(
    sectionQuery,
    getSingleQueryValue(route.query.sub as string | string[] | undefined)
  )
}

async function restoreMenuStateFromBrowser() {
  const routeSection = getSectionFromRoute()
  if (routeSection) {
    activeSection.value = routeSection
    saveSection(routeSection)

    // 旧链接（section=models&sub=... 或带多余 sub）规整为扁平 section
    const rawSection = getSingleQueryValue(route.query.section as string | string[] | undefined)
    if (rawSection !== routeSection || route.query.sub !== undefined) {
      await navigateTo({ path: '/settings', query: { section: routeSection } }, { replace: true })
    }
    return
  }

  activeSection.value = DEFAULT_SETTINGS_SECTION
  saveSection(DEFAULT_SETTINGS_SECTION)
  await navigateTo({ path: '/settings', query: { section: DEFAULT_SETTINGS_SECTION } }, { replace: true })
}

const currentSectionComponent = computed(() => {
  switch (activeSection.value) {
    case 'general': return SettingsGeneralSection
    case 'workflow': return SettingsWorkflowModelsSection
    case 'test': return SettingsModelTestSection
    case 'prompts': return SettingsPromptSection
    case 'styles': return SettingsStyleSection
    default: return SettingsGeneralSection
  }
})

watch(() => [route.query.section, route.query.sub], () => {
  if (restoringMenuState.value) return

  const section = getSectionFromRoute() || DEFAULT_SETTINGS_SECTION
  activeSection.value = section
  saveSection(section)
})

onMounted(() => {
  void (async () => {
    await restoreMenuStateFromBrowser()
    restoringMenuState.value = false
  })()
})
</script>

<template>
  <AppPage>
    <AppPageHeader
      title="设置"
      description="配置模型、提示词、画风和应用偏好"
      class="h-16"
    >
      <template #actions>
        <div
          v-if="activeSection === 'workflow'"
          class="flex rounded-md border bg-muted/30 p-1"
        >
          <button
            v-for="tab in workflowCategoryTabs"
            :key="tab.key"
            type="button"
            class="inline-flex items-center rounded-sm px-3 py-1.5 text-sm transition-colors"
            :class="activeWorkflowCategory === tab.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            @click="switchWorkflowCategory(tab.key)"
          >
            <component
              :is="tab.icon"
              class="mr-2 h-4 w-4"
            />
            {{ tab.name }}
          </button>
        </div>
        <div
          v-else-if="activeSection === 'test'"
          class="flex rounded-md border bg-muted/30 p-1"
        >
          <button
            v-for="tab in SETTINGS_MODEL_TEST_TABS"
            :key="tab.key"
            type="button"
            class="inline-flex items-center rounded-sm px-3 py-1.5 text-sm transition-colors"
            :class="activeModelTestTab === tab.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            @click="switchModelTestTab(tab.key)"
          >
            <component
              :is="tab.icon"
              class="mr-2 h-4 w-4"
            />
            {{ tab.label }}
          </button>
        </div>
        <div
          v-else-if="activeSection === 'prompts'"
          class="flex rounded-md border bg-muted/30 p-1"
        >
          <button
            v-for="tab in promptStageTabs"
            :key="tab.key"
            type="button"
            class="inline-flex items-center rounded-sm px-3 py-1.5 text-sm transition-colors"
            :class="activePromptStage === tab.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            @click="switchPromptStage(tab.key)"
          >
            <component
              :is="tab.icon"
              class="mr-2 h-4 w-4"
            />
            {{ tab.name }}
          </button>
        </div>
      </template>
    </AppPageHeader>

    <AppPageContent
      :padded="false"
      class="overflow-hidden"
      inner-class="h-full min-h-0"
    >
      <KeepAlive>
        <component
          :is="currentSectionComponent"
          class="h-full"
        />
      </KeepAlive>
    </AppPageContent>
  </AppPage>
</template>
