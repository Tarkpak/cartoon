import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'

interface CharacterGenerationOptions {
  regenerationPrompt?: string
  referenceImage?: string
}

export function useAssetWorkbenchCharacterActions(options: {
  characters: Ref<CharacterData[]>
  scenes: Ref<SceneData[]>
  saveProject: () => Promise<unknown>
  generateCharacter: (
    character: CharacterData,
    options?: CharacterGenerationOptions
  ) => Promise<unknown>
  resolveUiError: (error: unknown, fallback: string) => string
}) {
  const CHARACTER_REGENERATION_INITIAL_PROMPT = ''
  const editingCharacterId = ref<string | null>(null)
  const characterRegenerateDialogOpen = ref(false)
  const characterRegenerateTargetId = ref<string | null>(null)
  const characterRegeneratePrompt = ref(CHARACTER_REGENERATION_INITIAL_PROMPT)
  const characterRegenerateError = ref<string | null>(null)
  const characterEditDraft = reactive({
    id: '',
    name: '',
    appearance: '',
    role: 'supporting'
  })

  watch(characterRegenerateDialogOpen, (open) => {
    if (open) return
    characterRegenerateTargetId.value = null
    characterRegenerateError.value = null
  })

  const characterRegenerateTarget = computed(() => {
    if (!characterRegenerateTargetId.value) return null
    return options.characters.value.find(char => char.id === characterRegenerateTargetId.value) || null
  })

  function startEditCharacter(char: CharacterData) {
    editingCharacterId.value = char.id
    characterEditDraft.id = char.id
    characterEditDraft.name = char.name
    characterEditDraft.appearance = char.appearance || ''
    characterEditDraft.role = char.role || 'supporting'
  }

  function updateCharacterEditDraft(draft: { name: string, role: string, appearance: string }) {
    characterEditDraft.name = draft.name
    characterEditDraft.role = draft.role
    characterEditDraft.appearance = draft.appearance
  }

  function cancelEditCharacter() {
    editingCharacterId.value = null
    characterEditDraft.id = ''
    characterEditDraft.name = ''
    characterEditDraft.appearance = ''
    characterEditDraft.role = 'supporting'
  }

  function synchronizeCharacterNameInScenes(oldName: string, nextName: string) {
    if (!oldName || !nextName || oldName === nextName) return

    for (const scene of options.scenes.value) {
      for (const char of scene.characters) {
        if (char.name === oldName) {
          char.name = nextName
        }
      }

      for (const dialogue of scene.dialogues) {
        if (dialogue.character === oldName) {
          dialogue.character = nextName
        }
      }
    }
  }

  async function handleGenerateCharacter(characterId: string) {
    const target = options.characters.value.find(char => char.id === characterId)
    if (!target) return

    await options.generateCharacter(target)
  }

  async function saveCharacterEdit(saveOptions: { regenerate?: boolean } = {}) {
    if (!editingCharacterId.value) return

    const target = options.characters.value.find(char => char.id === editingCharacterId.value)
    if (!target) {
      cancelEditCharacter()
      return
    }

    const nextName = characterEditDraft.name.trim()
    if (!nextName) {
      alert('角色名称不能为空')
      return
    }

    const oldName = target.name
    target.name = nextName
    target.appearance = characterEditDraft.appearance.trim()
    target.role = characterEditDraft.role || 'supporting'

    synchronizeCharacterNameInScenes(oldName, target.name)

    await options.saveProject()
    cancelEditCharacter()

    if (saveOptions.regenerate) {
      await handleGenerateCharacter(target.id)
    }
  }

  function openCharacterRegenerateDialog(char: CharacterData) {
    if (!char.baseImage?.trim()) {
      alert('请先生成角色图，再进行二次生成')
      return
    }
    characterRegenerateTargetId.value = char.id
    characterRegeneratePrompt.value = CHARACTER_REGENERATION_INITIAL_PROMPT
    characterRegenerateError.value = null
    characterRegenerateDialogOpen.value = true
  }

  function closeCharacterRegenerateDialog() {
    characterRegenerateDialogOpen.value = false
    characterRegenerateTargetId.value = null
    characterRegenerateError.value = null
  }

  function setCharacterRegenerateDialogOpen(open: boolean) {
    if (open) {
      characterRegenerateDialogOpen.value = true
      return
    }
    closeCharacterRegenerateDialog()
  }

  function setCharacterRegeneratePrompt(prompt: string) {
    characterRegeneratePrompt.value = prompt
  }

  async function submitCharacterRegeneration() {
    const targetId = characterRegenerateTargetId.value
    if (!targetId) return

    const target = options.characters.value.find(char => char.id === targetId)
    if (!target) {
      closeCharacterRegenerateDialog()
      return
    }

    const prompt = characterRegeneratePrompt.value.trim()
    if (!prompt) {
      characterRegenerateError.value = '请输入二次生成提示词'
      return
    }

    if (!target.baseImage?.trim()) {
      characterRegenerateError.value = '角色参考图不存在，请先生成角色图'
      return
    }

    characterRegenerateError.value = null

    try {
      await options.generateCharacter(target, {
        regenerationPrompt: prompt
      })
      closeCharacterRegenerateDialog()
    } catch (error) {
      characterRegenerateError.value = options.resolveUiError(error, '角色二次生成失败')
    }
  }

  return {
    editingCharacterId,
    characterEditDraft,
    characterRegenerateDialogOpen,
    characterRegeneratePrompt,
    characterRegenerateError,
    characterRegenerateTarget,
    startEditCharacter,
    updateCharacterEditDraft,
    cancelEditCharacter,
    handleGenerateCharacter,
    saveCharacterEdit,
    openCharacterRegenerateDialog,
    closeCharacterRegenerateDialog,
    setCharacterRegenerateDialogOpen,
    setCharacterRegeneratePrompt,
    submitCharacterRegeneration
  }
}
