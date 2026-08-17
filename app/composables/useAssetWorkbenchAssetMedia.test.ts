import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, watch } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import type { EnvironmentAssetCard, EnvironmentPanoramaState } from '~/lib/asset-workbench-types'
import { useAssetWorkbenchAssetMedia } from './useAssetWorkbenchAssetMedia'

const { uploadAudioFileMock, uploadImageFileMock } = vi.hoisted(() => ({
  uploadAudioFileMock: vi.fn(),
  uploadImageFileMock: vi.fn()
}))

vi.mock('~/lib/asset-workbench-upload', () => ({
  resetFileInput: vi.fn(),
  uploadAudioFile: uploadAudioFileMock,
  uploadImageFile: uploadImageFileMock
}))

function createScene(input: Partial<SceneData> & Pick<SceneData, 'id' | 'title' | 'description'>): SceneData {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    characters: input.characters || [],
    narration: input.narration,
    duration: input.duration || 8,
    setting: input.setting,
    active: input.active ?? false,
    shotType: input.shotType,
    cameraMovement: input.cameraMovement,
    cameraNote: input.cameraNote,
    transitionIn: input.transitionIn,
    transitionOut: input.transitionOut,
    transitionDuration: input.transitionDuration,
    firstFrame: input.firstFrame,
    lastFrame: input.lastFrame,
    videoUrl: input.videoUrl,
    videoHistory: input.videoHistory,
    referenceError: input.referenceError,
    videoError: input.videoError,
    referenceStatus: input.referenceStatus || 'pending',
    videoStatus: input.videoStatus || 'pending'
  }
}

function createFileChangeEvent(file: File): Event {
  const input = {
    files: [file],
    value: 'env.png'
  } as unknown as HTMLInputElement
  return { target: input } as unknown as Event
}

