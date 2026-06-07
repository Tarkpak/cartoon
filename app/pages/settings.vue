<script setup lang="ts">
import { computed } from 'vue'
import SettingsGeneralSection from '@/components/settings/SettingsGeneralSection.vue'
import SettingsModelTestSection from '@/components/settings/SettingsModelTestSection.vue'
import SettingsModelProvidersSection from '@/components/settings/SettingsModelProvidersSection.vue'
import SettingsTosStorageSection from '@/components/settings/SettingsTosStorageSection.vue'
import SettingsPromptSection from '@/components/settings/SettingsPromptSection.vue'
import SettingsStyleSection from '@/components/settings/SettingsStyleSection.vue'
import SettingsWorkflowModelsSection from '@/components/settings/SettingsWorkflowModelsSection.vue'

type MenuSection = 'general' | 'styles' | 'providers' | 'workflow' | 'test' | 'storage' | 'prompts'

definePageMeta({ layout: 'default' })

const route = useRoute()
const SETTINGS_MENU_STORAGE_KEY = 'playlet:settings-menu-state'
const SETTINGS_SECTIONS: MenuSection[] = ['general', 'styles', 'providers', 'workflow', 'test', 'storage', 'prompts']

// 旧版菜单状态（section=models + sub=...）到扁平 section 的映射
const LEGACY_SUB_TO_SECTION: Record<string, MenuSection> = {
  providers: 'providers',
  workflow: 'workflow',
  test: 'test',
  storage: 'storage'
}

const activeSection = ref<MenuSection>('providers')
const restoringMenuState = ref(true)

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
      return LEGACY_SUB_TO_SECTION[sub] || 'providers'
    }
  }
  return 'general'
}

function readStoredSection(): MenuSection | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(SETTINGS_MENU_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as { section?: unknown, sub?: unknown }
    return normalizeMenuSection(parsed.section, parsed.sub)
  } catch {
    return null
  }
}

function saveSection(section: MenuSection) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(SETTINGS_MENU_STORAGE_KEY, JSON.stringify({ section }))
  } catch {
    // ignore localStorage write failures
  }
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

  const storedSection = readStoredSection()
  if (storedSection) {
    activeSection.value = storedSection
    await navigateTo({ path: '/settings', query: { section: storedSection } }, { replace: true })
    return
  }

  activeSection.value = 'providers'
  saveSection('providers')
}

const currentSectionComponent = computed(() => {
  switch (activeSection.value) {
    case 'general': return SettingsGeneralSection
    case 'styles': return SettingsStyleSection
    case 'providers': return SettingsModelProvidersSection
    case 'workflow': return SettingsWorkflowModelsSection
    case 'test': return SettingsModelTestSection
    case 'storage': return SettingsTosStorageSection
    case 'prompts': return SettingsPromptSection
    default: return SettingsModelProvidersSection
  }
})

watch(() => [route.query.section, route.query.sub], () => {
  if (restoringMenuState.value) return

  const section = getSectionFromRoute() || 'providers'
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
