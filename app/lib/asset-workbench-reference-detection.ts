import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import {
  normalizeToken,
  uniqueSorted
} from '~/lib/asset-workbench-strings'

const NARRATION_SPEAKERS = [
  '旁白',
  'narration',
  'voiceover',
  '画外音',
  'os',
  'vo',
  '内心独白'
]

const SCENE_IMAGE_TAG_REGEX = /\[(?:图片|Image\s*#)\s*\d+\]/giu
const SCENE_QUOTED_DIALOGUE_REGEX = /'[^'\n]*'|"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|『[^』\n]*』/gu
const SCENE_DIALOGUE_SENTENCE_REGEX = /[^。！？!?\n]*(?:说|问|答|喊|道|回应|低语|喃喃|旁白|画外音)\s*[：:][^。！？!?\n]*/gu
const SCENE_TIMELINE_PREFIX_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)\s*[：:]/gmu

export interface SceneCharacterCandidate {
  primaryName: string
  aliases: string[]
  appearance?: string
}

interface ResolveCharacterRefsOptions {
  scene: SceneData
  characters: CharacterData[]
}

interface ResolvePropRefsOptions {
  scene: SceneData
  propAssets: PropAsset[]
  resolveSceneDescriptionWithoutAssetMentions: (description?: string) => string
}

function isNarrationSpeaker(name: string): boolean {
  const normalized = normalizeToken(name)
  if (!normalized) return true

  return NARRATION_SPEAKERS.some(speaker => normalizeToken(speaker) === normalized)
}

function splitCandidateNames(rawName?: string): string[] {
  if (!rawName) return []

  const normalizedRaw = (rawName
    .split(/[:：]/u)[0] || '')
    .replace(/[（(][^）)]*[）)]/gu, ' ')
    .trim()

  return uniqueSorted(
    normalizedRaw
      .split(/[/／|｜、,，\s]+/g)
      .map(name => name.trim())
      .filter(Boolean)
  )
}

function createSceneCharacterCandidate(
  rawName?: string,
  appearance?: string
): SceneCharacterCandidate | null {
  const aliases = splitCandidateNames(rawName).filter(name => !isNarrationSpeaker(name))
  if (aliases.length === 0) return null

  return {
    primaryName: aliases[0] || rawName || '未命名角色',
    aliases,
    appearance: appearance?.trim() || undefined
  }
}

export function findCharacterByNameLike(
  name: string,
  characters: CharacterData[]
): CharacterData | undefined {
  const normalized = normalizeToken(name)
  if (!normalized) return undefined

  let fuzzyMatch: CharacterData | undefined
  for (const character of characters) {
    const target = normalizeToken(character.name)
    if (!target) continue

    if (target === normalized) {
      return character
    }

    const longer = target.length >= normalized.length ? target : normalized
    const shorter = longer === target ? normalized : target
    const lengthGap = longer.length - shorter.length
    const canFuzzyMatch = shorter.length >= 2
      && lengthGap <= 2
      && longer.includes(shorter)

    if (!fuzzyMatch && canFuzzyMatch) {
      fuzzyMatch = character
    }
  }

  return fuzzyMatch
}

