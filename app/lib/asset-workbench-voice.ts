import type { CharacterData, SceneData } from './asset-workbench-models'
import type { SceneVoiceReferenceSummary } from './asset-workbench-types'

type VoiceCharacterLike = Pick<CharacterData, 'id' | 'name' | 'voiceAsset'>
type VoiceSceneLike = Pick<SceneData, 'dialogues'>

function normalizeSpeakerName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s"'“”‘’\-_.:：]/g, '')
}

function resolveCharacterBySpeakerName(
  speakerName: string,
  characters: VoiceCharacterLike[]
): VoiceCharacterLike | null {
  const normalizedSpeaker = normalizeSpeakerName(speakerName)
  if (!normalizedSpeaker) return null

  const exact = characters.find(item => normalizeSpeakerName(item.name) === normalizedSpeaker)
  if (exact) return exact

  return characters.find((item) => {
    const normalizedName = normalizeSpeakerName(item.name)
    return normalizedName.includes(normalizedSpeaker) || normalizedSpeaker.includes(normalizedName)
  }) || null
}

function resolveVoiceAssetSource(character: VoiceCharacterLike): 'manual' | 'auto' {
  if (character.voiceAsset?.sourceSceneId || character.voiceAsset?.sourceTaskId) {
    return 'auto'
  }

  return 'manual'
}

export function resolveSceneVoiceReferenceSummary(options: {
  scene: VoiceSceneLike
  characters: VoiceCharacterLike[]
}): SceneVoiceReferenceSummary {
  const speakerNames = new Set<string>()
  const seenCharacterIds = new Set<string>()
  const matchedCharacters: SceneVoiceReferenceSummary['characters'] = []

  for (const dialogue of options.scene.dialogues || []) {
    const normalizedSpeaker = normalizeSpeakerName(dialogue.character || '')
    if (normalizedSpeaker) {
      speakerNames.add(normalizedSpeaker)
    }

    const character = resolveCharacterBySpeakerName(dialogue.character || '', options.characters)
    if (!character || seenCharacterIds.has(character.id) || !character.voiceAsset?.audioUrl) continue

    seenCharacterIds.add(character.id)
    matchedCharacters.push({
      id: character.id,
      name: character.name,
      locked: character.voiceAsset.locked === true,
      source: resolveVoiceAssetSource(character)
    })
  }

  if (matchedCharacters.length === 0) {
    return {
      hasDialogue: speakerNames.size > 0,
      mode: 'none',
      characters: []
    }
  }

  return {
    hasDialogue: speakerNames.size > 0,
    mode: speakerNames.size === 1 && matchedCharacters.length === 1 ? 'explicit_audio' : 'prompt_only',
    characters: matchedCharacters
  }
}
