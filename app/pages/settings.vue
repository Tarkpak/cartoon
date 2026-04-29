<script setup lang="ts">
import { computed } from 'vue'
import SettingsModelTestSection from '@/components/settings/SettingsModelTestSection.vue'
import SettingsModelProvidersSection from '@/components/settings/SettingsModelProvidersSection.vue'
import SettingsPromptSection from '@/components/settings/SettingsPromptSection.vue'
import SettingsStyleSection from '@/components/settings/SettingsStyleSection.vue'
import SettingsWorkflowModelsSection from '@/components/settings/SettingsWorkflowModelsSection.vue'

type MenuSection = 'models' | 'prompts' | 'styles'
type ModelSubMenu = 'providers' | 'workflow' | 'test'
interface SettingsMenuState {
  section: MenuSection
  sub: ModelSubMenu
}

definePageMeta({ layout: 'default' })

const route = useRoute()
const SETTINGS_MENU_STORAGE_KEY = 'manju:settings-menu-state'

const activeSection = ref<MenuSection>('models')
const activeModelSubMenu = ref<ModelSubMenu>('providers')
const restoringMenuState = ref(true)

function normalizeMenuSection(value: unknown): MenuSection {
  if (value === 'prompts' || value === 'styles' || value === 'models') return value
  return 'models'
}

function normalizeModelSubMenu(value: unknown): ModelSubMenu {
  if (value === 'providers' || value === 'workflow' || value === 'test') return value
  return 'providers'
}

function getSingleQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function resolveSubMenuBySection(section: MenuSection, value: unknown): ModelSubMenu {
  if (section !== 'models') return 'providers'
  return normalizeModelSubMenu(value)
}

function buildSettingsMenuQuery(state: SettingsMenuState) {
  if (state.section === 'models') {
    return {
      section: state.section,
      sub: state.sub
    }
  }

  return {
    section: state.section
  }
}

function readStoredMenuState(): SettingsMenuState | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(SETTINGS_MENU_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<SettingsMenuState>
    const section = normalizeMenuSection(parsed.section)
    const sub = resolveSubMenuBySection(section, parsed.sub)
    return {
      section,
      sub
    }
  } catch {
    return null
  }
}

function saveMenuState(state: SettingsMenuState) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(SETTINGS_MENU_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore localStorage write failures
  }
}

function getMenuStateFromRoute(): SettingsMenuState | null {
  const sectionQuery = getSingleQueryValue(route.query.section as string | string[] | undefined)
  if (!sectionQuery) return null

  const section = normalizeMenuSection(sectionQuery)
  const sub = resolveSubMenuBySection(
    section,
    getSingleQueryValue(route.query.sub as string | string[] | undefined)
  )

  return {
    section,
    sub
  }
}

function applyMenuState(state: SettingsMenuState) {
  activeSection.value = state.section
  activeModelSubMenu.value = state.sub
}

async function restoreMenuStateFromBrowser() {
  const routeState = getMenuStateFromRoute()
  if (routeState) {
    applyMenuState(routeState)
    saveMenuState(routeState)
    return
  }

  const storedState = readStoredMenuState()
  if (storedState) {
    applyMenuState(storedState)
    await navigateTo({
      path: '/settings',
      query: buildSettingsMenuQuery(storedState)
    }, { replace: true })
    return
  }

  const defaultState: SettingsMenuState = {
    section: 'models',
    sub: 'providers'
  }
  applyMenuState(defaultState)
  saveMenuState(defaultState)
}

const currentSectionComponent = computed(() => {
  if (activeSection.value === 'models') {
    if (activeModelSubMenu.value === 'providers') return SettingsModelProvidersSection
    if (activeModelSubMenu.value === 'test') return SettingsModelTestSection
    return SettingsWorkflowModelsSection
  }

  if (activeSection.value === 'styles') {
    return SettingsStyleSection
  }

  return SettingsPromptSection
})

watch(() => [route.query.section, route.query.sub], () => {
  if (restoringMenuState.value) return

  const routeState = getMenuStateFromRoute()
  const nextState = routeState || {
    section: 'models' as const,
    sub: 'providers' as const
  }
  applyMenuState(nextState)
  saveMenuState(nextState)
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
      <div
        v-if="activeSection === 'models'"
        class="flex shrink-0 items-center gap-2 border-b px-4 py-2"
      >
        <Button
          variant="ghost"
          size="sm"
          :class="activeModelSubMenu === 'providers' ? 'bg-accent text-foreground' : 'text-muted-foreground'"
          @click="navigateTo({ path: '/settings', query: { section: 'models', sub: 'providers' } })"
        >
          模型供应商
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :class="activeModelSubMenu === 'workflow' ? 'bg-accent text-foreground' : 'text-muted-foreground'"
          @click="navigateTo({ path: '/settings', query: { section: 'models', sub: 'workflow' } })"
        >
          流程模型
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :class="activeModelSubMenu === 'test' ? 'bg-accent text-foreground' : 'text-muted-foreground'"
          @click="navigateTo({ path: '/settings', query: { section: 'models', sub: 'test' } })"
        >
          模型测试
        </Button>
      </div>
      <KeepAlive>
        <component
          :is="currentSectionComponent"
          class="h-full"
        />
      </KeepAlive>
    </div>
  </div>
</template>
