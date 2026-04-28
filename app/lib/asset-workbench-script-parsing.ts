import { mergeNarrationTexts } from '~/lib/asset-workbench-scenes'
import { normalizeCharacterName } from '~/lib/asset-workbench-values'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'

const NARRATION_SPEAKER_SET = new Set([
  '旁白',
  'narration',
  'voiceover',
  '画外音',
  'os',
  'vo',
  '内心独白'
].map(name => normalizeCharacterName(name)))

interface ParsedScriptScene {
  id: string
  episodeId?: string
  episodeTitle?: string
  episodeIndex?: number
  title?: string
  shotType?: SceneData['shotType']
  cameraMovement?: SceneData['cameraMovement']
  description: string
  characters: Array<{ name: string, appearance?: string, emotion?: string }>
  dialogues?: Array<{ character: string, text: string, emotion?: string }>
  narration?: string | null
  duration: number
  setting?: { location: string, timeOfDay: string, era?: string, mood?: string, weather?: string }
}

interface ParsedScriptCharacter {
  name: string
  description?: string
  role?: string
}

export function buildParsedScenes(options: {
  scenes: ParsedScriptScene[]
  descriptionFormat?: 'visual' | 'timeline'
}): SceneData[] {
  return options.scenes.map((scene, index) => {
    const normalizedDescription = (scene.description || '').trim()
    const dialogues = scene.dialogues || []
    const normalizedDialogues = dialogues.filter((dialogue) => {
      return !NARRATION_SPEAKER_SET.has(normalizeCharacterName(dialogue.character))
    })

    const narrationFromDialogues = dialogues
      .filter((dialogue) => {
        return NARRATION_SPEAKER_SET.has(normalizeCharacterName(dialogue.character))
      })
      .map(dialogue => dialogue.text?.trim())
      .filter((text): text is string => !!text)
      .join('\n')

    return {
      id: scene.id || `scene_${index + 1}`,
      episodeId: scene.episodeId,
      episodeTitle: scene.episodeTitle,
      episodeIndex: scene.episodeIndex,
      title: scene.title || `${scene.setting?.location || '场景'} - ${scene.setting?.timeOfDay || ''}`,
      description: options.descriptionFormat === 'timeline'
        ? normalizedDescription
        : scene.description,
      characters: scene.characters || [],
      dialogues: normalizedDialogues,
      narration: mergeNarrationTexts(scene.narration, narrationFromDialogues),
      duration: scene.duration || 8,
      setting: scene.setting,
      active: index === 0,
      shotType: scene.shotType || 'medium',
      cameraMovement: scene.cameraMovement || 'static',
      cameraNote: '',
      transitionIn: 'cut',
      transitionOut: 'cut',
      transitionDuration: 0.5,
      referenceError: undefined,
      videoError: undefined,
      referenceStatus: 'pending',
      videoStatus: 'pending'
    }
  })
}

export function buildParsedCharacters(
  parsedCharacters: ParsedScriptCharacter[] | undefined,
  scenes: SceneData[]
): CharacterData[] {
  const sceneCharacterNames = new Set<string>()
  scenes.forEach((scene) => {
    scene.characters.forEach((character) => {
      if (character.name.trim()) {
        sceneCharacterNames.add(character.name)
      }
    })
  })

  if (parsedCharacters && parsedCharacters.length > 0) {
    return parsedCharacters.map((character, index) => ({
      id: `char_${index + 1}`,
      name: character.name,
      appearance: character.description || '',
      role: character.role || 'supporting',
      generating: false,
      generatingViews: false
    }))
  }

  return Array.from(sceneCharacterNames).map((name, index) => {
    const sceneCharacter = scenes
      .flatMap(scene => scene.characters)
      .find(character => character.name === name)

    return {
      id: `char_${index + 1}`,
      name,
      appearance: sceneCharacter?.appearance || '',
      role: 'supporting',
      generating: false,
      generatingViews: false
    }
  })
}
