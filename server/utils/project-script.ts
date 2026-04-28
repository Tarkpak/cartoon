import {
  DEFAULT_SCRIPT_PARSE_MODE,
  normalizeScriptParseMode,
  type ScriptParseMode
} from '../../shared/types/script'

export interface StoredProjectScriptData {
  storyIdea: string
  novelText: string
  rawText: string
  selectedStyleId: string
  inputMode: 'idea' | 'script'
  scriptParseMode: ScriptParseMode
  episodePlan: unknown[]
  assetWorkflow: unknown | null
}

function createDefaultStoredProjectScriptData(): StoredProjectScriptData {
  return {
    storyIdea: '',
    novelText: '',
    rawText: '',
    selectedStyleId: '',
    inputMode: 'idea',
    scriptParseMode: DEFAULT_SCRIPT_PARSE_MODE,
    episodePlan: [],
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
      inputMode: parsed.inputMode === 'script' ? 'script' : defaults.inputMode,
      scriptParseMode: normalizeScriptParseMode((parsed as { scriptParseMode?: unknown }).scriptParseMode),
      episodePlan: Array.isArray(parsed.episodePlan) ? parsed.episodePlan : defaults.episodePlan,
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
    inputMode: patch.inputMode ?? base.inputMode,
    scriptParseMode: patch.scriptParseMode ? normalizeScriptParseMode(patch.scriptParseMode) : base.scriptParseMode,
    episodePlan: patch.episodePlan ?? base.episodePlan,
    assetWorkflow: patch.assetWorkflow ?? base.assetWorkflow
  }
}

export function serializeStoredProjectScript(data: StoredProjectScriptData): string {
  return JSON.stringify(data)
}
