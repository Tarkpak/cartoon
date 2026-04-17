import type { SceneData } from '~/composables/useAssetWorkbench'

export function mergeNarrationTexts(...parts: Array<string | null | undefined>): string | undefined {
  const merged = parts
    .map(part => part?.trim())
    .filter((part): part is string => !!part)

  if (merged.length === 0) return undefined
  return Array.from(new Set(merged)).join('\n\n')
}

export function splitNarrationText(narration?: string | null): [string | undefined, string | undefined] {
  if (!narration?.trim()) return [undefined, undefined]

  const segments = narration
    .split(/(?<=[。！？.!?])/g)
    .map(segment => segment.trim())
    .filter(Boolean)

  if (segments.length <= 1) {
    return [narration.trim(), undefined]
  }

  const mid = Math.ceil(segments.length / 2)
  return [
    segments.slice(0, mid).join(''),
    segments.slice(mid).join('')
  ]
}

export function resetSceneGenerationState(scene: SceneData): SceneData {
  return {
    ...scene,
    firstFrame: undefined,
    lastFrame: undefined,
    videoUrl: undefined,
    frameError: undefined,
    videoError: undefined,
    frameStatus: 'pending',
    videoStatus: 'pending',
    storyboardStatus: 'pending',
    sceneVisualStatus: 'pending',
    storyboard: undefined,
    sceneVisual: undefined
  }
}

export function deleteSceneFromList(
  scenes: SceneData[],
  sceneId: string
): SceneData[] {
  const index = scenes.findIndex(scene => scene.id === sceneId)
  if (index < 0) return scenes

  const nextScenes = scenes.slice()
  const [removedScene] = nextScenes.splice(index, 1)

  if (removedScene?.active && nextScenes[0]) {
    nextScenes[0].active = true
  }

  return nextScenes
}

export function updateSceneInList(
  scenes: SceneData[],
  updatedScene: Partial<SceneData> & { id: string }
): SceneData[] {
  const sceneIndex = scenes.findIndex(scene => scene.id === updatedScene.id)
  if (sceneIndex < 0) return scenes

  const existingScene = scenes[sceneIndex]
  if (!existingScene) return scenes

  const nextScene = {
    ...existingScene,
    ...updatedScene
  }

  const nextScenes = scenes.slice()
  nextScenes[sceneIndex] = existingScene.description !== nextScene.description
    ? resetSceneGenerationState(nextScene)
    : nextScene

  return nextScenes
}

export function mergeScenesInList(
  scenes: SceneData[],
  sceneIndex: number
): SceneData[] | null {
  if (sceneIndex >= scenes.length - 1) {
    return null
  }

  const currentScene = scenes[sceneIndex]
  const nextScene = scenes[sceneIndex + 1]
  if (!currentScene || !nextScene) return null

  const mergedCharacters = [...currentScene.characters]
  for (const character of nextScene.characters) {
    if (!mergedCharacters.find(item => item.name === character.name)) {
      mergedCharacters.push(character)
    }
  }

  const mergedScene = resetSceneGenerationState({
    ...currentScene,
    id: currentScene.id,
    title: `${currentScene.title} + ${nextScene.title}`,
    description: `${currentScene.description}\n\n${nextScene.description}`,
    characters: mergedCharacters,
    dialogues: [...currentScene.dialogues, ...nextScene.dialogues],
    narration: mergeNarrationTexts(currentScene.narration, nextScene.narration),
    duration: currentScene.duration + nextScene.duration,
    setting: currentScene.setting || nextScene.setting,
    active: currentScene.active || nextScene.active,
    shotType: currentScene.shotType || nextScene.shotType,
    cameraMovement: currentScene.cameraMovement || nextScene.cameraMovement,
    cameraNote: [currentScene.cameraNote, nextScene.cameraNote].filter(Boolean).join('；') || undefined,
    transitionIn: currentScene.transitionIn || 'cut',
    transitionOut: nextScene.transitionOut || currentScene.transitionOut || 'cut',
    transitionDuration: nextScene.transitionDuration ?? currentScene.transitionDuration ?? 0.5
  })

  const nextScenes = scenes.slice()
  nextScenes.splice(sceneIndex, 2, mergedScene)
  return nextScenes
}

export function splitSceneInList(
  scenes: SceneData[],
  sceneIndex: number
): SceneData[] | null {
  const scene = scenes[sceneIndex]
  if (!scene) return null

  const sentences = scene.description.split(/(?<=[。！？.!?])/g).filter(item => item.trim())
  if (sentences.length < 2) {
    return null
  }

  const midPoint = Math.ceil(sentences.length / 2)
  const firstHalf = sentences.slice(0, midPoint).join('')
  const secondHalf = sentences.slice(midPoint).join('')
  const dialogueMidPoint = Math.ceil(scene.dialogues.length / 2)
  const [firstNarration, secondNarration] = splitNarrationText(scene.narration)

  const firstScene = resetSceneGenerationState({
    ...scene,
    id: scene.id,
    title: `${scene.title} (上)`,
    description: firstHalf,
    dialogues: scene.dialogues.slice(0, dialogueMidPoint),
    narration: firstNarration,
    duration: Math.ceil(scene.duration / 2),
    active: scene.active
  })

  const secondScene = resetSceneGenerationState({
    ...scene,
    id: `scene_${Date.now()}`,
    title: `${scene.title} (下)`,
    description: secondHalf,
    dialogues: scene.dialogues.slice(dialogueMidPoint),
    narration: secondNarration,
    duration: Math.max(1, Math.floor(scene.duration / 2)),
    active: false
  })

  const nextScenes = scenes.slice()
  nextScenes.splice(sceneIndex, 1, firstScene, secondScene)
  return nextScenes
}