function normalizeVisualDescriptionText(description?: string): string {
  if (!description) return ''

  return normalizeToken(
    description
      .replace(SCENE_IMAGE_TAG_REGEX, ' ')
      .replace(SCENE_QUOTED_DIALOGUE_REGEX, ' ')
      .replace(SCENE_DIALOGUE_SENTENCE_REGEX, ' ')
      .replace(SCENE_TIMELINE_PREFIX_REGEX, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function collectDialogueSpeakerNameSet(scene: SceneData): Set<string> {
  const speakerSet = new Set<string>()

  for (const dialogue of scene.dialogues) {
    for (const alias of splitCandidateNames(dialogue.character)) {
      const normalized = normalizeToken(alias)
      if (!normalized || isNarrationSpeaker(alias)) continue
      speakerSet.add(normalized)
    }
  }

  return speakerSet
}

function collectDialogueTextTokens(scene: SceneData): string[] {
  return scene.dialogues
    .map(dialogue => normalizeToken(dialogue.text))
    .filter(Boolean)
}

function hasAliasInTokens(aliases: string[], tokenPool: string[]): boolean {
  if (aliases.length === 0 || tokenPool.length === 0) return false

  for (const alias of aliases) {
    const normalized = normalizeToken(alias)
    if (!normalized) continue

    if (tokenPool.some(token => token.includes(normalized))) {
      return true
    }
  }

  return false
}

function hasAliasInSpeakerSet(aliases: string[], speakerSet: Set<string>): boolean {
  if (aliases.length === 0 || speakerSet.size === 0) return false

  for (const alias of aliases) {
    const normalized = normalizeToken(alias)
    if (!normalized) continue
    if (speakerSet.has(normalized)) return true
  }

  return false
}

export function collectSceneCharacterCandidates(scene: SceneData): SceneCharacterCandidate[] {
  const map = new Map<string, SceneCharacterCandidate>()
  const visualDescriptionToken = normalizeVisualDescriptionText(scene.description)
  const dialogueTextTokens = collectDialogueTextTokens(scene)
  const dialogueSpeakerSet = collectDialogueSpeakerNameSet(scene)

  for (const sceneCharacter of scene.characters) {
    const candidate = createSceneCharacterCandidate(sceneCharacter.name, sceneCharacter.appearance)
    if (!candidate) continue

    const hasVisualMetadata = !!sceneCharacter.appearance?.trim()
      || !!sceneCharacter.emotion?.trim()
    const appearsInDialogueText = hasAliasInTokens(candidate.aliases, dialogueTextTokens)
    const appearsInVisualDescription = hasAliasInTokens(candidate.aliases, [visualDescriptionToken])
    const appearsAsDialogueSpeaker = hasAliasInSpeakerSet(candidate.aliases, dialogueSpeakerSet)
    const mentionedOnlyByDialogue = !hasVisualMetadata
      && !appearsAsDialogueSpeaker
      && appearsInDialogueText
      && !appearsInVisualDescription
    if (mentionedOnlyByDialogue) continue

    const key = normalizeToken(candidate.primaryName)
    if (!key) continue

    const existing = map.get(key)
    if (existing) {
      existing.aliases = uniqueSorted([...existing.aliases, ...candidate.aliases])
      if (!existing.appearance && candidate.appearance) {
        existing.appearance = candidate.appearance
      }
      continue
    }

    map.set(key, candidate)
  }

  for (const dialogue of scene.dialogues) {
    const candidate = createSceneCharacterCandidate(dialogue.character)
    if (!candidate) continue

    const key = normalizeToken(candidate.primaryName)
    if (!key || map.has(key)) continue
    map.set(key, candidate)
  }

  return Array.from(map.values())
}

function getSceneText(
  scene: SceneData,
  resolveSceneDescriptionWithoutAssetMentions: ResolvePropRefsOptions['resolveSceneDescriptionWithoutAssetMentions']
): string {
  return [
    scene.title || '',
    resolveSceneDescriptionWithoutAssetMentions(scene.description),
    scene.narration || '',
    scene.dialogues.map(item => `${item.character}:${item.text}`).join('\n')
  ]
    .join('\n')
    .toLowerCase()
}

export function getValidAssetIdSet(
  characters: CharacterData[],
  environmentAssetIds: string[],
  propAssets: PropAsset[]
): Set<string> {
  return new Set([
    ...characters.map(character => `char:${character.id}`),
    ...environmentAssetIds,
    ...propAssets.map(prop => `prop:${prop.id}`)
  ])
}

export function resolveCharacterRefsFromScene(
  options: ResolveCharacterRefsOptions
): { refs: string[], matchedCharacterNames: string[] } {
  const refs = new Set<string>()
  const matchedCharacterNames = new Set<string>()

  const candidates = collectSceneCharacterCandidates(options.scene)
  for (const candidate of candidates) {
    let matched: CharacterData | undefined

    for (const alias of candidate.aliases) {
      matched = findCharacterByNameLike(alias, options.characters)
      if (matched) break
    }

    if (!matched) {
      matched = findCharacterByNameLike(candidate.primaryName, options.characters)
    }

    if (!matched) continue

    refs.add(`char:${matched.id}`)
    matchedCharacterNames.add(matched.name)
  }

  return {
    refs: Array.from(refs),
    matchedCharacterNames: Array.from(matchedCharacterNames)
  }
}

export function resolvePropRefsFromScene(options: ResolvePropRefsOptions): string[] {
  if (options.propAssets.length === 0) return []

  const sceneText = getSceneText(
    options.scene,
    options.resolveSceneDescriptionWithoutAssetMentions
  )

  return options.propAssets
    .filter((prop) => {
      const name = prop.name.trim().toLowerCase()
      if (name.length < 2) return false
      return sceneText.includes(name)
    })
    .map(prop => `prop:${prop.id}`)
}

export function sceneHasSameLocation(currentScene: SceneData, previousScene?: SceneData): boolean {
  if (!previousScene) return false
  const current = normalizeToken(currentScene.setting?.location)
  const previous = normalizeToken(previousScene.setting?.location)
  return !!current && current === previous
}
