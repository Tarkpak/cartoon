import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import { invalidateSceneGenerationState } from '~/lib/asset-workbench-scenes'
import { normalizeToken } from '~/lib/asset-workbench-strings'

interface CharacterGenerationOptions {
  regenerationPrompt?: string
  referenceImage?: string
}

export function useAssetWorkbenchCharacterActions(options: {
  characters: Ref<CharacterData[]>
  scenes: Ref<SceneData[]>
  sceneConfigs?: Ref<Record<string, SceneConsistencyConfig>>
  saveProject: () => Promise<unknown>
  saveWorkflowMeta?: () => Promise<unknown>
  synchronizeQueueItems?: () => void
  generateCharacter: (
    character: CharacterData,
    options?: CharacterGenerationOptions
  ) => Promise<unknown>
  resolveUiError: (error: unknown, fallback: string) => string
  createCharacterId?: () => string
}) {
  const CHARACTER_REGENERATION_INITIAL_PROMPT = ''
  const editingCharacterId = ref<string | null>(null)
  const characterCreateDialogOpen = ref(false)
  const characterCreateError = ref<string | null>(null)
  const characterCreateSubmitting = ref(false)
  const characterVariantDialogOpen = ref(false)
  const characterVariantTargetId = ref<string | null>(null)
  const characterVariantError = ref<string | null>(null)
  const characterVariantSubmitting = ref(false)
  const characterRegenerateDialogOpen = ref(false)
  const characterRegenerateTargetId = ref<string | null>(null)
  const characterRegeneratePrompt = ref(CHARACTER_REGENERATION_INITIAL_PROMPT)
  const characterRegenerateError = ref<string | null>(null)
  const characterEditDraft = reactive({
    id: '',
    name: '',
    appearance: '',
    role: '配角',
    language: 'mandarin',
    languageNote: ''
  })

  watch(characterVariantDialogOpen, (open) => {
    if (open) return
    characterVariantTargetId.value = null
    characterVariantError.value = null
  })

  watch(characterRegenerateDialogOpen, (open) => {
    if (open) return
    characterRegenerateTargetId.value = null
    characterRegenerateError.value = null
  })

  const characterVariantTarget = computed(() => {
    if (!characterVariantTargetId.value) return null
    return options.characters.value.find(char => char.id === characterVariantTargetId.value) || null
  })

  const characterRegenerateTarget = computed(() => {
    if (!characterRegenerateTargetId.value) return null
    return options.characters.value.find(char => char.id === characterRegenerateTargetId.value) || null
  })

  function createDefaultCharacterId(): string {
    return `char_variant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  function setCharacterCreateDialogOpen(open: boolean) {
    if (characterCreateSubmitting.value) return
    characterCreateError.value = null
    characterCreateDialogOpen.value = open
  }

  async function submitCharacterCreate(rawName: string) {
    if (characterCreateSubmitting.value) return
    const name = rawName.trim()
    if (!name || options.characters.value.some(character => normalizeToken(character.name) === normalizeToken(name))) {
      characterCreateError.value = name ? '同名角色资产已存在' : '角色名称不能为空'
      return
    }
    const character: CharacterData = {
      id: (options.createCharacterId || createDefaultCharacterId)(),
      name,
      appearance: '',
      role: '配角',
      language: 'mandarin',
      generating: false,
      generatingViews: false
    }
    characterCreateSubmitting.value = true
    characterCreateError.value = null
    options.characters.value.push(character)
    try {
      if (await options.saveProject() === false) throw new Error('项目保存失败，请重试')
      characterCreateDialogOpen.value = false
      startEditCharacter(character)
    } catch (error) {
      options.characters.value = options.characters.value.filter(item => item.id !== character.id)
      characterCreateError.value = options.resolveUiError(error, '角色创建失败')
    } finally {
      characterCreateSubmitting.value = false
    }
  }

  function normalizeVariantInput(parent: CharacterData, rawValue: string): {
    displayName: string
    variantName: string
  } | null {
    const normalized = rawValue
      .trim()
      .replace(/[－—–]/g, '-')
      .replace(/\s*-\s*/g, '-')
    if (!normalized) return null

    const separatorIndex = normalized.indexOf('-')
    if (separatorIndex > 0 && separatorIndex < normalized.length - 1) {
      return {
        displayName: normalized,
        variantName: normalized.slice(separatorIndex + 1).trim()
      }
    }

    const parentName = parent.name.trim() || '角色'
    return {
      displayName: `${parentName}-${normalized}`,
      variantName: normalized
    }
  }

  function buildVariantAppearance(parent: CharacterData, variantName: string): string {
    const parentAppearance = parent.appearance?.trim() || ''
    const variantLine = `形态：${variantName}`
    if (!parentAppearance) {
      return `${parent.name}的${variantName}，保持与父角色设定一致`
    }
    if (normalizeToken(parentAppearance).includes(normalizeToken(variantName))) {
      return parentAppearance
    }
    return `${variantLine}。${parentAppearance}`
  }

  function startEditCharacter(char: CharacterData) {
    editingCharacterId.value = char.id
    characterEditDraft.id = char.id
    characterEditDraft.name = char.name
    characterEditDraft.appearance = char.appearance || ''
    characterEditDraft.role = char.role || '配角'
    characterEditDraft.language = char.language || 'mandarin'
    characterEditDraft.languageNote = char.languageNote || ''
  }

  function updateCharacterEditDraft(draft: { name: string, role: string, appearance: string, language?: string, languageNote?: string }) {
    characterEditDraft.name = draft.name
    characterEditDraft.role = draft.role
    characterEditDraft.appearance = draft.appearance
    characterEditDraft.language = draft.language || 'mandarin'
    characterEditDraft.languageNote = draft.languageNote || ''
  }

  function cancelEditCharacter() {
    editingCharacterId.value = null
    characterEditDraft.id = ''
    characterEditDraft.name = ''
    characterEditDraft.appearance = ''
    characterEditDraft.role = '配角'
    characterEditDraft.language = 'mandarin'
    characterEditDraft.languageNote = ''
  }

  function synchronizeCharacterNameInScenes(oldName: string, nextName: string) {
    if (!oldName || !nextName || oldName === nextName) return

    for (const scene of options.scenes.value) {
      for (const char of scene.characters) {
        if (char.name === oldName) {
          char.name = nextName
        }
      }
    }
  }

  async function handleGenerateCharacter(characterId: string) {
    const target = options.characters.value.find(char => char.id === characterId)
    if (!target) return

    await options.generateCharacter(target)
  }

  function openCharacterVariantDialog(char: CharacterData) {
    const { toast } = useToast()
    if (char.parentCharacterId) {
      toast.warning('请从原始角色添加变体')
      return
    }
    characterVariantTargetId.value = char.id
    characterVariantError.value = null
    characterVariantDialogOpen.value = true
  }

  function closeCharacterVariantDialog() {
    characterVariantDialogOpen.value = false
    characterVariantTargetId.value = null
    characterVariantError.value = null
  }

  function setCharacterVariantDialogOpen(open: boolean) {
    if (open) {
      if (characterVariantTargetId.value) {
        characterVariantDialogOpen.value = true
      }
      return
    }
    if (characterVariantSubmitting.value) return
    closeCharacterVariantDialog()
  }

  async function submitCharacterVariant(rawValue: string) {
    const parent = characterVariantTarget.value
    if (!parent) {
      closeCharacterVariantDialog()
      return
    }

    const normalized = normalizeVariantInput(parent, rawValue)
    if (!normalized?.variantName) {
      characterVariantError.value = '变体名称不能为空'
      return
    }

    const displayNameKey = normalizeToken(normalized.displayName)
    const duplicate = options.characters.value.some(character => normalizeToken(character.name) === displayNameKey)
    if (duplicate) {
      characterVariantError.value = '同名角色资产已存在'
      return
    }

    const { toast } = useToast()
    const variant: CharacterData = {
      id: (options.createCharacterId || createDefaultCharacterId)(),
      parentCharacterId: parent.id,
      variantName: normalized.variantName,
      name: normalized.displayName,
      appearance: buildVariantAppearance(parent, normalized.variantName),
      role: parent.role || '配角',
      personality: parent.personality,
      traits: parent.traits ? [...parent.traits] : undefined,
      background: parent.background,
      motivation: parent.motivation,
      speakingStyle: parent.speakingStyle,
      catchphrase: parent.catchphrase,
      voiceTone: parent.voiceTone,
      age: parent.age,
      gender: parent.gender,
      generating: false,
      generatingViews: false
    }

    characterVariantSubmitting.value = true
    characterVariantError.value = null
    try {
      const parentIndex = options.characters.value.findIndex(character => character.id === parent.id)
      if (parentIndex >= 0) {
        options.characters.value.splice(parentIndex + 1, 0, variant)
      } else {
        options.characters.value.push(variant)
      }
      const saved = await options.saveProject()
      if (saved === false) {
        toast.error('角色变体已添加，但项目保存失败')
        return
      }
      closeCharacterVariantDialog()
      startEditCharacter(variant)
      toast.success(`已添加角色变体：${variant.name}`, {
        description: '已加入原角色卡片的变体列表，可确认描述后保存并生成角色图。'
      })
    } catch (error) {
      characterVariantError.value = options.resolveUiError(error, '角色变体创建失败')
    } finally {
      characterVariantSubmitting.value = false
    }
  }

  async function removeCharacter(characterId: string) {
    const target = options.characters.value.find(character => character.id === characterId)
    if (!target) return

    const { toast } = useToast()
    const removedCharacters = options.characters.value.filter(character => character.id === characterId || character.parentCharacterId === characterId)
    if (removedCharacters.some(character => character.generating || character.generatingViews)) {
      toast.warning('请等待角色生成完成后再删除')
      return
    }
    const removedIds = new Set(removedCharacters.map(character => character.id))
    const label = target.parentCharacterId ? '角色变体' : '角色'

    const confirmed = await useConfirm().confirm({
      title: `删除${label}`,
      description: `确定删除「${target.name}」${removedCharacters.length > 1 ? `及其 ${removedCharacters.length - 1} 个变体` : ''}？角色图、历史记录和素材引用会从项目中移除，剧本中的人物描述保留。`,
      confirmText: '删除',
      cancelText: '取消',
      variant: 'destructive'
    })
    if (!confirmed) return

    const isRemovedAsset = (assetId: string) => removedIds.has(assetId.replace(/^char:/, ''))
    let affectedSceneCount = 0
    for (const scene of options.scenes.value) {
      let affected = false
      const config = options.sceneConfigs?.value[scene.id]
      if (config?.mustReferenceAssetIds?.some(isRemovedAsset)) {
        config.mustReferenceAssetIds = config.mustReferenceAssetIds.filter(assetId => !isRemovedAsset(assetId))
        affected = true
      }
      for (const character of scene.characters) {
        if (character.assetId && isRemovedAsset(character.assetId)) {
          delete character.assetId
          affected = true
        }
        if (removedCharacters.some(item => item.name === character.name)) affected = true
      }
      if (affected) {
        affectedSceneCount += 1
        invalidateSceneGenerationState(scene)
      }
    }

    options.characters.value = options.characters.value.filter(character => !removedIds.has(character.id))
    if (affectedSceneCount > 0) options.synchronizeQueueItems?.()
    if (editingCharacterId.value && removedIds.has(editingCharacterId.value)) {
      cancelEditCharacter()
    }

    try {
      const saved = await options.saveProject()
      const metaSaved = affectedSceneCount > 0 ? await options.saveWorkflowMeta?.() : true
      if (saved === false || metaSaved === false) {
        toast.error('角色已删除，但项目保存失败，请重试保存')
        return
      }
      toast.success(`已删除${label}：${target.name}`, {
        description: affectedSceneCount > 0 ? `已更新 ${affectedSceneCount} 个场景的素材引用状态。` : undefined
      })
    } catch (error) {
      toast.error(options.resolveUiError(error, '删除后的项目保存失败，请重试保存'))
    }
  }

  async function saveCharacterEdit(saveOptions: { regenerate?: boolean } = {}) {
    if (!editingCharacterId.value) return

    const target = options.characters.value.find(char => char.id === editingCharacterId.value)
    if (!target) {
      cancelEditCharacter()
      return
    }

    const { toast } = useToast()
    const nextName = characterEditDraft.name.trim()
    if (!nextName) {
      toast.warning('角色名称不能为空')
      return
    }
    if (options.characters.value.some(character => character.id !== target.id && normalizeToken(character.name) === normalizeToken(nextName))) {
      toast.warning('同名角色资产已存在')
      return
    }

    const oldName = target.name
    target.name = nextName
    target.appearance = characterEditDraft.appearance.trim()
    target.role = characterEditDraft.role || '配角'
    target.language = characterEditDraft.language as CharacterData['language']
    target.languageNote = characterEditDraft.languageNote.trim() || undefined

    synchronizeCharacterNameInScenes(oldName, target.name)

    try {
      if (await options.saveProject() === false) throw new Error('项目保存失败，请重试')
    } catch (error) {
      toast.error(options.resolveUiError(error, '角色保存失败'))
      return
    }
    cancelEditCharacter()

    if (saveOptions.regenerate) {
      await handleGenerateCharacter(target.id)
    }
  }

  function openCharacterRegenerateDialog(char: CharacterData) {
    const { toast } = useToast()
    if (!char.baseImage?.trim()) {
      toast.warning('请先生成角色图，再进行二次生成')
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
    characterCreateDialogOpen,
    characterCreateError,
    characterCreateSubmitting,
    setCharacterCreateDialogOpen,
    submitCharacterCreate,
    removeCharacter,
    editingCharacterId,
    characterEditDraft,
    characterVariantDialogOpen,
    characterVariantError,
    characterVariantSubmitting,
    characterVariantTarget,
    characterRegenerateDialogOpen,
    characterRegeneratePrompt,
    characterRegenerateError,
    characterRegenerateTarget,
    startEditCharacter,
    updateCharacterEditDraft,
    cancelEditCharacter,
    openCharacterVariantDialog,
    setCharacterVariantDialogOpen,
    submitCharacterVariant,
    removeCharacterVariant: removeCharacter,
    handleGenerateCharacter,
    saveCharacterEdit,
    openCharacterRegenerateDialog,
    closeCharacterRegenerateDialog,
    setCharacterRegenerateDialogOpen,
    setCharacterRegeneratePrompt,
    submitCharacterRegeneration
  }
}
