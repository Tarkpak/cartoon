import type { Component } from 'vue'
import {
  Boxes,
  FileText,
  Video
} from 'lucide-vue-next'
import type {
  PromptCategory,
  PromptFlowStage,
  PromptTemplate,
  PromptTemplateProfile
} from '#shared/types/prompt-template'
import {
  getDirectorPreferencesValidationError,
  normalizeDirectorPreferences
} from '@/lib/director-preferences'
import {
  getPromptTemplateMetadataForWorkflow,
  isPromptReadonlyProfile,
  PROMPT_FLOW_STAGES,
  PROMPT_FLOW_STAGE_LABELS
} from '#shared/types/prompt-template'

interface PromptTemplatesResponse {
  success: boolean
  data?: {
    templates: PromptTemplate[]
    directorPreferences?: string
    directorPreferencesCustomized?: boolean
    profiles?: PromptTemplateProfile[]
    activeProfileId?: string
  }
}

interface PromptProfilesResponse {
  success: boolean
  data?: {
    profiles: PromptTemplateProfile[]
    activeProfileId: string
  }
}

const PROMPT_PROFILE_CREATE_TIMEOUT_MS = 10_000

export interface PromptStageMeta {
  name: string
  color: string
  icon: Component
  description: string
}

export interface PromptTemplateGroup extends PromptStageMeta {
  stage: PromptFlowStage
  templates: PromptTemplate[]
  expanded: boolean
}

export const PROMPT_STAGE_CONFIG: Record<PromptFlowStage, PromptStageMeta> = {
  parse: {
    name: PROMPT_FLOW_STAGE_LABELS.parse,
    color: 'blue',
    icon: FileText,
    description: '分集规划、剧本解析与系统补充模板。'
  },
  assets: {
    name: PROMPT_FLOW_STAGE_LABELS.assets,
    color: 'green',
    icon: Boxes,
    description: '角色/环境/道具素材生成与场景改写模板。'
  },
  videos: {
    name: PROMPT_FLOW_STAGE_LABELS.videos,
    color: 'purple',
    icon: Video,
    description: '分镜视频生成模板。'
  }
}

