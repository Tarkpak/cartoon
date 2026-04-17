import type { Component } from 'vue'
import {
  Boxes,
  FileText,
  Video
} from 'lucide-vue-next'
import type {
  PromptCategory,
  PromptFlowStage,
  PromptTemplate
} from '#shared/types/prompt-template'
import {
  getPromptTemplateMetadataForWorkflow,
  PROMPT_FLOW_STAGES,
  PROMPT_FLOW_STAGE_LABELS
} from '#shared/types/prompt-template'
import type { ProjectWorkflowType } from '#shared/types/project'

interface PromptTemplatesResponse {
  success: boolean
  data?: {
    templates: PromptTemplate[]
  }
}

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
    description: '剧本解析与资产规划模板。'
  },
  assets: {
    name: PROMPT_FLOW_STAGE_LABELS.assets,
    color: 'green',
    icon: Boxes,
    description: '角色资产、环境参考图和场景改写模板。'
  },
  videos: {
    name: PROMPT_FLOW_STAGE_LABELS.videos,
    color: 'purple',
    icon: Video,
    description: '场景视频生成模板。'
  }
}

export function useSettingsPrompts() {
  const promptsLoading = ref(false)
  const promptTemplates = ref<PromptTemplate[]>([])
  const selectedPromptId = ref<string | null>(null)
  const selectedPromptTemplate = ref<PromptTemplate | null>(null)
  const selectedPromptWorkflow = ref<ProjectWorkflowType>('asset_consistency')
  const expandedPromptStages = ref<Set<PromptFlowStage>>(new Set(PROMPT_FLOW_STAGES))

  const groupedPrompts = computed(() => {
    const workflowMetadata = getPromptTemplateMetadataForWorkflow(selectedPromptWorkflow.value)
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

  const selectedPromptCategory = computed<PromptCategory | null>(() => {
    return selectedPromptTemplate.value?.category || null
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

    const selectedMeta = getPromptTemplateMetadataForWorkflow(selectedPromptWorkflow.value)
      .find(item => item.id === selectedPromptTemplate.value?.id)
    if (selectedMeta) {
      expandPromptStage(selectedMeta.stage)
    }
  }

  async function loadPromptTemplates() {
    promptsLoading.value = true

    try {
      const response = await $fetch<PromptTemplatesResponse>('/api/prompts', {
        query: { workflow: selectedPromptWorkflow.value }
      })

      if (!response.success || !response.data?.templates) return

      promptTemplates.value = response.data.templates
      syncSelectedPrompt(response.data.templates)
    } catch (error) {
      console.error('[useSettingsPrompts] 加载提示词模板失败:', error)
    } finally {
      promptsLoading.value = false
    }
  }

  function selectPrompt(id: string) {
    selectedPromptId.value = id
    selectedPromptTemplate.value = promptTemplates.value.find(template => template.id === id) || null
    if (!selectedPromptTemplate.value) return

    const selectedMeta = getPromptTemplateMetadataForWorkflow(selectedPromptWorkflow.value)
      .find(item => item.id === selectedPromptTemplate.value?.id)
    if (selectedMeta) {
      expandPromptStage(selectedMeta.stage)
    }
  }

  function togglePromptStage(stage: PromptFlowStage) {
    if (expandedPromptStages.value.has(stage)) {
      expandedPromptStages.value.delete(stage)
      return
    }

    expandedPromptStages.value.add(stage)
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

  watch(selectedPromptWorkflow, () => {
    void loadPromptTemplates()
  })

  onMounted(() => {
    if (promptTemplates.value.length > 0) return
    void loadPromptTemplates()
  })

  return {
    promptsLoading,
    promptTemplates,
    selectedPromptId,
    selectedPromptTemplate,
    selectedPromptCategory,
    selectedPromptWorkflow,
    expandedPromptStages,
    groupedPromptTemplates,
    selectPrompt,
    togglePromptStage,
    toSelectString,
    handlePromptUpdate,
    handlePromptSaved,
    loadPromptTemplates
  }
}