describe('useAssetWorkbenchAssetMedia environment upload', () => {
  const testGlobal = globalThis as typeof globalThis & {
    computed?: unknown
    ref?: unknown
    watch?: unknown
    useToast?: unknown
  }
  const originalGlobals: Partial<Record<'computed' | 'ref' | 'watch' | 'useToast', unknown>> = {}
  const hadOriginalGlobal: Partial<Record<'computed' | 'ref' | 'watch' | 'useToast', boolean>> = {}
  const toastSuccess = vi.fn()
  const toastError = vi.fn()

  beforeEach(() => {
    for (const key of ['computed', 'ref', 'watch', 'useToast'] as const) {
      hadOriginalGlobal[key] = Object.prototype.hasOwnProperty.call(testGlobal, key)
      originalGlobals[key] = testGlobal[key]
    }
    testGlobal.computed = computed
    testGlobal.ref = ref
    testGlobal.watch = watch
    testGlobal.useToast = () => ({
      toast: {
        success: toastSuccess,
        warning: vi.fn(),
        error: toastError
      }
    })

    toastSuccess.mockReset()
    toastError.mockReset()
    uploadImageFileMock.mockReset()
    uploadImageFileMock.mockResolvedValue('https://example.com/env-uploaded.png')
    uploadAudioFileMock.mockReset()
    uploadAudioFileMock.mockResolvedValue('https://example.com/uploaded-voice.mp3')

    // Avoid real image decoding while still exercising the non-panorama path.
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn()
    })
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => {
          this.width = 1280
          this.height = 720
          this.onload?.()
        })
      }
      width = 0
      height = 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of ['computed', 'ref', 'watch', 'useToast'] as const) {
      if (hadOriginalGlobal[key]) {
        testGlobal[key] = originalGlobals[key]
      } else {
        delete testGlobal[key]
      }
    }
  })

  it('writes a generated prop image to the current asset after workflow re-hydration', async () => {
    const originalProp: PropAsset = {
      id: 'prop_1',
      name: '打火机',
      description: '银灰色金属打火机',
      category: 'prop'
    }
    const hydratedProp = { ...originalProp }
    const propAssets = ref<PropAsset[]>([originalProp])
    const saveWorkflowMeta = vi.fn(async () => undefined)
    const fetchMock = vi.fn(async () => {
      propAssets.value = [hydratedProp]
      return {
        success: true,
        imageUrl: 'https://example.com/generated-prop.png'
      }
    })
    vi.stubGlobal('$fetch', fetchMock)

    const media = useAssetWorkbenchAssetMedia({
      maxAssetUploadSize: 10 * 1024 * 1024,
      maxVoiceUploadSize: 10 * 1024 * 1024,
      statusError: ref<string | null>(null),
      scenes: ref<SceneData[]>([]),
      characters: ref<CharacterData[]>([]),
      propAssets,
      workflowStylePrompt: ref('3D 国创'),
      saveProject: vi.fn(async () => true),
      saveWorkflowMeta,
      resolveUiError: error => error instanceof Error ? error.message : 'error',
      synchronizeQueueItems: vi.fn(),
      resolveSceneReferenceImage: () => undefined,
      resolveEnvironmentCard: () => undefined,
      resolveEnvironmentRepresentativeScene: () => undefined,
      generateSceneBaseline: vi.fn(async () => undefined)
    })

    const imageUrl = await media.generatePropImage('prop_1')

    expect(imageUrl).toBe('https://example.com/generated-prop.png')
    expect(originalProp.referenceImage).toBeUndefined()
    expect(hydratedProp.referenceImage).toBe(imageUrl)
    expect(saveWorkflowMeta).toHaveBeenCalledTimes(1)
  })

  it('writes uploaded character and narration voices to current assets after re-hydration', async () => {
    const originalCharacter: CharacterData = {
      id: 'char_1',
      name: '主角',
      appearance: '黑色风衣',
      role: 'protagonist',
      generating: false,
      generatingViews: false
    }
    const currentCharacter = { ...originalCharacter }
    const originalNarration: PropAsset = {
      id: 'voice_1',
      name: '旁白',
      description: '旁白音色',
      category: 'other',
      mediaType: 'voice'
    }
    const currentNarration = { ...originalNarration }
    const characters = ref<CharacterData[]>([originalCharacter])
    const propAssets = ref<PropAsset[]>([originalNarration])
    const saveProject = vi.fn(async () => true)
    const saveWorkflowMeta = vi.fn(async () => undefined)
    uploadAudioFileMock
      .mockImplementationOnce(async () => {
        characters.value = [currentCharacter]
        return 'https://example.com/character-voice.mp3'
      })
      .mockImplementationOnce(async () => {
        propAssets.value = [currentNarration]
        return 'https://example.com/narration-voice.mp3'
      })

    const media = useAssetWorkbenchAssetMedia({
      maxAssetUploadSize: 10 * 1024 * 1024,
      maxVoiceUploadSize: 10 * 1024 * 1024,
      statusError: ref<string | null>(null),
      scenes: ref<SceneData[]>([]),
      characters,
      propAssets,
      workflowStylePrompt: ref(''),
      saveProject,
      saveWorkflowMeta,
      resolveUiError: error => error instanceof Error ? error.message : 'error',
      synchronizeQueueItems: vi.fn(),
      resolveSceneReferenceImage: () => undefined,
      resolveEnvironmentCard: () => undefined,
      resolveEnvironmentRepresentativeScene: () => undefined,
      generateSceneBaseline: vi.fn(async () => undefined)
    })

    await media.handleCharacterVoiceUpload(
      originalCharacter.id,
      createFileChangeEvent(new File(['voice'], 'voice.mp3', { type: 'audio/mpeg' }))
    )
    await media.handlePropVoiceUpload(
      originalNarration.id,
      createFileChangeEvent(new File(['voice'], 'narration.mp3', { type: 'audio/mpeg' }))
    )

    expect(originalCharacter.voiceAsset).toBeUndefined()
    expect(currentCharacter.voiceAsset?.audioUrl).toBe('https://example.com/character-voice.mp3')
    expect(originalNarration.voiceAsset).toBeUndefined()
    expect(currentNarration.voiceAsset?.audioUrl).toBe('https://example.com/narration-voice.mp3')
    expect(saveProject).toHaveBeenCalledTimes(1)
    expect(saveWorkflowMeta).toHaveBeenCalledTimes(1)
  })

  it('writes uploaded character and prop images to current assets after re-hydration', async () => {
    const originalCharacter: CharacterData = {
      id: 'char_1',
      name: '主角',
      appearance: '黑色风衣',
      role: 'protagonist',
      generating: false,
      generatingViews: false
    }
    const currentCharacter = { ...originalCharacter }
    const originalProp: PropAsset = {
      id: 'prop_1',
      name: '打火机',
      description: '银灰色金属打火机',
      category: 'prop'
    }
    const currentProp = { ...originalProp }
    const characters = ref<CharacterData[]>([originalCharacter])
    const propAssets = ref<PropAsset[]>([originalProp])
    const saveProject = vi.fn(async () => true)
    const saveWorkflowMeta = vi.fn(async () => undefined)
    uploadImageFileMock
      .mockImplementationOnce(async () => {
        characters.value = [currentCharacter]
        return 'https://example.com/character.png'
      })
      .mockImplementationOnce(async () => {
        propAssets.value = [currentProp]
        return 'https://example.com/prop.png'
      })

    const media = useAssetWorkbenchAssetMedia({
      maxAssetUploadSize: 10 * 1024 * 1024,
      maxVoiceUploadSize: 10 * 1024 * 1024,
      statusError: ref<string | null>(null),
      scenes: ref<SceneData[]>([]),
      characters,
      propAssets,
      workflowStylePrompt: ref(''),
      saveProject,
      saveWorkflowMeta,
      resolveUiError: error => error instanceof Error ? error.message : 'error',
      synchronizeQueueItems: vi.fn(),
      resolveSceneReferenceImage: () => undefined,
      resolveEnvironmentCard: () => undefined,
      resolveEnvironmentRepresentativeScene: () => undefined,
      generateSceneBaseline: vi.fn(async () => undefined)
    })

    await media.handleCharacterImageUpload(
      originalCharacter.id,
      createFileChangeEvent(new File(['image'], 'character.png', { type: 'image/png' }))
    )
    await media.handlePropImageUpload(
      originalProp.id,
      createFileChangeEvent(new File(['image'], 'prop.png', { type: 'image/png' }))
    )

    expect(originalCharacter.baseImage).toBeUndefined()
    expect(currentCharacter.baseImage).toBe('https://example.com/character.png')
    expect(originalProp.referenceImage).toBeUndefined()
    expect(currentProp.referenceImage).toBe('https://example.com/prop.png')
    expect(saveProject).toHaveBeenCalledTimes(1)
    expect(saveWorkflowMeta).toHaveBeenCalledTimes(1)
  })

  it('saves workflow meta before project and rejects save failures', async () => {
    const scene = createScene({
      id: 'scene_1',
      title: '医院走廊',
      description: '夜色中的医院走廊',
      setting: {
        location: '医院-走廊',
        timeOfDay: '夜晚'
      }
    })
    const scenes = ref<SceneData[]>([scene])
    const saveOrder: string[] = []
    const saveWorkflowMeta = vi.fn(async () => {
      saveOrder.push('meta')
    })
    const saveProject = vi.fn(async () => {
      saveOrder.push('project')
      return false
    })
    const recordEnvironmentHistory = vi.fn()
    const setEnvironmentPanoramaState = vi.fn()
    const asset: EnvironmentAssetCard = {
      id: 'env:医院-走廊||夜晚',
      name: '医院-走廊 / 夜晚',
      sceneIds: ['scene_1'],
      sceneTitles: ['医院走廊'],
      representativeSceneId: 'scene_1',
      referenceStatus: 'pending'
    }

    const media = useAssetWorkbenchAssetMedia({
      maxAssetUploadSize: 10 * 1024 * 1024,
      maxVoiceUploadSize: 10 * 1024 * 1024,
      statusError: ref<string | null>(null),
      scenes,
      characters: ref<CharacterData[]>([]),
      propAssets: ref<PropAsset[]>([]),
      workflowStylePrompt: ref(''),
      saveProject,
      saveWorkflowMeta,
      resolveUiError: error => error instanceof Error ? error.message : 'error',
      synchronizeQueueItems: vi.fn(),
      resolveSceneReferenceImage: current => current.firstFrame,
      resolveEnvironmentCard: id => (id === asset.id ? asset : undefined),
      resolveEnvironmentRepresentativeScene: () => scene,
      recordEnvironmentHistory,
      setEnvironmentPanoramaState,
      generateSceneBaseline: vi.fn(async () => undefined)
    })

    await media.handleEnvironmentImageUpload(
      asset.id,
      createFileChangeEvent(new File(['env'], 'env.png', { type: 'image/png' }))
    )

    expect(uploadImageFileMock).toHaveBeenCalledTimes(1)
    expect(scene.firstFrame).toBe('https://example.com/env-uploaded.png')
    expect(recordEnvironmentHistory).toHaveBeenCalledWith(
      asset.id,
      'https://example.com/env-uploaded.png',
      { source: 'uploaded' }
    )
    expect(setEnvironmentPanoramaState).toHaveBeenCalledWith(asset.id, {
      singleViewImage: 'https://example.com/env-uploaded.png'
    })
    expect(saveOrder).toEqual(['meta', 'project'])
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(
      '环境图片上传失败',
      expect.objectContaining({
        description: expect.stringContaining('项目保存失败')
      })
    )
  })

  it('persists plan-only environment uploads via history and panorama state', async () => {
    const scenes = ref<SceneData[]>([])
    const saveWorkflowMeta = vi.fn(async () => undefined)
    const saveProject = vi.fn(async () => true)
    const recordEnvironmentHistory = vi.fn()
    const setEnvironmentPanoramaState = vi.fn()
    const asset: EnvironmentAssetCard = {
      id: 'env:医院-走廊||夜晚',
      name: '医院-走廊 / 夜晚',
      sceneIds: ['plan:episode_1'],
      sceneTitles: ['第1集（目录）'],
      representativeSceneId: '',
      referenceStatus: 'pending'
    }

    const media = useAssetWorkbenchAssetMedia({
      maxAssetUploadSize: 10 * 1024 * 1024,
      maxVoiceUploadSize: 10 * 1024 * 1024,
      statusError: ref<string | null>(null),
      scenes,
      characters: ref<CharacterData[]>([]),
      propAssets: ref<PropAsset[]>([]),
      workflowStylePrompt: ref(''),
      saveProject,
      saveWorkflowMeta,
      resolveUiError: error => error instanceof Error ? error.message : 'error',
      synchronizeQueueItems: vi.fn(),
      resolveSceneReferenceImage: current => current.firstFrame,
      resolveEnvironmentCard: id => (id === asset.id ? asset : undefined),
      resolveEnvironmentRepresentativeScene: () => undefined,
      recordEnvironmentHistory,
      setEnvironmentPanoramaState,
      generateSceneBaseline: vi.fn(async () => undefined)
    })

    await media.handleEnvironmentImageUpload(
      asset.id,
      createFileChangeEvent(new File(['env'], 'env.png', { type: 'image/png' }))
    )

    expect(recordEnvironmentHistory).toHaveBeenCalledWith(
      asset.id,
      'https://example.com/env-uploaded.png',
      { source: 'uploaded' }
    )
    expect(setEnvironmentPanoramaState).toHaveBeenCalledWith(asset.id, {
      singleViewImage: 'https://example.com/env-uploaded.png'
    } satisfies EnvironmentPanoramaState)
    expect(saveWorkflowMeta).toHaveBeenCalledTimes(1)
    expect(saveProject).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith(
      '环境图片上传成功（已写入素材历史，重新进入项目后可恢复）'
    )
    expect(toastError).not.toHaveBeenCalled()
  })
})
