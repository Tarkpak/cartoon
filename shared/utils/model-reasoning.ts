export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high'

export function supportsTextReasoningEffort(modelId: string): boolean {
  const model = modelId.trim().replace(/^models\//, '').trim().toLowerCase()
  if (model.includes('-pro') || model.includes('-chat') || /^o1-(mini|preview)/.test(model)) return false
  return /^(gpt-[56]|o1|o3|o4-mini)(?:$|[-.])/.test(model)
}
