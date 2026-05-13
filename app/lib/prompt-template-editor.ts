import type {
  PromptTemplate,
  PromptVariable,
  PromptVersion
} from '#shared/types/prompt-template'

export type PromptEditorContent = string

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

interface PromptTemplateRequestOptions {
  templateId: string
}

interface SavePromptTemplateOptions extends PromptTemplateRequestOptions {
  content: PromptEditorContent
}

interface RestorePromptTemplateOptions extends PromptTemplateRequestOptions {
  versionId: string
}

export function buildPromptEditorContent(
  content?: string
): PromptEditorContent {
  return content || ''
}

export function mergePromptEditorContent(
  base: PromptEditorContent,
  imported: string | null | undefined
): PromptEditorContent {
  return typeof imported === 'string' ? imported : base
}

export function buildPromptPreviewVariables(variables: PromptVariable[]): Record<string, string> {
  return Object.fromEntries(
    variables.map(variable => [variable.name, variable.example || ''])
  )
}

export function hasPromptEditorChanges(
  original: string | undefined,
  local: PromptEditorContent
): boolean {
  return (original || '') !== local
}

export function buildPromptCharCount(content: string) {
  return {
    chars: content.length,
    words: content.trim() ? content.trim().split(/\s+/).length : 0,
    tokens: Math.ceil(content.length / 2)
  }
}

export async function savePromptTemplate(options: SavePromptTemplateOptions) {
  return await $fetch<PromptMutationResponse>(`/api/prompts/${options.templateId}`, {
    method: 'PUT',
    body: {
      content: options.content,
      note: `手动编辑 - ${new Date().toLocaleString('zh-CN')}`
    }
  })
}

export async function resetPromptTemplate(options: PromptTemplateRequestOptions) {
  return await $fetch<PromptMutationResponse>(`/api/prompts/${options.templateId}/reset`, {
    method: 'POST'
  })
}

export async function fetchPromptVersions(options: PromptTemplateRequestOptions) {
  return await $fetch<PromptVersionsResponse>(`/api/prompts/${options.templateId}/versions`)
}

export async function restorePromptTemplate(options: RestorePromptTemplateOptions) {
  return await $fetch<PromptMutationResponse>(`/api/prompts/${options.templateId}/restore`, {
    method: 'POST',
    body: { versionId: options.versionId }
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
    content?: string
  }

  return typeof data.content === 'string' ? data.content : ''
}
