import type {
  PromptTemplate,
  PromptVariable,
  PromptVersion
} from '#shared/types/prompt-template'
import type { ProjectWorkflowType } from '#shared/types/project'

export type PromptEditorLanguage = 'zh' | 'en'

export interface PromptEditorContent {
  zh: string
  en: string
}

export interface PromptMutationResponse {
  success: boolean
  data: PromptTemplate
}

export interface PromptVersionsResponse {
  success: boolean
  data: {
    versions: PromptVersion[]
  }
}

export interface PromptLangConfigResponse {
  success: boolean
  data: Record<string, PromptEditorLanguage>
}

interface PromptTranslationResponse {
  success: boolean
  data: {
    translatedText: string
  }
}

interface PromptTemplateRequestOptions {
  templateId: string
  workflow: ProjectWorkflowType
}

interface SavePromptTemplateOptions extends PromptTemplateRequestOptions {
  content: PromptEditorContent
}

interface RestorePromptTemplateOptions extends PromptTemplateRequestOptions {
  versionId: string
}

interface UpdatePromptLangConfigOptions {
  workflow: ProjectWorkflowType
  templateId: string
  lang: PromptEditorLanguage
}

interface TranslatePromptContentOptions {
  text: string
  from: PromptEditorLanguage
  to: PromptEditorLanguage
}

export function buildPromptEditorContent(
  content?: Partial<Record<PromptEditorLanguage, string>>
): PromptEditorContent {
  return {
    zh: content?.zh || '',
    en: content?.en || ''
  }
}

export function mergePromptEditorContent(
  base: PromptEditorContent,
  imported: Partial<Record<PromptEditorLanguage, string>>
): PromptEditorContent {
  return {
    zh: imported.zh ?? base.zh,
    en: imported.en ?? base.en
  }
}

export function buildPromptPreviewVariables(variables: PromptVariable[]): Record<string, string> {
  return Object.fromEntries(
    variables.map(variable => [variable.name, variable.example || ''])
  )
}

export function hasPromptEditorChanges(
  original: Partial<Record<PromptEditorLanguage, string>>,
  local: PromptEditorContent
): boolean {
  return (original.zh || '') !== local.zh || (original.en || '') !== local.en
}

export function buildPromptCharCount(content: string, language: PromptEditorLanguage) {
  return {
    chars: content.length,
    words: content.trim() ? content.trim().split(/\s+/).length : 0,
    tokens: Math.ceil(content.length / (language === 'zh' ? 2 : 4))
  }
}

export async function savePromptTemplate(options: SavePromptTemplateOptions) {
  return await $fetch<PromptMutationResponse>(`/api/prompts/${options.templateId}`, {
    method: 'PUT',
    query: { workflow: options.workflow },
    body: {
      content: options.content,
      note: `手动编辑 - ${new Date().toLocaleString('zh-CN')}`
    }
  })
}

export async function resetPromptTemplate(options: PromptTemplateRequestOptions) {
  return await $fetch<PromptMutationResponse>(`/api/prompts/${options.templateId}/reset`, {
    method: 'POST',
    query: { workflow: options.workflow }
  })
}

export async function fetchPromptVersions(options: PromptTemplateRequestOptions) {
  return await $fetch<PromptVersionsResponse>(`/api/prompts/${options.templateId}/versions`, {
    query: { workflow: options.workflow }
  })
}

export async function restorePromptTemplate(options: RestorePromptTemplateOptions) {
  return await $fetch<PromptMutationResponse>(`/api/prompts/${options.templateId}/restore`, {
    method: 'POST',
    query: { workflow: options.workflow },
    body: { versionId: options.versionId }
  })
}

export async function fetchPromptLangConfig(workflow: ProjectWorkflowType) {
  return await $fetch<PromptLangConfigResponse>('/api/prompts/lang-config', {
    query: { workflow }
  })
}

export async function updatePromptLangConfig(options: UpdatePromptLangConfigOptions) {
  await $fetch('/api/prompts/lang-config', {
    method: 'PUT',
    query: { workflow: options.workflow },
    body: { [options.templateId]: options.lang }
  })
}

export async function translatePromptContent(options: TranslatePromptContentOptions) {
  return await $fetch<PromptTranslationResponse>('/api/prompts/translate', {
    method: 'POST',
    body: {
      text: options.text,
      from: options.from,
      to: options.to
    }
  })
}

export function exportPromptTemplate(
  template: Pick<PromptTemplate, 'id' | 'name'>,
  content: PromptEditorContent
) {
  const blob = new Blob([JSON.stringify({
    id: template.id,
    name: template.name,
    content,
    exportedAt: new Date().toISOString()
  }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = `prompt-${template.id}.json`
  anchor.click()

  URL.revokeObjectURL(url)
}

export async function parsePromptTemplateImport(file: File) {
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取导入文件失败'))
    reader.readAsText(file)
  })

  const data = JSON.parse(text) as {
    content?: Partial<Record<PromptEditorLanguage, string>>
  }

  return data.content || {}
}
