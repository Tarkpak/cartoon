import type { Ref } from 'vue'
import type { CharacterVoiceAsset } from '#shared/types/character'
import type { CharacterData } from '~/composables/useAssetWorkbench'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'

/** Reloads voice assets (character voices, narration) attached to the project. */
export function useAssetWorkbenchVoiceAssets(options: {
  projectId: Ref<string | undefined>
  characters: Ref<CharacterData[]>
  propAssets: Ref<PropAsset[]>
}) {
  const { projectId, characters, propAssets } = options

  async function refreshSceneVoiceAssets(input: {
    attempts?: number
    delayMs?: number
  } = {}) {
    const id = projectId.value
    if (!id) return

    const attempts = Math.max(1, input.attempts ?? 1)
    const delayMs = Math.max(200, input.delayMs ?? 1000)
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
      try {
        const response = await $fetch<{
          success: boolean
          data?: {
            script?: {
              assetWorkflow?: {
                props?: Array<{
                  id?: string
                  mediaType?: PropAsset['mediaType']
                  voiceAsset?: CharacterVoiceAsset | null
                }>
              } | null
            } | null
            characters?: Array<{
              id: string
              voiceAsset?: CharacterVoiceAsset | null
            }>
          }
        }>(`/api/project/${id}`)
        if (!response.success || !response.data) return

        let changed = false
        const incomingCharacters = new Map(
          (response.data.characters || []).map(item => [item.id, item.voiceAsset || undefined])
        )
        for (const character of characters.value) {
          if (!incomingCharacters.has(character.id)) continue
          const nextVoiceAsset = incomingCharacters.get(character.id)
          if (JSON.stringify(character.voiceAsset || null) === JSON.stringify(nextVoiceAsset || null)) continue
          character.voiceAsset = nextVoiceAsset
          changed = true
        }

        const incomingProps = new Map(
          (response.data.script?.assetWorkflow?.props || [])
            .filter(prop => !!prop.id)
            .map(prop => [prop.id as string, prop])
        )
        for (const prop of propAssets.value) {
          const incoming = incomingProps.get(prop.id)
          if (!incoming) continue
          const nextVoiceAsset = incoming.voiceAsset || undefined
          if (JSON.stringify(prop.voiceAsset || null) === JSON.stringify(nextVoiceAsset || null)) continue
          prop.voiceAsset = nextVoiceAsset
          if (incoming.mediaType) prop.mediaType = incoming.mediaType
          changed = true
        }

        if (changed) return
      } catch (error) {
        console.warn('[asset-workbench] 刷新场景声音资产失败:', error)
        return
      }
    }
  }

  return {
    refreshSceneVoiceAssets
  }
}
