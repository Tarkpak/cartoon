import type { Component } from 'vue'
import {
  AudioLines,
  Cpu,
  Image,
  Video
} from 'lucide-vue-next'
import type { PromptCategory, PromptTemplate } from '#shared/types/prompt-template'
import { getPromptTemplateMetadataForWorkflow } from '#shared/types/prompt-template'
import type { ProjectWorkflowType } from '#shared/types/project'

interface PromptTemplatesResponse {
  success: boolean
  data?: {
    templates: PromptTemplate[]
  }
}

const PROMPT_CATEGORY_ORDER: PromptCategory[] = ['text', 'image', 'video', 'audio']

export interface PromptCategoryMeta {
  name: string
  color: string
  icon: Component
  description: string
}

export interface PromptTemplateGroup extends PromptCategoryMeta {
  category: PromptCategory
  templates: PromptTemplate[]
  expanded: boolean
}

export const PROMPT_CATEGORY_CONFIG: Record<PromptCategory, PromptCategoryMeta> = {
  text: {
    name: '文本生成',
    color: 'blue',
    icon: Cpu,
    description: '大纲、角色、分镜等文本类模板。'
  },
  image: {
    name: '图片生成',
    color: 'green',
    icon: Image,
    description: '角色图、场景图和首尾帧模板。'
  },
  video: {
    name: '视频生成',
    color: 'purple',
    icon: Video,
    description: '场景视频与转场视频模板。'
  },
  audio: {
    name: '音频生成',
    color: 'orange',
    icon: AudioLines,
    description: '背景音乐等音频类模板。'
  }
}

export function useSettingsPrompts() {
  const promptsLoading = ref(false)
  const promptTemplates = ref<PromptTemplate[]>([])
  const selectedPromptId = ref<string | null>(null)
  const selectedPromptTemplate = ref<PromptTemplate | null>(null)
  const selectedPromptWorkflow = ref<ProjectWorkflowType>('asset_consistency')
  const expandedPromptCategories = ref<Set<PromptCategory>>(new Set(PROMPT_CATEGORY_ORDER))

  const groupedPrompts = computed(() => {
    const workflowMetadata = getPromptTemplateMetadataForWorkflow(selectedPromptWorkflow.value)
    const groups: Partial<Record<PromptCategory, typeof workflowMetadata>> = {}

    for (const meta of workflowMetadata) {
      if (!groups[meta.category]) {
        groups[meta.category] = []
      }
      groups[meta.category]!.push(meta)
    }

    return groups
  })

  const groupedPromptTemplates = computed<PromptTemplateGroup[]>(() => {
    const templateMap = new Map(promptTemplates.value.map(template => [template.id, template]))

    return PROMPT_CATEGORY_ORDER
      .map((category) => {
        const metadataList = groupedPrompts.value[category] || []
        const templates = metadataList
          .map(meta => templateMap.get(meta.id))
          .filter((template): template is PromptTemplate => Boolean(template))

        return {
          category,
          ...PROMPT_CATEGORY_CONFIG[category],
          templates,
          expanded: expandedPromptCategories.value.has(category)
        }
      })
      .filter(group => group.templates.length > 0)
  })

  const selectedPromptCategory = computed<PromptCategory | null>(() => {
    return selectedPromptTemplate.value?.category || null
  })

  function expandPromptCategory(category: PromptCategory) {
    expandedPromptCategories.value.add(category)
  }

  function syncSelectedPrompt(templates: PromptTemplate[]) {
    if (selectedPromptId.value) {
      selectedPromptTemplate.value = templates.find(template => template.id === selectedPromptId.value) || null
    }

    if (!selectedPromptTemplate.value && templates.length > 0) {
      const firstTemplate = templates[0]!
      selectedPromptId.value = firstTemplate.id
      selectedPromptTemplate.value = firstTemplate
    }

    if (selectedPromptTemplate.value) {
      expandPromptCategory(selectedPromptTemplate.value.category)
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
    if (selectedPromptTemplate.value) {
      expandPromptCategory(selectedPromptTemplate.value.category)
    }
  }

  function togglePromptCategory(category: PromptCategory) {
    if (expandedPromptCategories.value.has(category)) {
      expandedPromptCategories.value.delete(category)
      return
    }

    expandedPromptCategories.value.add(category)
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
    expandedPromptCategories,
    groupedPromptTemplates,
    selectPrompt,
    togglePromptCategory,
    toSelectString,
    handlePromptUpdate,
    handlePromptSaved,
    loadPromptTemplates
  }
}
