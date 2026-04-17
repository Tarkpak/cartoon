import type {
  PromptTemplate,
  PromptVariable
} from '#shared/types/prompt-template'

export interface PromptVariableValidation {
  undefinedVars: string[]
  unusedVars: string[]
  isValid: boolean
}

export interface PromptDiffLine {
  type: 'same' | 'add' | 'remove'
  content: string
}

export const promptCategoryLabels: Record<PromptTemplate['category'], string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频'
}

export const promptCategoryColors: Record<PromptTemplate['category'], string> = {
  text: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  image: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  video: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  audio: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
}

const PROMPT_VARIABLE_PATTERN = /\{\{(\w+)\}\}/g

function createPromptVariableMatcher() {
  return new RegExp(PROMPT_VARIABLE_PATTERN)
}

export function extractPromptVariableName(name: string): string {
  const match = name.match(/\{\{(\w+)\}\}/)
  return match?.[1] ?? name
}

export function getPromptVariableTag(name: string): string {
  if (name.startsWith('{{') && name.endsWith('}}')) {
    return name
  }

  return `{{${name}}}`
}

export function getPromptVariableNameSet(variables: PromptVariable[]): Set<string> {
  return new Set(variables.map(variable => extractPromptVariableName(variable.name)))
}

export function getPromptVariableValidation(
  content: string,
  variables: PromptVariable[]
): PromptVariableValidation {
  const definedVars = getPromptVariableNameSet(variables)
  const usedVars = new Set<string>()
  const matcher = createPromptVariableMatcher()

  for (const match of content.matchAll(matcher)) {
    const variableName = match[1]
    if (variableName) {
      usedVars.add(variableName)
    }
  }

  const undefinedVars = [...usedVars].filter(variableName => !definedVars.has(variableName))
  const unusedVars = [...definedVars].filter(variableName => !usedVars.has(variableName))

  return {
    undefinedVars,
    unusedVars,
    isValid: undefinedVars.length === 0
  }
}

export function promptHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p><p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function promptTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return escaped
    .split('\n\n')
    .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export function buildPromptPreviewContent(
  content: string,
  previewVariables: Record<string, string>
): string {
  let previewContent = content

  for (const [key, value] of Object.entries(previewVariables)) {
    const placeholder = getPromptVariableTag(key)
    previewContent = previewContent.split(placeholder).join(value || `[${key}]`)
  }

  return previewContent
}

export function buildPromptDiffLines(originalContent: string, currentContent: string): PromptDiffLine[] {
  const original = originalContent.split('\n')
  const current = currentContent.split('\n')
  const result: PromptDiffLine[] = []
  const maxLen = Math.max(original.length, current.length)

  for (let index = 0; index < maxLen; index++) {
    const originalLine = original[index] ?? ''
    const currentLine = current[index] ?? ''

    if (originalLine === currentLine) {
      result.push({ type: 'same', content: currentLine })
      continue
    }

    if (originalLine) {
      result.push({ type: 'remove', content: originalLine })
    }

    if (currentLine) {
      result.push({ type: 'add', content: currentLine })
    }
  }

  return result
}

export function formatPromptVersionDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
