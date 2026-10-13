import type { CharacterData, SceneData } from './asset-workbench-models'
import type { SceneVoiceReferenceSummary } from './asset-workbench-types'

type VoiceCharacterLike = Pick<CharacterData, 'id' | 'name' | 'voiceAsset'>
type VoiceSceneLike = Pick<SceneData, 'description'> & Partial<Pick<SceneData, 'characters'>>

const NON_SPEAKER_LABELS = new Set([
  '场景功能',
  '情绪定位',
  '镜头设计',
  '声音设计',
  '台词节奏',
  '表演关键点',
  '对白',
  '对话',
  '台词',
  '旁白',
  '画外音'
])

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

function normalizeSpeakerCandidate(value: string): string {
  return value
    .replace(/^\s*[-*•]\s*/u, '')
    .replace(/^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)?\s*[：:]\s*/u, '')
    .replace(/["'“”‘’「」『』]/gu, '')
    .trim()
}

function extractDialogueSpeakers(description?: string): string[] {
  if (!description?.trim()) return []

  const speakers = new Set<string>()
  for (const line of description.split('\n')) {
    const normalizedLine = line.trim()
    if (!normalizedLine) continue

    const saidMatch = normalizedLine.match(/([\p{Script=Han}A-Za-z0-9_·]{1,16})\s*(?:说|问|喊|答|道|回应|低语|喃喃)\s*[：:]/u)
    const directMatch = normalizedLine.match(/^\s*[-*•]?\s*([^：:\n]{1,16})\s*[：:]/u)
    const speaker = normalizeSpeakerCandidate(saidMatch?.[1] || directMatch?.[1] || '')
    if (!speaker || NON_SPEAKER_LABELS.has(speaker) || speaker.includes('秒')) continue
    speakers.add(speaker)
  }

  return Array.from(speakers)
}

export function resolveSceneVoiceReferenceSummary(options: {
  scene: VoiceSceneLike
  characters: VoiceCharacterLike[]
  supportsExplicitAudioReference?: boolean
}): SceneVoiceReferenceSummary {
  const seenCharacterIds = new Set<string>()
  const matchedCharacters: SceneVoiceReferenceSummary['characters'] = []

  const dialogueSpeakers = extractDialogueSpeakers(options.scene.description)
  const sceneCharacters = options.scene.characters || []
  const speakers = dialogueSpeakers.length > 0
    ? dialogueSpeakers
    : sceneCharacters.map(character => character.name)

  for (const speaker of speakers) {
    const sceneCharacter = sceneCharacters.find(item => normalizeSpeakerName(item.name) === normalizeSpeakerName(speaker))
    const assetId = sceneCharacter?.assetId?.replace(/^char:/, '')
    const character = assetId
      ? options.characters.find(item => item.id === assetId)
      : resolveCharacterBySpeakerName(speaker, options.characters)
    if (!character || seenCharacterIds.has(character.id) || !character.voiceAsset?.audioUrl?.trim()) continue

    seenCharacterIds.add(character.id)
    matchedCharacters.push({
      id: character.id,
      name: character.name,
      audioUrl: character.voiceAsset.audioUrl.trim(),
      locked: character.voiceAsset.locked === true,
      source: resolveVoiceAssetSource(character)
    })
  }

  if (matchedCharacters.length === 0) {
    return {
      hasDialogue: dialogueSpeakers.length > 0,
      mode: 'none',
      characters: []
    }
  }

  return {
    hasDialogue: dialogueSpeakers.length > 0,
    mode:
      matchedCharacters.length === 1
      && options.supportsExplicitAudioReference !== false
        ? 'explicit_audio'
        : 'prompt_only',
    characters: matchedCharacters
  }
}