export function useSettingsPrompts() {
  const promptsLoading = ref(false)
  const promptProfilesLoading = ref(false)
  const promptProfileMutating = ref(false)

  const promptTemplates = ref<PromptTemplate[]>([])
  const directorPreferences = ref('')
  const directorPreferencesCustomized = ref(false)
  const directorPreferencesSaving = ref(false)
  const directorPreferencesError = ref('')
  const promptProfiles = ref<PromptTemplateProfile[]>([])
  const activePromptProfileId = ref<string>('')

  const selectedPromptId = ref<string | null>(null)
  const selectedPromptTemplate = ref<PromptTemplate | null>(null)
  const activePromptStage = useState<PromptFlowStage>('settings:prompt-stage', () => 'parse')
  const expandedPromptStages = ref<Set<PromptFlowStage>>(new Set(PROMPT_FLOW_STAGES))

  const groupedPrompts = computed(() => {
    const workflowMetadata = getPromptTemplateMetadataForWorkflow()
    const groups: Partial<Record<PromptFlowStage, typeof workflowMetadata>> = {}

    for (const meta of workflowMetadata) {
      if (!groups[meta.stage]) {
        groups[meta.stage] = []
      }
      groups[meta.stage]!.push(meta)
    }

    return groups
  })

  const groupedPromptTemplates = computed<PromptTemplateGroup[]>(() => {
    const templateMap = new Map(promptTemplates.value.map(template => [template.id, template]))

    return PROMPT_FLOW_STAGES
      .map((stage) => {
        const metadataList = groupedPrompts.value[stage] || []
        const templates = metadataList
          .map(meta => templateMap.get(meta.id))
          .filter((template): template is PromptTemplate => Boolean(template))

        return {
          stage,
          ...PROMPT_STAGE_CONFIG[stage],
          templates,
          expanded: expandedPromptStages.value.has(stage)
        }
      })
      .filter(group => group.templates.length > 0)
  })

  const activePromptStageGroup = computed(() => {
    return groupedPromptTemplates.value.find(group => group.stage === activePromptStage.value) || null
  })

  const activePromptStageTemplates = computed(() => {
    return activePromptStageGroup.value?.templates || []
  })

  const selectedPromptCategory = computed<PromptCategory | null>(() => {
    return selectedPromptTemplate.value?.category || null
  })

  const activePromptProfile = computed<PromptTemplateProfile | null>(() => {
    if (!activePromptProfileId.value) return null
    return promptProfiles.value.find(profile => profile.id === activePromptProfileId.value) || null
  })

  const isActiveReadonlyPromptProfile = computed(() => {
    return isPromptReadonlyProfile(activePromptProfileId.value)
  })

  const canRenameActivePromptProfile = computed(() => {
    return Boolean(activePromptProfile.value) && !isActiveReadonlyPromptProfile.value
  })

  const canDeleteActivePromptProfile = computed(() => {
    return promptProfiles.value.length > 1
      && Boolean(activePromptProfile.value)
      && !isActiveReadonlyPromptProfile.value
  })

  const promptProfileBusy = computed(() => {
    return promptProfilesLoading.value || promptProfileMutating.value
  })

  function expandPromptStage(stage: PromptFlowStage) {
    expandedPromptStages.value.add(stage)
  }

  function syncSelectedPrompt(templates: PromptTemplate[]) {
    const selectableIds = new Set(templates.map(item => item.id))

    if (selectedPromptId.value && selectableIds.has(selectedPromptId.value)) {
      selectedPromptTemplate.value = templates.find(template => template.id === selectedPromptId.value) || null
    } else {
      selectedPromptTemplate.value = null
    }

    if (!selectedPromptTemplate.value && templates.length > 0) {
      const firstTemplate = templates[0]!
      selectedPromptId.value = firstTemplate.id
      selectedPromptTemplate.value = firstTemplate
    }

    if (!selectedPromptTemplate.value) return

    const selectedMeta = getPromptTemplateMetadataForWorkflow()
      .find(item => item.id === selectedPromptTemplate.value?.id)
    if (selectedMeta) {
      activePromptStage.value = selectedMeta.stage
      expandPromptStage(selectedMeta.stage)
    }
  }

  function syncPromptProfiles(profiles: PromptTemplateProfile[], activeId: string) {
    promptProfiles.value = profiles

    if (profiles.length === 0) {
      activePromptProfileId.value = ''
      return
    }

    if (profiles.some(profile => profile.id === activeId)) {
      activePromptProfileId.value = activeId
      return
    }

    activePromptProfileId.value = profiles[0]!.id
  }

  async function loadPromptTemplates() {
    promptsLoading.value = true

    try {
      const response = await $fetch<PromptTemplatesResponse>('/api/prompts')

      if (!response.success || !response.data?.templates) return

      promptTemplates.value = response.data.templates
      directorPreferences.value = response.data.directorPreferences || ''
      directorPreferencesCustomized.value = response.data.directorPreferencesCustomized === true
      syncSelectedPrompt(response.data.templates)

      if (response.data.profiles && response.data.activeProfileId) {
        syncPromptProfiles(response.data.profiles, response.data.activeProfileId)
      }
    } catch (error) {
      console.error('[useSettingsPrompts] 加载提示词模板失败:', error)
    } finally {
      promptsLoading.value = false
    }
  }

  async function loadPromptProfiles() {
    promptProfilesLoading.value = true

    try {
      const response = await $fetch<PromptProfilesResponse>('/api/prompts/profiles')

      if (!response.success || !response.data) return
      syncPromptProfiles(response.data.profiles, response.data.activeProfileId)
    } catch (error) {
      console.error('[useSettingsPrompts] 加载提示词配置方案失败:', error)
    } finally {
      promptProfilesLoading.value = false
    }
  }

  function selectPrompt(id: string) {
    selectedPromptId.value = id
    selectedPromptTemplate.value = promptTemplates.value.find(template => template.id === id) || null
    if (!selectedPromptTemplate.value) return

    const selectedMeta = getPromptTemplateMetadataForWorkflow()
      .find(item => item.id === selectedPromptTemplate.value?.id)
    if (selectedMeta) {
      activePromptStage.value = selectedMeta.stage
      expandPromptStage(selectedMeta.stage)
    }
  }

  function selectPromptStage(stage: PromptFlowStage) {
    activePromptStage.value = stage
    expandPromptStage(stage)
    const currentStageTemplates = activePromptStageTemplates.value
    if (
      currentStageTemplates.length > 0
      && !currentStageTemplates.some(template => template.id === selectedPromptId.value)
    ) {
      selectPrompt(currentStageTemplates[0]!.id)
    }
  }

  function togglePromptStage(stage: PromptFlowStage) {
    if (expandedPromptStages.value.has(stage)) {
      expandedPromptStages.value.delete(stage)
      return
    }

    expandedPromptStages.value.add(stage)
  }

  async function activatePromptProfile(profileId: string): Promise<boolean> {
    if (!profileId || profileId === activePromptProfileId.value) return true

    promptProfileMutating.value = true

    try {
      const response = await $fetch<PromptProfilesResponse>(`/api/prompts/profiles/${profileId}/activate`, {
        method: 'POST'
      })

      if (response.success && response.data) {
        syncPromptProfiles(response.data.profiles, response.data.activeProfileId)
      }

      await loadPromptTemplates()
      return true
    } catch (error) {
      console.error('[useSettingsPrompts] 切换提示词配置方案失败:', error)
      return false
    } finally {
      promptProfileMutating.value = false
    }
  }

  async function createPromptProfile(name: string, description = '', activate = true): Promise<boolean> {
    const normalizedName = name.trim()
    if (!normalizedName) return false

    promptProfileMutating.value = true

    try {
      const response = await $fetch<PromptProfilesResponse>('/api/prompts/profiles', {
        method: 'POST',
        timeout: PROMPT_PROFILE_CREATE_TIMEOUT_MS,
        body: {
          name: normalizedName,
          description: description.trim() || undefined,
          activate
        }
      })

      if (response.success && response.data) {
        syncPromptProfiles(response.data.profiles, response.data.activeProfileId)
      }

      if (activate) {
        await loadPromptTemplates()
      }

      return true
    } catch (error) {
      console.error('[useSettingsPrompts] 创建提示词配置方案失败:', error)
      return false
    } finally {
      promptProfileMutating.value = false
    }
  }

  async function updatePromptProfileName(profileId: string, name: string, description?: string): Promise<boolean> {
    const normalizedName = name.trim()
    if (!profileId || !normalizedName) return false
    if (isPromptReadonlyProfile(profileId)) return false

    promptProfileMutating.value = true

    try {
      const response = await $fetch<PromptProfilesResponse>(`/api/prompts/profiles/${profileId}`, {
        method: 'PUT',
        body: {
          name: normalizedName,
          description: description?.trim() || undefined
        }
      })

      if (response.success && response.data) {
        syncPromptProfiles(response.data.profiles, response.data.activeProfileId)
      }

      return true
    } catch (error) {
      console.error('[useSettingsPrompts] 更新提示词配置方案失败:', error)
      return false
    } finally {
      promptProfileMutating.value = false
    }
  }

  async function deletePromptProfile(profileId: string): Promise<boolean> {
    if (!profileId) return false
    if (isPromptReadonlyProfile(profileId)) return false

    promptProfileMutating.value = true

    try {
      const response = await $fetch<PromptProfilesResponse>(`/api/prompts/profiles/${profileId}`, {
        method: 'DELETE'
      })

      if (response.success && response.data) {
        syncPromptProfiles(response.data.profiles, response.data.activeProfileId)
      }

      await loadPromptTemplates()
      return true
    } catch (error) {
      console.error('[useSettingsPrompts] 删除提示词配置方案失败:', error)
      return false
    } finally {
      promptProfileMutating.value = false
    }
  }

  async function saveDirectorPreferences(content: string): Promise<boolean> {
    if (isActiveReadonlyPromptProfile.value) return false
    const validationError = getDirectorPreferencesValidationError(content)
    if (validationError) {
      directorPreferencesError.value = validationError
      return false
    }

    directorPreferencesSaving.value = true
    directorPreferencesError.value = ''

    try {
      const response = await $fetch<{
        success: boolean
        data: { content: string, isCustomized: boolean }
      }>('/api/prompts/director-preferences', {
        method: 'PUT',
        body: { content }
      })

      if (!response.success) {
        directorPreferencesError.value = '保存分镜提示词失败'
        return false
      }

      directorPreferences.value = normalizeDirectorPreferences(response.data.content)
      directorPreferencesCustomized.value = response.data.isCustomized
      return true
    } catch (error) {
      console.error('[useSettingsPrompts] 保存分镜提示词失败:', error)
      directorPreferencesError.value = error instanceof Error
        ? error.message
        : '保存分镜提示词失败'
      return false
    } finally {
      directorPreferencesSaving.value = false
    }
  }

  function toSelectString(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  function handlePromptUpdate(template: PromptTemplate) {
    const index = promptTemplates.value.findIndex(item => item.id === template.id)
    if (index !== -1) {
      promptTemplates.value[index] = template
    }

    selectedPromptTemplate.value = template
  }

  function handlePromptSaved() {
  }

  watch(activePromptStage, (stage) => {
    const currentStageTemplates = activePromptStageTemplates.value
    if (currentStageTemplates.length === 0) return
    if (currentStageTemplates.some(template => template.id === selectedPromptId.value)) return
    selectPrompt(currentStageTemplates[0]!.id)
  })

  onMounted(() => {
    if (promptTemplates.value.length > 0) return
    void Promise.all([
      loadPromptProfiles(),
      loadPromptTemplates()
    ])
  })

  return {
    promptsLoading,
    promptProfilesLoading,
    promptProfileMutating,
    promptProfileBusy,
    promptTemplates,
    directorPreferences,
    directorPreferencesCustomized,
    directorPreferencesSaving,
    directorPreferencesError,
    promptProfiles,
    activePromptProfileId,
    activePromptProfile,
    isActiveReadonlyPromptProfile,
    canRenameActivePromptProfile,
    canDeleteActivePromptProfile,
    selectedPromptId,
    selectedPromptTemplate,
    selectedPromptCategory,
    activePromptStage,
    activePromptStageGroup,
    activePromptStageTemplates,
    expandedPromptStages,
    groupedPromptTemplates,
    selectPrompt,
    selectPromptStage,
    togglePromptStage,
    activatePromptProfile,
    createPromptProfile,
    updatePromptProfileName,
    deletePromptProfile,
    saveDirectorPreferences,
    toSelectString,
    handlePromptUpdate,
    handlePromptSaved,
    loadPromptTemplates,
    loadPromptProfiles
  }
}
