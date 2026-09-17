import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { computed, reactive, ref, watch } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import { useAssetWorkbenchCharacterActions } from './useAssetWorkbenchCharacterActions'
import type { SceneConsistencyConfig } from './useAssetWorkflowMeta'

function createCharacter(input: Partial<CharacterData> & { id: string, name: string }): CharacterData {
  return {
    appearance: '',
    role: 'supporting',
    generating: false,
    generatingViews: false,
    ...input
  }
}

describe('useAssetWorkbenchCharacterActions', () => {
  const testGlobal = globalThis as typeof globalThis & {
    computed?: unknown
    reactive?: unknown
    ref?: unknown
    useConfirm?: unknown
    useToast?: unknown
    watch?: unknown
  }
  const originalGlobals: Partial<Record<'computed' | 'reactive' | 'ref' | 'useConfirm' | 'useToast' | 'watch', unknown>> = {}
  const hadOriginalGlobal: Partial<Record<'computed' | 'reactive' | 'ref' | 'useConfirm' | 'useToast' | 'watch', boolean>> = {}

  beforeEach(() => {
    for (const key of ['computed', 'reactive', 'ref', 'useConfirm', 'useToast', 'watch'] as const) {
      hadOriginalGlobal[key] = Object.prototype.hasOwnProperty.call(testGlobal, key)
      originalGlobals[key] = testGlobal[key]
    }
    testGlobal.computed = computed
    testGlobal.reactive = reactive
    testGlobal.ref = ref
    testGlobal.watch = watch
    testGlobal.useToast = () => ({
      toast: {
        success: vi.fn(),
        warning: vi.fn(),
        error: vi.fn()
      }
    })
    testGlobal.useConfirm = () => ({
      confirm: vi.fn(async () => true)
    })
  })

  afterEach(() => {
    for (const key of ['computed', 'reactive', 'ref', 'useConfirm', 'useToast', 'watch'] as const) {
      if (hadOriginalGlobal[key]) {
        testGlobal[key] = originalGlobals[key]
      } else {
        delete testGlobal[key]
      }
    }
  })

  function setup(characters = ref<CharacterData[]>([]), saveProject = vi.fn(async () => true)) {
    const scenes = ref<SceneData[]>([])
    const sceneConfigs = ref<Record<string, SceneConsistencyConfig>>({})
    const saveWorkflowMeta = vi.fn(async () => true)
    const actions = useAssetWorkbenchCharacterActions({
      characters, scenes, sceneConfigs, saveProject, saveWorkflowMeta,
      generateCharacter: vi.fn(),
      resolveUiError: error => error instanceof Error ? error.message : 'error',
      createCharacterId: () => 'manual'
    })
    return { actions, characters, scenes, sceneConfigs, saveProject, saveWorkflowMeta }
  }

  it('creates a missing root character and opens its details for editing', async () => {
    const { actions, characters, saveProject } = setup()
    actions.setCharacterCreateDialogOpen(true)
    await actions.submitCharacterCreate('  林婉  ')
    expect(characters.value[0]).toMatchObject({ id: 'manual', name: '林婉', role: '配角' })
    expect(characters.value[0]?.parentCharacterId).toBeUndefined()
    expect(actions.editingCharacterId.value).toBe('manual')
    expect(actions.characterCreateDialogOpen.value).toBe(false)
    expect(saveProject).toHaveBeenCalledOnce()
  })

  it('rejects blank and duplicate names without saving', async () => {
    const { actions, characters, saveProject } = setup(ref([createCharacter({ id: 'one', name: '林婉' })]))
    await actions.submitCharacterCreate(' ')
    expect(actions.characterCreateError.value).toBe('角色名称不能为空')
    await actions.submitCharacterCreate(' 林婉 ')
    expect(actions.characterCreateError.value).toBe('同名角色资产已存在')
    expect(characters.value).toHaveLength(1)
    expect(saveProject).not.toHaveBeenCalled()
  })

  it('rolls back failed creation so retry does not leave duplicates', async () => {
    const save = vi.fn(async () => false)
    const { actions, characters } = setup(ref([]), save)
    actions.setCharacterCreateDialogOpen(true)
    await actions.submitCharacterCreate('林婉')
    expect(characters.value).toHaveLength(0)
    expect(actions.characterCreateDialogOpen.value).toBe(true)
    expect(actions.characterCreateError.value).toBeTruthy()
    save.mockResolvedValue(true)
    await actions.submitCharacterCreate('林婉')
    expect(characters.value).toHaveLength(1)
  })

  it('removes roots and variants and clears both forms of scene references', async () => {
    const { actions, characters, scenes, sceneConfigs, saveWorkflowMeta } = setup(ref([
      createCharacter({ id: 'root', name: '林婉' }),
      createCharacter({ id: 'variant', name: '林婉-现代', parentCharacterId: 'root' }),
      createCharacter({ id: 'other', name: '陈泽' })
    ]))
    scenes.value = [{ id: 'scene', characters: [{ name: '林婉', assetId: 'root' }, { name: '林婉-现代', assetId: 'char:variant' }] } as SceneData]
    sceneConfigs.value.scene = { mustReferenceAssetIds: ['char:root', 'char:variant', 'char:other'] } as SceneConsistencyConfig
    await actions.removeCharacter('root')
    expect(characters.value.map(item => item.id)).toEqual(['other'])
    expect(scenes.value[0]?.characters).toEqual([{ name: '林婉' }, { name: '林婉-现代' }])
    expect(sceneConfigs.value.scene?.mustReferenceAssetIds).toEqual(['char:other'])
    expect(saveWorkflowMeta).toHaveBeenCalledOnce()
  })

  it('keeps characters when deletion is cancelled', async () => {
    testGlobal.useConfirm = () => ({ confirm: vi.fn(async () => false) })
    const { actions, characters, saveProject } = setup(ref([createCharacter({ id: 'one', name: '林婉' })]))
    await actions.removeCharacter('one')
    expect(characters.value).toHaveLength(1)
    expect(saveProject).not.toHaveBeenCalled()
  })

  it('rejects duplicate edits and retains the draft after failed saves', async () => {
    const { actions, characters, saveProject } = setup(ref([
      createCharacter({ id: 'one', name: '林婉' }), createCharacter({ id: 'two', name: '陈泽' })
    ]))
    actions.startEditCharacter(characters.value[0]!)
    actions.characterEditDraft.name = '陈泽'
    await actions.saveCharacterEdit()
    expect(saveProject).not.toHaveBeenCalled()
    expect(characters.value[0]?.name).toBe('林婉')
    actions.characterEditDraft.name = '林婉儿'
    saveProject.mockResolvedValue(false)
    await actions.saveCharacterEdit()
    expect(actions.editingCharacterId.value).toBe('one')
  })

  it('creates a character variant next to its parent and opens it for editing', async () => {
    const parent = createCharacter({
      id: 'char_parent',
      name: '陈泽',
      appearance: '黑色夹克',
      role: 'protagonist'
    })
    const sibling = createCharacter({
      id: 'char_sibling',
      name: '林婉',
      appearance: '红裙'
    })
    const characters = ref<CharacterData[]>([parent, sibling])
    const scenes = ref<SceneData[]>([])
    const saveProject = vi.fn(async () => true)

    const actions = useAssetWorkbenchCharacterActions({
      characters,
      scenes,
      saveProject,
      generateCharacter: vi.fn(),
      resolveUiError: error => error instanceof Error ? error.message : 'error',
      createCharacterId: () => 'char_variant'
    })

    actions.openCharacterVariantDialog(parent)
    await actions.submitCharacterVariant('现代形态')

    expect(characters.value.map(character => character.id)).toEqual([
      'char_parent',
      'char_variant',
      'char_sibling'
    ])
    expect(characters.value[1]).toMatchObject({
      parentCharacterId: 'char_parent',
      variantName: '现代形态',
      name: '陈泽-现代形态',
      role: 'protagonist',
      appearance: '形态：现代形态。黑色夹克'
    })
    expect(actions.editingCharacterId.value).toBe('char_variant')
    expect(actions.characterEditDraft).toMatchObject({
      id: 'char_variant',
      name: '陈泽-现代形态',
      appearance: '形态：现代形态。黑色夹克',
      role: 'protagonist'
    })
    expect(saveProject).toHaveBeenCalledTimes(1)
  })

  it('removes a character variant after confirmation and saves the project', async () => {
    const parent = createCharacter({
      id: 'char_parent',
      name: '陈泽'
    })
    const variant = createCharacter({
      id: 'char_variant',
      parentCharacterId: 'char_parent',
      variantName: '现代形态',
      name: '陈泽-现代形态'
    })
    const characters = ref<CharacterData[]>([parent, variant])
    const scenes = ref<SceneData[]>([])
    const saveProject = vi.fn(async () => true)

    const actions = useAssetWorkbenchCharacterActions({
      characters,
      scenes,
      saveProject,
      generateCharacter: vi.fn(),
      resolveUiError: error => error instanceof Error ? error.message : 'error'
    })

    actions.startEditCharacter(variant)
    await actions.removeCharacterVariant('char_variant')

    expect(characters.value.map(character => character.id)).toEqual(['char_parent'])
    expect(actions.editingCharacterId.value).toBeNull()
    expect(saveProject).toHaveBeenCalledTimes(1)
  })
})
