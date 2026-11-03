import type { Ref } from 'vue'
import type { CharacterData } from '~/composables/useAssetWorkbench'

/**
 * Character image generation on top of the core generator: saves the project,
 * records history, and re-ingests variants whose parent is an active Ark asset.
 */
export function useAssetWorkbenchCharacterGeneration(options: {
  characters: Ref<CharacterData[]>
  generateCharacterCore: (character: CharacterData, input?: { regenerationPrompt?: string, referenceImage?: string }) => Promise<unknown>
  recordCharacterHistory: (characterId: string, image: string | undefined, options: { source: 'generated' | 'uploaded' | 'legacy', prompt?: string }) => void
  saveProject: () => Promise<unknown>
  saveWorkflowMeta: () => Promise<unknown>
  /** Late-bound: the Ark ingest helper is created after this composable. */
  ingestCharacterToArkVirtualAsset: (characterId: string, options?: { silent?: boolean }) => Promise<void>
}) {
  const {
    characters,
    generateCharacterCore,
    recordCharacterHistory,
    saveProject,
    saveWorkflowMeta,
    ingestCharacterToArkVirtualAsset
  } = options

  async function generateCharacter(
    character: CharacterData,
    input?: {
      regenerationPrompt?: string
      referenceImage?: string
    },
    options: {
      persistHistory?: boolean
    } = {}
  ) {
    const previousImage = character.baseImage?.trim() || ''

    await generateCharacterCore(character, input)

    const currentCharacter = characters.value.find(item => item.id === character.id)
    const nextImage = currentCharacter?.baseImage?.trim() || ''
    if (!nextImage || nextImage === previousImage) return

    const saved = await saveProject()
    if (saved === false) {
      throw new Error(`角色 ${currentCharacter?.name || character.name} 图片已生成，但项目保存失败，请查看页面顶部的保存错误提示后重试`)
    }

    recordCharacterHistory(character.id, nextImage, {
      source: 'generated',
      prompt: input?.regenerationPrompt?.trim() || undefined
    })

    if (options.persistHistory !== false) {
      await saveWorkflowMeta()
    }

    const parentCharacter = character.parentCharacterId
      ? characters.value.find(item => item.id === character.parentCharacterId)
      : undefined
    if (parentCharacter?.arkAsset?.status === 'Active') {
      await ingestCharacterToArkVirtualAsset(character.id, { silent: true })
    }
  }

  async function batchGenerateCharacters(
    onProgress?: (current: number, total: number, name: string) => void
  ) {
    const pendingCharacters = characters.value.filter(character => !character.baseImage)
    const total = pendingCharacters.length

    if (total === 0) {
      return { success: true, generated: 0, failed: 0, total: 0 }
    }

    let generated = 0
    let failed = 0
    let historyChanged = false

    for (let index = 0; index < pendingCharacters.length; index += 1) {
      const character = pendingCharacters[index]
      if (!character) continue

      onProgress?.(index + 1, total, character.name)

      try {
        const previousImage = character.baseImage?.trim() || ''
        await generateCharacter(character, undefined, { persistHistory: false })
        if ((character.baseImage?.trim() || '') !== previousImage) {
          historyChanged = true
        }
        generated += 1
      } catch (error) {
        console.error(`[asset-workbench] 角色 ${character.name} 生成失败:`, error)
        failed += 1
      }
    }

    if (historyChanged) {
      await saveWorkflowMeta()
    }

    return { success: true, generated, failed, total }
  }

  return {
    generateCharacter,
    batchGenerateCharacters
  }
}
