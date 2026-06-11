interface WorkflowStylePreset {
  name?: string
  prompt?: string
}

function normalizeStyleText(value?: string): string {
  return (value || '').trim().replace(/\s+/g, ' ')
}

function ensureStyleSuffix(value: string): string {
  const normalized = normalizeStyleText(value)
  if (!normalized) return ''
  if (/(?:\bstyle|风格)$/iu.test(normalized)) return normalized
  return `${normalized} style`
}

export function formatWorkflowStylePrompt(
  styleId?: string,
  style?: WorkflowStylePreset | null
): string {
  const fallback = ensureStyleSuffix(styleId || '')
  if (!style) return fallback

  const name = normalizeStyleText(style.name)
  const prompt = ensureStyleSuffix(style.prompt || '')

  if (!name) return prompt || fallback
  if (!prompt) return ensureStyleSuffix(name)
  if (name.toLocaleLowerCase() === prompt.toLocaleLowerCase()) return prompt

  return `${name}, ${prompt}`
}
