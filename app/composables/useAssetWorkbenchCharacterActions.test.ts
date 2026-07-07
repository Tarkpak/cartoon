import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { computed, reactive, ref, watch } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import { useAssetWorkbenchCharacterActions } from './useAssetWorkbenchCharacterActions'

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
