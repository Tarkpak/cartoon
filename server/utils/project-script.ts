type StoredSelectedModels = {
  text?: string
  image?: string
  video?: string
  tts?: string
  asr?: string
}

export interface StoredProjectScriptData {
  storyIdea: string
  novelText: string
  rawText: string
  selectedStyleId: string
  selectedModels: StoredSelectedModels | null
  outline: unknown | null
  inputMode: 'idea' | 'script'
  assetWorkflow: unknown | null
}

function createDefaultStoredProjectScriptData(): StoredProjectScriptData {
  return {
    storyIdea: '',
    novelText: '',
    rawText: '',
    selectedStyleId: '',
    selectedModels: null,
    outline: null,
    inputMode: 'idea',
    assetWorkflow: null
  }
}

export function parseStoredProjectScript(rawText?: string | null): StoredProjectScriptData | null {
  if (!rawText?.trim()) return null

  try {
    const parsed = JSON.parse(rawText) as Partial<StoredProjectScriptData>
    const defaults = createDefaultStoredProjectScriptData()

    return {
      storyIdea: typeof parsed.storyIdea === 'string' ? parsed.storyIdea : defaults.storyIdea,
      novelText: typeof parsed.novelText === 'string' ? parsed.novelText : defaults.novelText,
      rawText: typeof parsed.rawText === 'string' ? parsed.rawText : defaults.rawText,
      selectedStyleId: typeof parsed.selectedStyleId === 'string' ? parsed.selectedStyleId : defaults.selectedStyleId,
      selectedModels: parsed.selectedModels && typeof parsed.selectedModels === 'object'
        ? parsed.selectedModels
        : defaults.selectedModels,
      outline: parsed.outline ?? defaults.outline,
      inputMode: parsed.inputMode === 'script' ? 'script' : defaults.inputMode,
      assetWorkflow: parsed.assetWorkflow ?? defaults.assetWorkflow
    }
  } catch {
    return {
      ...createDefaultStoredProjectScriptData(),
      rawText,
      storyIdea: rawText
    }
  }
}

export function mergeStoredProjectScriptData(
  patch: Partial<StoredProjectScriptData>,
  existing?: StoredProjectScriptData | null
): StoredProjectScriptData {
  const base = existing ?? createDefaultStoredProjectScriptData()

  return {
    storyIdea: patch.storyIdea ?? base.storyIdea,
    novelText: patch.novelText ?? base.novelText,
    rawText: patch.rawText ?? base.rawText,
    selectedStyleId: patch.selectedStyleId ?? base.selectedStyleId,
    selectedModels: patch.selectedModels ?? base.selectedModels,
    outline: patch.outline ?? base.outline,
    inputMode: patch.inputMode ?? base.inputMode,
    assetWorkflow: patch.assetWorkflow ?? base.assetWorkflow
  }
}

export function serializeStoredProjectScript(data: StoredProjectScriptData): string {
  return JSON.stringify(data)
}
