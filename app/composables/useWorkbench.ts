/**
 * Workbench 工作台共享状态和逻辑
 * 提供场景、角色等核心功能
 */

// 类型从 shared/types 自动导入
import type { Storyboard, ShotType, CameraMovement } from '#shared/types/storyboard'
import type { SceneVisual } from '#shared/types/scene-visual'
import type { CharacterView } from '#shared/types/character'
import type { StoryOutline, CharacterRelationship } from '#shared/types/outline'
import type { SelectedModels } from '#shared/types/provider'
import { getStyleById } from '#shared/types/styles'

// 转场效果（扩展 video.ts 中的基础类型）
export type WorkbenchTransitionType = 'cut' | 'fade' | 'dissolve' | 'wipe' | 'slide' | 'zoom' | 'blur' | 'flash' | 'none'

// 场景数据接口
export interface SceneData {
  id: string
  title: string
  description: string
  characters: Array<{ name: string, appearance?: string, emotion?: string }>
  dialogues: Array<{ character: string, text: string, emotion?: string }>
  narration?: string
  duration: number
  setting?: { location: string, timeOfDay: string, mood?: string, weather?: string }
  active: boolean
  // 镜头语言设置
  shotType?: ShotType
  cameraMovement?: CameraMovement
  cameraNote?: string
  // 转场设置
  transitionIn?: WorkbenchTransitionType
  transitionOut?: WorkbenchTransitionType
  transitionDuration?: number
  // 生成状态
  firstFrame?: string
  lastFrame?: string
  videoUrl?: string
  frameError?: string
  videoError?: string
  frameStatus: 'pending' | 'generating' | 'done' | 'error'
  videoStatus: 'pending' | 'generating' | 'done' | 'error'
  // 分镜和场景视觉
  storyboard?: Storyboard
  storyboardStatus: 'pending' | 'generating' | 'done' | 'error'
  sceneVisual?: SceneVisual
  sceneVisualStatus: 'pending' | 'generating' | 'done' | 'error'
}

// 角色数据接口 - 增强版
export interface CharacterData {
  id: string
  name: string
  appearance: string
  role: string
  baseImage?: string
  expressions?: Record<string, string>
  views?: Partial<Record<CharacterView, string>>
  generating: boolean
  generatingViews: boolean
  // 性格与背景
  personality?: string
  traits?: string[]
  background?: string
  motivation?: string
  // 说话风格
  speakingStyle?: string
  catchphrase?: string
  voiceTone?: string
  // 基本信息
  age?: number
  gender?: string
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
}

function toOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const normalized = value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
  return normalized.length > 0 ? normalized : undefined
}

function getDisplayErrorMessage(error: unknown, fallback: string): string {
  const payload = error as {
    data?: { message?: string }
    statusMessage?: string
    message?: string
  }

  return payload?.data?.message
    || payload?.statusMessage
    || payload?.message
    || fallback
}

// 流水线状态接口
export interface PipelineStatus {
  running: boolean
  taskId?: string
  progress: number
  currentStep: string
  error?: string
}

// 批量状态接口
export interface BatchStatus {
  running: boolean
  current: number
  total: number
}

export function useWorkbench() {
  const route = useRoute()
  const router = useRouter()

  // ========== 项目基础信息 ==========
  const projectId = computed(() => route.query.project as string | undefined)
  const projectName = ref('新项目')
  const projectDescription = ref('')
  // 故事创意（用于生成大纲，简短的概念描述）
  const storyIdea = ref('')
  // 小说原文（用于直接解析场景，详细的文本内容）
  const novelText = ref('')
  const saving = ref(false)
  const saveError = ref<string | null>(null)
  const loading = ref(false)

  // ========== 场景数据 ==========
  const scenes = ref<SceneData[]>([])
  const parsing = ref(false)

  // ========== 故事大纲 (新增) ==========
  const outline = ref<StoryOutline | null>(null)
  const generatingOutline = ref(false)

  // ========== 角色数据 ==========
  const characters = ref<CharacterData[]>([])

  // ========== 角色关系 (新增) ==========
  const relationships = ref<CharacterRelationship[]>([])

  // ========== 工作流步骤 (新增) ==========
  const currentStep = ref<'outline' | 'characters' | 'script' | 'video'>('outline')

  // ========== 输入模式 (新增) ==========
  // 'idea' 从创意生成大纲，'script' 直接输入剧本文本
  const inputMode = ref<'idea' | 'script'>('script')

  // ========== 风格选择 ==========
  const selectedStyleId = ref<string>('')

  // ========== 模型选择 ==========
  const selectedModels = ref<SelectedModels>({
    text: 'qwen-flash',
    image: 'wan2.6-t2i',
    video: 'wan2.6-t2v',
    tts: 'qwen3-tts-instruct-flash'
  })

  // ========== 流水线状态 ==========
  const pipelineStatus = ref<PipelineStatus>({
    running: false,
    progress: 0,
    currentStep: ''
  })

  // ========== 批量状态 ==========
  const batchFrameStatus = ref<BatchStatus>({
    running: false,
    current: 0,
    total: 0
  })

  const batchVideoStatus = ref<BatchStatus>({
    running: false,
    current: 0,
    total: 0
  })

  // ========== 计算属性 ==========
  const selectedScene = computed(() => scenes.value.find(s => s.active))

  // 获取当前选中风格的提示词，如果未选择则返回空字符串
  const currentStylePrompt = computed(() => {
    if (selectedStyleId.value) {
      const style = getStyleById(selectedStyleId.value)
      if (style) {
        // 返回风格名称 + 英文提示词，用于更好的生成效果
        return `${style.name}, ${style.prompt} style`
      }
    }
    return ''  // 未选择风格时返回空字符串，强制用户选择
  })

  const costEstimate = computed(() => {
    const sceneCount = scenes.value.length
    const charCount = characters.value.length

    const frameCost = sceneCount * 2 * 0.02
    const videoCost = sceneCount * 0.15
    const characterCost = charCount * 0.02
    const expressionCost = charCount * 5 * 0.01
    const totalCost = frameCost + videoCost + characterCost + expressionCost

    const frameTime = sceneCount * 2 * 15
    const videoTime = sceneCount * 60
    const characterTime = charCount * 20
    const totalTime = frameTime + videoTime + characterTime

    return {
      sceneCount,
      charCount,
      totalCost: totalCost.toFixed(2),
      totalTime: Math.ceil(totalTime / 60),
      breakdown: {
        frames: { count: sceneCount * 2, cost: frameCost.toFixed(2) },
        videos: { count: sceneCount, cost: videoCost.toFixed(2) },
        characters: { count: charCount, cost: characterCost.toFixed(2) }
      }
    }
  })

  // ========== 场景操作 ==========
  function selectScene(scene: SceneData) {
    scenes.value.forEach(s => s.active = false)
    scene.active = true
  }

  function addNewScene(): SceneData {
    const newId = `scene_${Date.now()}`
    const newScene: SceneData = {
      id: newId,
      title: '新场景',
      description: '请输入场景描述...',
      characters: [],
      dialogues: [],
      narration: '',
      duration: 8,
      setting: { location: '未知', timeOfDay: 'day' },
      active: false,
      // 镜头语言默认值
      shotType: 'medium',
      cameraMovement: 'static',
      cameraNote: '',
      // 转场默认值
      transitionIn: 'cut',
      transitionOut: 'cut',
      transitionDuration: 0.5,
      // 状态
      frameError: undefined,
      videoError: undefined,
      frameStatus: 'pending',
      videoStatus: 'pending',
      storyboardStatus: 'pending',
      sceneVisualStatus: 'pending'
    }
    scenes.value.push(newScene)
    return newScene
  }

  function deleteScene(scene: SceneData) {
    if (confirm(`确定要删除场景"${scene.title}"吗？`)) {
      const index = scenes.value.findIndex(s => s.id === scene.id)
      if (index !== -1) {
        scenes.value.splice(index, 1)
        const firstScene = scenes.value[0]
        if (scene.active && firstScene) {
          firstScene.active = true
        }
        saveProject()
      }
    }
  }

  function updateScene(updatedScene: Partial<SceneData> & { id: string }) {
    const sceneIndex = scenes.value.findIndex(s => s.id === updatedScene.id)
    if (sceneIndex !== -1) {
      const existingScene = scenes.value[sceneIndex]
      if (existingScene) {
        const descriptionChanged = existingScene.description !== updatedScene.description
        scenes.value[sceneIndex] = {
          ...existingScene,
          ...updatedScene,
          frameStatus: descriptionChanged ? 'pending' : existingScene.frameStatus
        }
        saveProject()
      }
    }
  }

  // 合并场景
  function mergeNarrationTexts(...parts: Array<string | null | undefined>): string | undefined {
    const merged = parts
      .map(part => part?.trim())
      .filter((part): part is string => !!part)

    if (merged.length === 0) return undefined
    return Array.from(new Set(merged)).join('\n\n')
  }

  function splitNarrationText(narration?: string | null): [string | undefined, string | undefined] {
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

  function mergeWithNextScene(sceneIndex: number) {
    if (sceneIndex >= scenes.value.length - 1) {
      alert('这是最后一个场景，无法向后合并')
      return
    }

    const currentScene = scenes.value[sceneIndex]
    const nextScene = scenes.value[sceneIndex + 1]
    if (!currentScene || !nextScene) return

    if (!confirm(`确定要将"${currentScene.title}"与"${nextScene.title}"合并吗？`)) {
      return
    }

    const mergedScene: SceneData = {
      id: currentScene.id,
      title: `${currentScene.title} + ${nextScene.title}`,
      description: `${currentScene.description}\n\n${nextScene.description}`,
      characters: [...currentScene.characters],
      dialogues: [...currentScene.dialogues, ...nextScene.dialogues],
      narration: mergeNarrationTexts(currentScene.narration, nextScene.narration),
      duration: currentScene.duration + nextScene.duration,
      setting: currentScene.setting,
      active: currentScene.active || nextScene.active,
      frameError: undefined,
      videoError: undefined,
      frameStatus: 'pending',
      videoStatus: 'pending',
      storyboardStatus: 'pending',
      sceneVisualStatus: 'pending'
    }

    nextScene.characters.forEach((char) => {
      if (!mergedScene.characters.find(c => c.name === char.name)) {
        mergedScene.characters.push(char)
      }
    })

    scenes.value.splice(sceneIndex, 2, mergedScene)
    saveProject()
  }

  // 拆分场景
  function splitScene(sceneIndex: number) {
    const scene = scenes.value[sceneIndex]
    if (!scene) return

    const sentences = scene.description.split(/(?<=[。！？.!?])/g).filter(s => s.trim())
    if (sentences.length < 2) {
      alert('场景描述太短，无法拆分。请先在编辑对话框中添加更多内容。')
      return
    }

    if (!confirm(`确定要将"${scene.title}"拆分为两个场景吗？`)) {
      return
    }

    const midPoint = Math.ceil(sentences.length / 2)
    const firstHalf = sentences.slice(0, midPoint).join('')
    const secondHalf = sentences.slice(midPoint).join('')
    const dialogueMidPoint = Math.ceil(scene.dialogues.length / 2)
    const [firstNarration, secondNarration] = splitNarrationText(scene.narration)

    const firstScene: SceneData = {
      id: scene.id,
      title: `${scene.title} (上)`,
      description: firstHalf,
      characters: [...scene.characters],
      dialogues: scene.dialogues.slice(0, dialogueMidPoint),
      narration: firstNarration,
      duration: Math.ceil(scene.duration / 2),
      setting: scene.setting,
      active: scene.active,
      frameError: undefined,
      videoError: undefined,
      frameStatus: 'pending',
      videoStatus: 'pending',
      storyboardStatus: 'pending',
      sceneVisualStatus: 'pending'
    }

    const secondScene: SceneData = {
      id: `scene_${Date.now()}`,
      title: `${scene.title} (下)`,
      description: secondHalf,
      characters: [...scene.characters],
      dialogues: scene.dialogues.slice(dialogueMidPoint),
      narration: secondNarration,
      duration: Math.floor(scene.duration / 2),
      setting: scene.setting,
      active: false,
      frameError: undefined,
      videoError: undefined,
      frameStatus: 'pending',
      videoStatus: 'pending',
      storyboardStatus: 'pending',
      sceneVisualStatus: 'pending'
    }

    scenes.value.splice(sceneIndex, 1, firstScene, secondScene)
    saveProject()
  }

  // ========== 剧本解析 ==========
  async function parseScript() {
    if (!novelText.value.trim()) return

    parsing.value = true
    try {
      const response = await $fetch<{
        success: boolean
        data: {
          title?: string
          scenes: Array<{
            id: string
            title?: string
            description: string
            characters: Array<{ name: string, appearance?: string, emotion?: string }>
            dialogues?: Array<{ character: string, text: string, emotion?: string }>
            narration?: string | null
            duration: number
            setting?: { location: string, timeOfDay: string }
          }>
          characters?: Array<{ name: string, description?: string, role?: string }>
        }
      }>('/api/script/parse', {
        method: 'POST',
        body: { text: novelText.value }
      })

      if (response.success && response.data?.scenes) {
        if (response.data.title && projectName.value === '新项目') {
          projectName.value = response.data.title
        }

        console.log('[parseScript] 解析结果:', {
          scenesCount: response.data.scenes.length,
          charactersCount: response.data.characters?.length || 0,
          characters: response.data.characters
        })

        scenes.value = response.data.scenes.map((s, i) => {
          const normalizedDialogues = (s.dialogues || []).filter(dialogue => {
            const speaker = normalizeCharacterName(dialogue.character)
            return !['旁白', 'narration', 'voiceover', '画外音', 'os', 'vo', '内心独白'].includes(speaker)
          })

          const narrationFromDialogues = (s.dialogues || [])
            .filter(dialogue => {
              const speaker = normalizeCharacterName(dialogue.character)
              return ['旁白', 'narration', 'voiceover', '画外音', 'os', 'vo', '内心独白'].includes(speaker)
            })
            .map(dialogue => dialogue.text?.trim())
            .filter((text): text is string => !!text)
            .join('\n')

          const normalizedNarration = mergeNarrationTexts(s.narration, narrationFromDialogues)

          return {
            id: s.id || `scene_${i + 1}`,
            title: s.title || `${s.setting?.location || '场景'} - ${s.setting?.timeOfDay || ''}`,
            description: s.description,
            characters: s.characters || [],
            dialogues: normalizedDialogues,
            narration: normalizedNarration,
            duration: s.duration || 8,
            setting: s.setting,
            active: i === 0,
            frameError: undefined,
            videoError: undefined,
            frameStatus: 'pending' as const,
            videoStatus: 'pending' as const,
            storyboardStatus: 'pending' as const,
            sceneVisualStatus: 'pending' as const
          }
        })

        // 从 API 返回的角色或场景中提取角色
        const charNames = new Set<string>()
        scenes.value.forEach(s => s.characters.forEach(c => charNames.add(c.name)))

        console.log('[parseScript] 从场景提取角色:', {
          charNames: Array.from(charNames),
          responseCharacters: response.data.characters
        })

        // 优先使用 API 返回的角色列表，如果没有则从场景中提取
        if (response.data.characters && response.data.characters.length > 0) {
          characters.value = response.data.characters.map((c, i) => ({
            id: `char_${i + 1}`,
            name: c.name,
            appearance: c.description || '',
            role: c.role || 'supporting',
            generating: false,
            generatingViews: false
          }))
        } else if (charNames.size > 0) {
          characters.value = Array.from(charNames).map((name, i) => {
            const sceneChar = scenes.value.flatMap(s => s.characters).find(c => c.name === name)
            return {
              id: `char_${i + 1}`,
              name,
            appearance: sceneChar?.appearance || '',
            role: 'supporting',
              generating: false,
              generatingViews: false
            }
          })
        }

        console.log('[parseScript] 最终角色列表:', characters.value)

        await saveProject()
      }
    } catch (e) {
      console.error('解析失败:', e)
    } finally {
      parsing.value = false
    }
  }

  // ========== 从大纲生成场景 (新增) ==========
  async function generateScenesFromOutline() {
    if (!outline.value) {
      console.warn('请先生成故事大纲')
      return
    }

    parsing.value = true
    try {
      const totalKeyEvents = outline.value.acts.reduce((sum, act) => sum + (act.keyEvents?.length || 0), 0)
      const synopsisLength = outline.value.synopsis?.length || 0
      const novelLength = novelText.value.trim().length

      // 动态估算场景数量，避免固定 8 场导致长剧情被压缩
      const estimatedByEvents = Math.max(8, totalKeyEvents * 2)
      const estimatedByLength = novelLength > 0
        ? Math.ceil(novelLength / 220)
        : Math.ceil(synopsisLength / 180)
      const targetSceneCount = Math.max(8, Math.min(20, Math.max(estimatedByEvents, estimatedByLength)))

      console.log('[generateScenesFromOutline] 动态场景数量估算:', {
        totalKeyEvents,
        synopsisLength,
        novelLength,
        targetSceneCount
      })

      const response = await $fetch<{
        success: boolean
        scenes: Array<{
          id: string
          title: string
          description: string
          setting: { location: string, timeOfDay: string, mood?: string, weather?: string }
          characters: Array<{ name: string, emotion?: string, action?: string }>
          dialogues: Array<{ character: string, text: string, emotion?: string }>
          narration?: string | null
          duration: number
          actId?: string
        }>
        totalDuration: number
        error?: string
      }>('/api/scene/generate-from-outline', {
        method: 'POST',
        body: {
          outline: outline.value,
          characters: characters.value.map(c => ({
            name: c.name,
            role: c.role,
            appearance: c.appearance,
            personality: c.personality,
            speakingStyle: c.speakingStyle
          })),
          targetSceneCount,
          style: currentStylePrompt.value
        }
      })

      if (response.success && response.scenes) {
        scenes.value = response.scenes.map((s, i) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          characters: s.characters.map(c => ({
            name: c.name,
            emotion: c.emotion,
            appearance: characters.value.find(ch => ch.name === c.name)?.appearance
          })),
          dialogues: s.dialogues,
          narration: s.narration || undefined,
          duration: s.duration,
          setting: s.setting,
          active: i === 0,
          frameStatus: 'pending' as const,
          videoStatus: 'pending' as const,
          storyboardStatus: 'pending' as const,
          sceneVisualStatus: 'pending' as const
        }))

        await saveProject()
        return response.scenes
      } else {
        console.error('场景生成失败:', response.error)
      }
    } catch (e) {
      console.error('从大纲生成场景失败:', e)
      throw e
    } finally {
      parsing.value = false
    }
    return null
  }

  // ========== 角色生成 ==========
  async function generateCharacter(char: CharacterData) {
    char.generating = true
    try {
      const response = await $fetch<{
        success: boolean
        asset: { baseImage: string }
      }>('/api/character/generate', {
        method: 'POST',
        body: {
          character: {
            id: char.id,
            name: char.name,
            appearance: char.appearance || `${char.name}，动漫风格角色`,
            role: char.role || 'supporting',
            gender: toOptionalString(char.gender),
            age: toOptionalNumber(char.age),
            personality: toOptionalString(char.personality),
            traits: toOptionalStringArray(char.traits)
          },
          style: currentStylePrompt.value,
          generateExpressions: false
        }
      })
      if (response.success) {
        char.baseImage = response.asset.baseImage
        await saveProject()
      }
    } catch (e) {
      console.error('角色生成失败:', e)
      throw e
    } finally {
      char.generating = false
    }
  }

  // 批量生成所有角色立绘
  async function batchGenerateCharacters(onProgress?: (current: number, total: number, name: string) => void) {
    const charsToGenerate = characters.value.filter(c => !c.baseImage)
    const total = charsToGenerate.length

    if (total === 0) {
      console.log('所有角色已有立绘')
      return { success: true, generated: 0, failed: 0 }
    }

    let generated = 0
    let failed = 0

    for (let i = 0; i < charsToGenerate.length; i++) {
      const char = charsToGenerate[i]
      if (!char) continue

      onProgress?.(i + 1, total, char.name)

      try {
        await generateCharacter(char)
        generated++
      } catch (e) {
        console.error(`角色 ${char.name} 生成失败:`, e)
        failed++
      }
    }

    return { success: true, generated, failed, total }
  }

  async function generateCharacterExpression(characterId: string, emotion: string) {
    const char = characters.value.find(c => c.id === characterId)
    if (!char || !char.baseImage) {
      console.warn('需要先生成角色基础立绘')
      return null
    }

    try {
      const response = await $fetch<{
        success: boolean
        expressionImage: string
      }>('/api/character/expression', {
        method: 'POST',
        body: {
          characterId,
          baseImage: char.baseImage,
          emotion,
          appearance: char.appearance
        }
      })

      if (response.success) {
        if (!char.expressions) {
          char.expressions = {}
        }
        char.expressions[emotion] = response.expressionImage
        await saveProject()
        return response.expressionImage
      }
    } catch (e) {
      console.error('表情生成失败:', e)
    }
    return null
  }

  function updateCharacter(updatedChar: Partial<CharacterData> & { id: string }) {
    const charIndex = characters.value.findIndex(c => c.id === updatedChar.id)
    if (charIndex !== -1) {
      const existingChar = characters.value[charIndex]
      if (existingChar) {
        characters.value[charIndex] = { ...existingChar, ...updatedChar }
        saveProject()
      }
    }
  }

  // ========== 故事大纲生成 (新增) ==========
  async function generateOutline() {
    if (!storyIdea.value.trim()) return

    generatingOutline.value = true
    try {
      const response = await $fetch<{
        success: boolean
        outline: StoryOutline
        error?: string
      }>('/api/outline/generate', {
        method: 'POST',
        body: {
          rawText: storyIdea.value,
          targetLength: 'medium'
        }
      })

      if (response.success && response.outline) {
        outline.value = response.outline
        // 如果大纲有标题，更新项目名称
        if (response.outline.title && projectName.value === '新项目') {
          projectName.value = response.outline.title
        }
        await saveProject()
        return response.outline
      } else {
        console.error('大纲生成失败:', response.error)
      }
    } catch (e) {
      console.error('大纲生成失败:', e)
      throw e
    } finally {
      generatingOutline.value = false
    }
    return null
  }

  // ========== 从大纲提取角色 (新增) ==========
  async function extractCharactersFromOutline() {
    if (!outline.value) return

    try {
      const response = await $fetch<{
        success: boolean
        characters: Array<{
          id: string
          name: string
          role: string
          appearance: string
          personality?: string
          traits?: string[]
          background?: string
          motivation?: string
          speakingStyle?: string
          catchphrase?: string
          age?: number
          gender?: string
        }>
        error?: string
      }>('/api/character/extract-from-outline', {
        method: 'POST',
        body: {
          outline: outline.value,
          style: currentStylePrompt.value
        }
      })

      if (response.success && response.characters) {
        // 替换或合并角色
        characters.value = response.characters.map(char => ({
          ...char,
          generating: false,
          generatingViews: false
        }))
        await saveProject()
        return response.characters
      }
    } catch (e) {
      console.error('从大纲提取角色失败:', e)
      throw e
    }
    return null
  }

  // ========== 从场景提取角色 (新增) ==========
  async function extractCharactersFromScenes() {
    if (scenes.value.length === 0) return

    try {
      // 收集场景中的所有角色名称和信息
      const charMap = new Map<string, { name: string, appearances: string[], emotions: string[] }>()

      scenes.value.forEach(scene => {
        scene.characters.forEach(char => {
          const existing = charMap.get(char.name)
          if (existing) {
            if (char.appearance && !existing.appearances.includes(char.appearance)) {
              existing.appearances.push(char.appearance)
            }
            if (char.emotion && !existing.emotions.includes(char.emotion)) {
              existing.emotions.push(char.emotion)
            }
          } else {
            charMap.set(char.name, {
              name: char.name,
              appearances: char.appearance ? [char.appearance] : [],
              emotions: char.emotion ? [char.emotion] : []
            })
          }
        })

        // 也从对话中提取角色
        scene.dialogues.forEach(dialogue => {
          if (!charMap.has(dialogue.character)) {
            charMap.set(dialogue.character, {
              name: dialogue.character,
              appearances: [],
              emotions: dialogue.emotion ? [dialogue.emotion] : []
            })
          }
        })
      })

      // 如果有大纲，调用 API 增强角色信息
      if (outline.value) {
        const response = await $fetch<{
          success: boolean
          characters: Array<{
            id: string
            name: string
            role: string
            appearance: string
            personality?: string
            traits?: string[]
            background?: string
            motivation?: string
            speakingStyle?: string
            catchphrase?: string
            age?: number
            gender?: string
          }>
          error?: string
        }>('/api/character/extract-from-outline', {
          method: 'POST',
          body: {
            outline: outline.value,
            style: currentStylePrompt.value,
            existingCharacters: Array.from(charMap.keys())
          }
        })

        if (response.success && response.characters) {
          characters.value = response.characters.map(char => ({
            ...char,
            generating: false,
            generatingViews: false
          }))
          await saveProject()
          return response.characters
        }
      }

      // 没有大纲时，直接从场景信息创建角色
      const newCharacters = Array.from(charMap.values()).map((char, i) => ({
        id: `char_${Date.now()}_${i}`,
        name: char.name,
        appearance: char.appearances.join('；') || '',
        role: i === 0 ? 'protagonist' : 'supporting',
        generating: false,
        generatingViews: false
      }))

      characters.value = newCharacters
      await saveProject()
      return newCharacters
    } catch (e) {
      console.error('从场景提取角色失败:', e)
      throw e
    }
  }

  // ========== 角色关系管理 (新增) ==========
  function addRelationship() {
    if (characters.value.length < 2) return

    const firstChar = characters.value[0]
    const secondChar = characters.value[1]
    if (!firstChar || !secondChar) return

    relationships.value.push({
      fromCharacterId: firstChar.id,
      toCharacterId: secondChar.id,
      type: 'friend',
      intensity: 3
    })
    saveProject()
  }

  function updateRelationship(rel: CharacterRelationship) {
    const index = relationships.value.findIndex(
      (r: CharacterRelationship) => r.fromCharacterId === rel.fromCharacterId && r.toCharacterId === rel.toCharacterId
    )
    if (index !== -1) {
      relationships.value[index] = rel
      saveProject()
    }
  }

  function removeRelationship(index: number) {
    relationships.value.splice(index, 1)
    saveProject()
  }

  // ========== 工作流步骤导航 (新增) ==========
  function setCurrentStep(step: 'outline' | 'characters' | 'script' | 'video') {
    currentStep.value = step
  }

  function proceedToNextStep() {
    const steps: Array<'outline' | 'characters' | 'script' | 'video'> = ['outline', 'characters', 'script', 'video']
    const currentIndex = steps.indexOf(currentStep.value)
    if (currentIndex < steps.length - 1) {
      const nextStep = steps[currentIndex + 1]
      if (nextStep) {
        currentStep.value = nextStep
      }
    }
  }

  // ========== 角色提取 (新增API) ==========
  async function extractCharactersFromScript() {
    if (!novelText.value.trim()) return

    try {
      const response = await $fetch<{
        success: boolean
        characters: Array<{ role: string, role_content: string }>
      }>('/api/character/extract', {
        method: 'POST',
        body: {
          content: novelText.value,
          style: currentStylePrompt.value
        }
      })

      if (response.success && response.characters) {
        // 合并提取的角色信息到现有角色
        response.characters.forEach((extracted) => {
          const existingChar = characters.value.find(c => c.name === extracted.role)
          if (existingChar) {
            // 更新现有角色的外貌描述
            existingChar.appearance = extracted.role_content
          } else {
            // 添加新角色
            characters.value.push({
              id: `char_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              name: extracted.role,
              appearance: extracted.role_content,
              role: 'supporting',
              generating: false,
              generatingViews: false
            })
          }
        })
        await saveProject()
      }
      return response
    } catch (e) {
      console.error('角色提取失败:', e)
      throw e
    }
  }

  // ========== 角色多视角生成 (新增API) ==========
  async function generateCharacterViews(char: CharacterData) {
    if (!char.baseImage) {
      console.warn('需要先生成角色基础立绘')
      return null
    }

    char.generatingViews = true
    try {
      const response = await $fetch<{
        success: boolean
        views: Partial<Record<CharacterView, string>>
        successCount: number
        errorCount: number
      }>('/api/character/views', {
        method: 'POST',
        body: {
          characterName: char.name,
          baseImage: char.baseImage,
          baseMimeType: 'image/png',
          style: currentStylePrompt.value,
          views: ['front', 'three_quarter', 'side', 'back']
        }
      })

      if (response.success) {
        char.views = response.views
        await saveProject()
        return response.views
      }
    } catch (e) {
      console.error('角色视角生成失败:', e)
    } finally {
      char.generatingViews = false
    }
    return null
  }

  // ========== 分镜脚本生成 (新增API) ==========
  async function generateStoryboard(scene: SceneData) {
    scene.storyboardStatus = 'generating'
    try {
      const response = await $fetch<{
        success: boolean
        data: Storyboard
      }>('/api/storyboard/generate', {
        method: 'POST',
        body: {
          sceneId: scene.id,
          sceneDescription: scene.description,
          dialogues: scene.dialogues,
          narration: scene.narration,
          style: currentStylePrompt.value
        }
      })

      if (response.success && response.data) {
        scene.storyboard = response.data
        scene.storyboardStatus = 'done'
        await saveProject()
        return response.data
      }
    } catch (e) {
      console.error('分镜生成失败:', e)
      scene.storyboardStatus = 'error'
    }
    return null
  }

  // ========== 场景视觉提取 (新增API) ==========
  async function extractSceneVisual(scene: SceneData) {
    scene.sceneVisualStatus = 'generating'
    try {
      // 确保 setting 有默认值
      const setting = scene.setting || { location: '未知地点', timeOfDay: 'day' }

      const response = await $fetch<{
        success: boolean
        data: SceneVisual
      }>('/api/scene/visual', {
        method: 'POST',
        body: {
          sceneId: scene.id,
          sceneDescription: scene.description,
          setting: {
            location: setting.location || '未知地点',
            timeOfDay: setting.timeOfDay || 'day',
            mood: setting.mood,
            weather: setting.weather
          },
          style: currentStylePrompt.value
        }
      })

      if (response.success && response.data) {
        scene.sceneVisual = response.data
        scene.sceneVisualStatus = 'done'
        await saveProject()
        return response.data
      }
    } catch (e) {
      console.error('场景视觉提取失败:', e)
      scene.sceneVisualStatus = 'error'
    }
    return null
  }

  // ========== 首尾帧生成 ==========
  /**
   * 生成场景首尾帧（增强版，支持连续性上下文）
   * @param scene 当前场景
   * @param previousSceneLastFrame 上一场景尾帧（可选，如果不传会自动从 scenes 中获取）
   * @param sceneIndex 场景索引（可选，如果不传会自动计算）
   */
  async function generateFrames(scene: SceneData, previousSceneLastFrame?: string, sceneIndex?: number) {
    scene.frameError = undefined
    scene.frameStatus = 'generating'
    try {
      // 自动生成分镜脚本（如果没有）
      if (!scene.storyboard) {
        console.log(`[generateFrames] 场景 ${scene.id} 缺少分镜脚本，自动生成...`)
        await generateStoryboard(scene)
        if (!scene.storyboard) {
          throw new Error('分镜脚本生成失败')
        }
      }

      // 自动提取场景视觉（如果没有）
      if (!scene.sceneVisual) {
        console.log(`[generateFrames] 场景 ${scene.id} 缺少场景视觉数据，自动提取...`)
        await extractSceneVisual(scene)
        if (!scene.sceneVisual) {
          throw new Error('场景视觉提取失败')
        }
      }

      // 计算场景索引
      const currentSceneIndex = sceneIndex ?? scenes.value.findIndex(s => s.id === scene.id)
      const totalScenes = scenes.value.length

      // 自动获取上一场景尾帧（如果未传入且不是第一个场景）
      let prevLastFrame = previousSceneLastFrame
      if (!prevLastFrame && currentSceneIndex > 0) {
        const prevScene = scenes.value[currentSceneIndex - 1]
        if (prevScene?.lastFrame) {
          prevLastFrame = prevScene.lastFrame
          console.log(`[generateFrames] 自动获取上一场景(${prevScene.id})的尾帧`)
        } else {
          console.warn(`[generateFrames] ⚠️ 上一场景(${prevScene?.id})没有尾帧，可能导致画面不连续`)
        }
      }

      // 只有相邻场景角色有重叠时，才使用上一场景尾帧作为首要参考
      if (prevLastFrame && currentSceneIndex > 0) {
        const prevScene = scenes.value[currentSceneIndex - 1]
        const frameUsageDecision = shouldUsePreviousSceneLastFrame(scene, prevScene)
        if (!frameUsageDecision.use) {
          console.log(`[generateFrames] 跳过上一场景尾帧参考: ${frameUsageDecision.reason}`)
          prevLastFrame = undefined
        } else if (frameUsageDecision.overlaps.length > 0) {
          console.log(`[generateFrames] 保留上一场景尾帧参考，重叠角色: ${frameUsageDecision.overlaps.join('、')}`)
        }
      }

      // 构建角色资产映射与锚点（支持场景角色名与角色设定名不完全一致）
      const {
        characterAssets,
        characterAnchors,
        mappedCharacters,
        unmatchedCharacters
      } = buildCharacterReferencesForScene(scene)

      // 构建连续性上下文
      const continuityContext = buildContinuityContext(currentSceneIndex, totalScenes, !!prevLastFrame)

      console.log(`[generateFrames] 场景 ${scene.id} (${currentSceneIndex + 1}/${totalScenes})`)
      console.log(`[generateFrames] 上一场景尾帧: ${prevLastFrame ? '有' : '无'}`)
      console.log(`[generateFrames] 角色锚点: ${characterAnchors.length}个`)
      if (mappedCharacters.length > 0) {
        console.log(`[generateFrames] 角色映射: ${mappedCharacters.join(' | ')}`)
      }
      if (unmatchedCharacters.length > 0) {
        console.warn(`[generateFrames] 未匹配到角色立绘: ${unmatchedCharacters.join('、')}`)
      }

      const response = await $fetch<{
        success: boolean
        firstFrame: { imageData: string }
        lastFrame: { imageData: string }
        continuityInfo?: {
          sceneIndex: number
          hadPreviousFrame: boolean
          characterAnchorsUsed: number
        }
      }>('/api/frame/generate', {
        method: 'POST',
        body: {
          scene: {
            id: scene.id,
            title: scene.title,
            description: scene.description,
            characters: scene.characters,
            dialogues: scene.dialogues,
            duration: scene.duration,
            setting: scene.setting
          },
          style: currentStylePrompt.value,
          characterAssets,
          previousSceneLastFrame: prevLastFrame,
          fusionMode: prevLastFrame ? 'continuity' : 'reference',
          // 传递分镜和视觉提取数据
          storyboard: scene.storyboard,
          sceneVisual: scene.sceneVisual,
          // 新增：连续性上下文
          continuityContext,
          characterAnchors,
          enforceCharacterConsistency: true,
          enforcePreviousFrameConnection: !!prevLastFrame
        }
      })
      if (response.success) {
        scene.firstFrame = response.firstFrame.imageData
        scene.lastFrame = response.lastFrame.imageData
        scene.frameError = undefined
        scene.frameStatus = 'done'
        console.log(`[generateFrames] 场景 ${scene.id} 首尾帧生成成功`, response.continuityInfo)
        await saveProject()
      }
    } catch (e) {
      console.error('首尾帧生成失败:', e)
      scene.frameError = getDisplayErrorMessage(e, '首尾帧生成失败')
      scene.frameStatus = 'error'
    }
  }

  /**
   * 归一化角色名（用于模糊匹配）
   */
  function normalizeCharacterName(name?: string): string {
    if (!name) return ''
    return name
      .toLowerCase()
      .trim()
      .replace(/[\s\u3000]/g, '')
      .replace(/[^\p{L}\p{N}\u4E00-\u9FFF]/gu, '')
  }

  /**
   * 拆分角色名中的别名（如 "张三/阿三"）
   */
  function splitCharacterAliases(name: string): string[] {
    const trimmed = name.trim()
    if (!trimmed) return []

    const parts = trimmed
      .split(/[/／|｜,，、\s]+/g)
      .map(part => part.trim())
      .filter(Boolean)

    return Array.from(new Set([trimmed, ...parts]))
  }

  /**
   * 字符级 Jaccard 相似度（0-1）
   */
  function calculateTextSimilarity(textA?: string, textB?: string): number {
    const a = normalizeCharacterName(textA)
    const b = normalizeCharacterName(textB)
    if (!a || !b) return 0

    const setA = new Set(a.split(''))
    const setB = new Set(b.split(''))
    if (setA.size === 0 || setB.size === 0) return 0

    let intersection = 0
    for (const char of setA) {
      if (setB.has(char)) intersection++
    }
    const union = new Set([...setA, ...setB]).size
    return union > 0 ? intersection / union : 0
  }

  /**
   * 根据场景角色信息匹配已生成立绘的角色
   */
  function resolveCharacterForScene(
    sceneCharacter: SceneData['characters'][number],
    scene: SceneData
  ): CharacterData | undefined {
    const availableCharacters = characters.value.filter(char => !!char.baseImage)
    if (availableCharacters.length === 0) return undefined

    const aliases = splitCharacterAliases(sceneCharacter.name)
    const aliasNormSet = new Set(aliases.map(alias => normalizeCharacterName(alias)).filter(Boolean))

    // 1) 精确匹配（原始名）
    for (const alias of aliases) {
      const exact = availableCharacters.find(char => char.name === alias)
      if (exact) return exact
    }

    // 2) 归一化精确匹配
    for (const char of availableCharacters) {
      const normalized = normalizeCharacterName(char.name)
      if (normalized && aliasNormSet.has(normalized)) {
        return char
      }
    }

    // 3) 包含关系匹配（例如“小秀娥” -> “秀娥”）
    for (const char of availableCharacters) {
      const charNorm = normalizeCharacterName(char.name)
      if (!charNorm) continue

      for (const aliasNorm of aliasNormSet) {
        if (aliasNorm.length >= 2 && charNorm.length >= 2 && (aliasNorm.includes(charNorm) || charNorm.includes(aliasNorm))) {
          return char
        }
      }
    }

    // 4) 外观/上下文相似度匹配（阈值过滤，避免误匹配）
    let bestMatch: CharacterData | undefined
    let bestScore = 0

    for (const char of availableCharacters) {
      let score = 0

      // 外观描述相似度
      const appearanceScore = calculateTextSimilarity(sceneCharacter.appearance, char.appearance)
      score += appearanceScore * 0.6

      // 场景描述或对话中显式提到该角色，提升置信度
      if (scene.description.includes(char.name)) {
        score += 0.2
      }
      if (scene.dialogues.some(dialogue => dialogue.character === char.name)) {
        score += 0.3
      }

      if (score > bestScore) {
        bestScore = score
        bestMatch = char
      }
    }

    return bestScore >= 0.45 ? bestMatch : undefined
  }

  /**
   * 为当前场景构建角色资产和锚点
   * - 资产 key 同时包含角色设定名与场景角色名，保证后端按场景名取图时也能命中
   * - 锚点 name 使用场景角色名，保证一致性提示词可命中
   */
  function buildCharacterReferencesForScene(scene: SceneData) {
    const characterAssets: Record<string, string> = {}
    const characterAnchors: Array<{
      name: string
      coreFeatures: {
        hairStyle?: string
        hairColor?: string
        eyeColor?: string
        facialFeatures?: string
        bodyType?: string
      }
      outfit: { description: string }
      referenceImage?: string
      consistencyWeight: number
    }> = []

    // 保留角色设定名 -> 立绘映射（兼容旧逻辑）
    characters.value.forEach((char) => {
      if (char.baseImage) {
        characterAssets[char.name] = char.baseImage
      }
    })

    const mappedCharacters: string[] = []
    const unmatchedCharacters: string[] = []
    const usedAnchorNames = new Set<string>()

    scene.characters.forEach((sceneCharacter) => {
      const matchedCharacter = resolveCharacterForScene(sceneCharacter, scene)
      if (!matchedCharacter?.baseImage) {
        unmatchedCharacters.push(sceneCharacter.name)
        return
      }

      // 用场景角色名作为 key，确保后端按 scene.characters 取 referenceImages 时能命中
      characterAssets[sceneCharacter.name] = matchedCharacter.baseImage

      if (!usedAnchorNames.has(sceneCharacter.name)) {
        usedAnchorNames.add(sceneCharacter.name)
        characterAnchors.push({
          name: sceneCharacter.name,
          coreFeatures: {
            hairStyle: extractFeatureFromAppearance(matchedCharacter.appearance, 'hair'),
            hairColor: extractFeatureFromAppearance(matchedCharacter.appearance, 'hairColor'),
            eyeColor: extractFeatureFromAppearance(matchedCharacter.appearance, 'eye'),
            facialFeatures: extractFeatureFromAppearance(matchedCharacter.appearance, 'face'),
            bodyType: extractFeatureFromAppearance(matchedCharacter.appearance, 'body')
          },
          outfit: {
            description: extractFeatureFromAppearance(matchedCharacter.appearance, 'outfit') || matchedCharacter.appearance || ''
          },
          referenceImage: matchedCharacter.baseImage,
          consistencyWeight: 0.95
        })
      }

      mappedCharacters.push(
        sceneCharacter.name === matchedCharacter.name
          ? `${sceneCharacter.name}`
          : `${sceneCharacter.name} -> ${matchedCharacter.name}`
      )
    })

    return {
      characterAssets,
      characterAnchors,
      mappedCharacters: Array.from(new Set(mappedCharacters)),
      unmatchedCharacters: Array.from(new Set(unmatchedCharacters))
    }
  }

  /**
   * 计算场景角色身份映射（用于相邻场景角色重叠判定）
   */
  function getSceneCharacterIdentityMap(scene: SceneData): Map<string, string> {
    const identityMap = new Map<string, string>()

    scene.characters.forEach((sceneCharacter) => {
      const matchedCharacter = resolveCharacterForScene(sceneCharacter, scene)

      if (matchedCharacter?.id) {
        identityMap.set(`id:${matchedCharacter.id}`, matchedCharacter.name)
      }

      const normalizedSceneName = normalizeCharacterName(sceneCharacter.name)
      if (normalizedSceneName) {
        identityMap.set(`name:${normalizedSceneName}`, matchedCharacter?.name || sceneCharacter.name)
      }
    })

    return identityMap
  }

  /**
   * 归一化场景文本（用于地点/时间比较）
   */
  function normalizeSceneText(text?: string): string {
    if (!text) return ''
    return text
      .toLowerCase()
      .trim()
      .replace(/[\s\u3000]/g, '')
      .replace(/[^\p{L}\p{N}\u4E00-\u9FFF]/gu, '')
  }

  /**
   * 将时间描述归一化到统一时段桶
   */
  function normalizeTimeOfDayBucket(timeOfDay?: string): string {
    const normalized = normalizeSceneText(timeOfDay)
    if (!normalized) return ''

    if (normalized.includes('dawn') || normalized.includes('凌晨') || normalized.includes('黎明')) return 'dawn'
    if (normalized.includes('morning') || normalized.includes('早上') || normalized.includes('上午') || normalized.includes('清晨')) return 'morning'
    if (normalized.includes('noon') || normalized.includes('中午') || normalized.includes('正午')) return 'noon'
    if (normalized.includes('afternoon') || normalized.includes('下午')) return 'afternoon'
    if (normalized.includes('evening') || normalized.includes('傍晚') || normalized.includes('黄昏')) return 'evening'
    if (normalized.includes('night') || normalized.includes('晚上') || normalized.includes('夜晚') || normalized.includes('深夜')) return 'night'
    if (normalized.includes('day') || normalized.includes('白天')) return 'day'

    return normalized
  }

  /**
   * 地点是否发生强切换（几乎无连续性）
   */
  function isLocationStronglyDifferent(currentLocation?: string, previousLocation?: string): boolean {
    const current = normalizeSceneText(currentLocation)
    const previous = normalizeSceneText(previousLocation)
    if (!current || !previous) return false
    if (current === previous || current.includes(previous) || previous.includes(current)) return false

    return calculateTextSimilarity(currentLocation, previousLocation) < 0.3
  }

  /**
   * 时间是否发生强切换（昼夜级别变化）
   */
  function isTimeStronglyDifferent(currentTime?: string, previousTime?: string): boolean {
    const currentBucket = normalizeTimeOfDayBucket(currentTime)
    const previousBucket = normalizeTimeOfDayBucket(previousTime)
    if (!currentBucket || !previousBucket) return false
    if (currentBucket === previousBucket) return false

    const dayBuckets = new Set(['dawn', 'morning', 'noon', 'afternoon', 'day'])
    const nightBuckets = new Set(['evening', 'night'])

    const isCurrentDay = dayBuckets.has(currentBucket)
    const isCurrentNight = nightBuckets.has(currentBucket)
    const isPreviousDay = dayBuckets.has(previousBucket)
    const isPreviousNight = nightBuckets.has(previousBucket)

    if ((isCurrentDay && isPreviousNight) || (isCurrentNight && isPreviousDay)) {
      return true
    }

    const currentRaw = normalizeSceneText(currentTime)
    const previousRaw = normalizeSceneText(previousTime)
    if (!currentRaw || !previousRaw) return false
    if (currentRaw.includes(previousRaw) || previousRaw.includes(currentRaw)) return false

    return calculateTextSimilarity(currentTime, previousTime) < 0.25
  }

  /**
   * 判定当前场景是否应该使用上一场景尾帧
   * 规则：相邻场景角色不重叠 -> 不使用上一场景尾帧
   */
  function shouldUsePreviousSceneLastFrame(
    currentScene: SceneData,
    previousScene?: SceneData
  ): { use: boolean, overlaps: string[], reason: string } {
    if (!previousScene?.lastFrame) {
      return {
        use: false,
        overlaps: [],
        reason: '上一场景没有可用尾帧'
      }
    }

    if (currentScene.characters.length === 0 || previousScene.characters.length === 0) {
      return {
        use: false,
        overlaps: [],
        reason: '相邻场景缺少角色信息，无法建立角色连续性'
      }
    }

    const currentIdentityMap = getSceneCharacterIdentityMap(currentScene)
    const previousIdentityMap = getSceneCharacterIdentityMap(previousScene)

    const overlaps = Array.from(currentIdentityMap.entries())
      .filter(([identityKey]) => previousIdentityMap.has(identityKey))
      .map(([, label]) => label)

    const uniqueOverlaps = Array.from(new Set(overlaps))

    if (uniqueOverlaps.length === 0) {
      return {
        use: false,
        overlaps: [],
        reason: '相邻场景角色不重叠'
      }
    }

    // 仅有极少重叠角色时，若地点+时间都发生强切换，则放弃尾帧连接
    const locationStronglyDifferent = isLocationStronglyDifferent(
      currentScene.setting?.location,
      previousScene.setting?.location
    )
    const timeStronglyDifferent = isTimeStronglyDifferent(
      currentScene.setting?.timeOfDay,
      previousScene.setting?.timeOfDay
    )

    if (uniqueOverlaps.length <= 1 && locationStronglyDifferent && timeStronglyDifferent) {
      return {
        use: false,
        overlaps: uniqueOverlaps,
        reason: '仅少量角色重叠且地点、时间发生强切换'
      }
    }

    return {
      use: true,
      overlaps: uniqueOverlaps,
      reason: '存在重叠角色'
    }
  }

  /**
   * 构建连续性上下文
   */
  function buildContinuityContext(currentSceneIndex: number, totalScenes: number, hasPreviousFrame: boolean) {
    const prevScene = currentSceneIndex > 0 ? scenes.value[currentSceneIndex - 1] : undefined
    const nextScene = currentSceneIndex < totalScenes - 1 ? scenes.value[currentSceneIndex + 1] : undefined

    // 构建上一场景摘要
    const previousSceneSummary = prevScene ? {
      sceneId: prevScene.id,
      title: prevScene.title,
      description: prevScene.description,
      setting: prevScene.setting,
      characters: prevScene.characters.map(c => ({
        name: c.name,
        appearance: c.appearance,
        emotion: c.emotion
      })),
      narrativeState: {
        emotionalTone: prevScene.dialogues?.[prevScene.dialogues.length - 1]?.emotion || 'neutral',
        plotPoint: prevScene.title
      }
    } : undefined

    // 构建下一场景摘要
    const nextSceneSummary = nextScene ? {
      sceneId: nextScene.id,
      title: nextScene.title,
      description: nextScene.description,
      setting: nextScene.setting,
      characters: nextScene.characters.map(c => ({
        name: c.name,
        appearance: c.appearance,
        emotion: c.emotion
      }))
    } : undefined

    // 构建全局角色描述
    const globalCharacterDescriptions: Record<string, { appearance: string }> = {}
    characters.value.forEach(char => {
      globalCharacterDescriptions[char.name] = {
        appearance: char.appearance || ''
      }
    })

    return {
      previousScene: previousSceneSummary,
      previousSceneLastFrame: hasPreviousFrame ? 'provided' : undefined,
      nextScene: nextSceneSummary,
      globalCharacterDescriptions,
      sceneIndex: currentSceneIndex,
      totalScenes,
      storyContext: {
        title: projectName.value,
        style: currentStylePrompt.value,
        overallMood: outline.value?.theme || undefined
      }
    }
  }

  /**
   * 从外观描述中提取特定特征
   */
  function extractFeatureFromAppearance(appearance: string | undefined, featureType: string): string | undefined {
    if (!appearance) return undefined

    const patterns: Record<string, RegExp[]> = {
      hair: [/(?:头发|发型)[：:是]?\s*([^，,。.；;]+)/i, /([^，,。.；;]*(?:长发|短发|卷发|直发|马尾|双马尾|披肩发)[^，,。.；;]*)/i],
      hairColor: [/(?:发色|头发颜色)[：:是]?\s*([^，,。.；;]+)/i, /([黑金棕红白银蓝紫粉]色?(?:头发|发))/i],
      eye: [/(?:眼睛|眼眸|瞳孔)[：:是]?\s*([^，,。.；;]+)/i, /([^，,。.；;]*(?:大眼|小眼|丹凤眼|杏眼)[^，,。.；;]*)/i],
      face: [/(?:脸型|面部|五官)[：:是]?\s*([^，,。.；;]+)/i],
      body: [/(?:身材|体型)[：:是]?\s*([^，,。.；;]+)/i, /([^，,。.；;]*(?:高挑|娇小|苗条|健壮)[^，,。.；;]*)/i],
      outfit: [/(?:服装|穿着|衣服)[：:是]?\s*([^，,。.；;]+)/i, /(?:穿|着)([^，,。.；;]+)/i]
    }

    const featurePatterns = patterns[featureType]
    if (!featurePatterns) return undefined

    for (const pattern of featurePatterns) {
      const match = appearance.match(pattern)
      if (match && match[1]) {
        return match[1].trim()
      }
    }
    return undefined
  }

  /**
   * 统一视频 URL:
   * - 新格式: /api/video/file/:filename
   * - 兼容旧格式: /videos/:filename -> /api/video/file/:filename
   */
  function normalizeVideoUrl(videoUrl?: string): string | undefined {
    if (!videoUrl) return videoUrl

    if (videoUrl.startsWith('/videos/')) {
      const filename = videoUrl.slice('/videos/'.length)
      return filename ? `/api/video/file/${filename}` : videoUrl
    }

    return videoUrl
  }

  // ========== 视频生成 ==========
  async function generateVideo(scene: SceneData) {
    if (!scene.firstFrame || !scene.lastFrame) {
      await generateFrames(scene)
    }
    if (scene.frameStatus !== 'done') return

    scene.videoError = undefined
    scene.videoStatus = 'generating'
    try {
      // 构建增强的视频生成 prompt，优先使用分镜脚本中的信息
      let enhancedPrompt = scene.description
      const shotTypeDescriptions: Record<ShotType, string> = {
        extreme_wide: 'extreme wide shot showing vast landscape',
        wide: 'wide shot showing full environment',
        medium_wide: 'medium wide shot showing full body with environment',
        medium: 'medium shot from waist up',
        medium_close: 'medium close-up from chest up',
        close: 'close-up shot from shoulders up',
        extreme_close: 'extreme close-up on face or detail',
        detail: 'detail shot focusing on specific object'
      }

      const cameraMovementDescriptions: Record<CameraMovement, string> = {
        static: 'static camera',
        push: 'camera pushing forward slowly',
        pull: 'camera pulling back slowly',
        pan_left: 'camera panning left',
        pan_right: 'camera panning right',
        tilt_up: 'camera tilting up',
        tilt_down: 'camera tilting down',
        track: 'camera tracking the subject',
        dolly: 'camera moving parallel to subject',
        zoom_in: 'zooming in',
        zoom_out: 'zooming out',
        crane: 'crane shot moving vertically',
        handheld: 'handheld camera with slight shake',
        arc: 'camera arcing around subject'
      }

      const narrationBlock = scene.narration?.trim()
        ? `【场景旁白（必须体现）】\n${scene.narration.trim()}\n请通过人物动作、镜头推进和环境变化把旁白信息明确表现出来。`
        : ''

      const dialogueBlock = scene.dialogues.length > 0
        ? `【核心对白】\n${scene.dialogues
          .map(dialogue => `${dialogue.character}: ${dialogue.text}`)
          .join('\n')}`
        : ''

      // 如果有分镜脚本，使用分镜中的镜头信息
      if (scene.storyboard && scene.storyboard.shots.length > 0) {
        const cinematicHints: string[] = []

        // 从首镜头提取全局镜头语气
        const firstShot = scene.storyboard.shots[0]
        if (firstShot) {
          if (firstShot.shotType) {
            cinematicHints.push(shotTypeDescriptions[firstShot.shotType] || firstShot.shotType)
          }

          if (firstShot.cameraMovement && firstShot.cameraMovement !== 'static') {
            cinematicHints.push(cameraMovementDescriptions[firstShot.cameraMovement] || firstShot.cameraMovement)
          }
        }

        const shotSequence = scene.storyboard.shots
          .map((shot, index) => {
            const shotType = shotTypeDescriptions[shot.shotType] || shot.shotType
            const camera = cameraMovementDescriptions[shot.cameraMovement] || shot.cameraMovement
            const dialogue = shot.dialogue?.trim()
            const character = shot.character?.trim()
            const dialogueLine = dialogue
              ? `对白/旁白: ${character ? `${character}: ` : ''}${dialogue}`
              : ''

            return [
              `${index + 1}. ${shot.visualContent}`,
              `   - Shot: ${shotType}`,
              `   - Camera: ${camera}`,
              dialogueLine ? `   - ${dialogueLine}` : '',
              shot.duration ? `   - Duration hint: ${shot.duration}s` : ''
            ]
              .filter(Boolean)
              .join('\n')
          })
          .join('\n')

        const requiredChanges = Math.max(1, Math.min(4, scene.storyboard.shots.length - 1))
        enhancedPrompt = [
          '【分镜序列（必须按顺序覆盖，不得只表现首镜头）】',
          shotSequence,
          `【镜头推进要求】本段视频至少出现 ${requiredChanges} 次清晰的构图/机位变化，体现完整叙事推进。`,
          narrationBlock,
          dialogueBlock,
          `【场景主描述】\n${scene.description}`
        ]
          .filter(Boolean)
          .join('\n\n')

        if (cinematicHints.length > 0) {
          enhancedPrompt = `[Cinematography: ${cinematicHints.join(', ')}] ${enhancedPrompt}`
        }
      } else {
        // 没有分镜脚本时，使用场景级别的镜头设置
        // 构建镜头语言提示
        const cinematicHints: string[] = []

        if (scene.shotType && scene.shotType !== 'medium') {
          cinematicHints.push(shotTypeDescriptions[scene.shotType])
        }

        if (scene.cameraMovement && scene.cameraMovement !== 'static') {
          cinematicHints.push(cameraMovementDescriptions[scene.cameraMovement])
        }

        if (scene.cameraNote) {
          cinematicHints.push(scene.cameraNote)
        }

        // 如果有镜头语言提示，添加到 prompt
        if (cinematicHints.length > 0) {
          enhancedPrompt = `[Cinematography: ${cinematicHints.join(', ')}] ${enhancedPrompt}`
        }

        if (narrationBlock || dialogueBlock) {
          enhancedPrompt = [enhancedPrompt, narrationBlock, dialogueBlock]
            .filter(Boolean)
            .join('\n\n')
        }
      }

      // 如果有场景视觉提取的 imagePrompt，也可以参考
      if (scene.sceneVisual?.imagePrompt) {
        console.log('[VideoGen] 场景有视觉提取数据，imagePrompt 长度:', scene.sceneVisual.imagePrompt.length)
        enhancedPrompt = `${enhancedPrompt}\n\n【场景视觉参考】\n${scene.sceneVisual.imagePrompt}`
      }

      // 强化角色一致性：明确要求视频必须遵循首尾帧中的角色身份
      const characterReferenceLines = scene.characters.map((sceneCharacter) => {
        const matched = resolveCharacterForScene(sceneCharacter, scene)
        const namePart = matched && matched.name !== sceneCharacter.name
          ? `${sceneCharacter.name}(对应角色设定: ${matched.name})`
          : sceneCharacter.name
        const appearancePart = matched?.appearance || sceneCharacter.appearance || '保持与首尾帧一致'
        return `- ${namePart}: ${appearancePart}`
      })

      const consistencyPrompt = [
        '【角色一致性要求-最高优先级】',
        '必须严格参考输入的首帧和尾帧，保持同一角色的脸部特征、发型、发色、服装款式和服装颜色全程一致。',
        '禁止替换角色、禁止新增与场景无关主角、禁止在中途改变人物身份。',
        '本场景角色设定:',
        ...characterReferenceLines
      ].join('\n')

      enhancedPrompt = `${consistencyPrompt}\n\n${enhancedPrompt}`

      const response = await $fetch<{
        success: boolean
        taskId: string
      }>('/api/video/generate', {
        method: 'POST',
        body: {
          sceneId: scene.id,
          config: {
            prompt: enhancedPrompt,
            firstFrame: scene.firstFrame,
            lastFrame: scene.lastFrame,
            duration: scene.duration || 8,
            resolution: '720p',
            aspectRatio: projectAspectRatio.value,
            withAudio: true,
            model: 'fast'
          }
        }
      })

      if (response.success && response.taskId) {
        await pollVideoStatus(scene, response.taskId)
      }
    } catch (e) {
      console.error('视频生成失败:', e)
      scene.videoError = getDisplayErrorMessage(e, '视频生成失败')
      scene.videoStatus = 'error'
    }
  }

  async function pollVideoStatus(scene: SceneData, taskId: string) {
    const maxAttempts = 60
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000))
      try {
        const response = await $fetch<{
          success: boolean
          task: {
            status: string
            error?: string
            result?: { videoData?: string }
          }
        }>(`/api/video/status/${taskId}`)

        if (response.task.status === 'completed' && response.task.result?.videoData) {
          const videoData = response.task.result.videoData
          if (videoData.startsWith('url:')) {
            scene.videoUrl = normalizeVideoUrl(videoData.substring(4))
          } else if (videoData.startsWith('data:') || videoData.startsWith('http')) {
            scene.videoUrl = videoData
          } else if (videoData.startsWith('ref:')) {
            console.warn('视频为引用类型，暂不支持播放')
            scene.videoError = '视频已生成，但当前返回的是引用资源，页面暂不支持直接预览。'
            scene.videoStatus = 'error'
            return
          } else {
            scene.videoUrl = `data:video/mp4;base64,${videoData}`
          }
          scene.videoError = undefined
          scene.videoStatus = 'done'
          await saveProject()
          return
        } else if (response.task.status === 'failed') {
          scene.videoError = response.task.error || '视频生成失败'
          scene.videoStatus = 'error'
          return
        }
      } catch (e) {
        console.error('状态查询失败:', e)
      }
    }
    scene.videoError = '视频生成超时或状态查询失败，请稍后重试。'
    scene.videoStatus = 'error'
  }

  // ========== 批量操作 ==========
  /**
   * 批量生成首尾帧（按顺序，确保连续性）
   * 重要：必须按场景顺序生成，以确保每个场景都能获取到上一场景的尾帧
   */
  async function batchGenerateFrames() {
    const pendingScenes = scenes.value.filter(s => s.frameStatus !== 'done')
    if (pendingScenes.length === 0) {
      alert('所有场景已完成首尾帧生成')
      return
    }

    batchFrameStatus.value = { running: true, current: 0, total: pendingScenes.length }

    console.log(`[batchGenerateFrames] 开始批量生成，共 ${pendingScenes.length} 个待处理场景`)

    try {
      // 必须按顺序遍历所有场景，确保连续性
      for (let i = 0; i < scenes.value.length; i++) {
        const scene = scenes.value[i]
        if (scene && scene.frameStatus !== 'done') {
          console.log(`[batchGenerateFrames] 处理场景 ${i + 1}/${scenes.value.length}: ${scene.id}`)

          // 传递场景索引，让 generateFrames 自动获取上一场景尾帧
          await generateFrames(scene, undefined, i)
          batchFrameStatus.value.current++

          // 检查是否成功生成，如果失败则记录但继续
          if (scene.frameStatus === 'error') {
            console.error(`[batchGenerateFrames] 场景 ${scene.id} 生成失败，继续处理下一个`)
          }
        }
      }
      await saveProject()
      console.log(`[batchGenerateFrames] 批量生成完成`)
    } finally {
      batchFrameStatus.value.running = false
    }
  }

  async function batchGenerateVideos() {
    const readyScenes = scenes.value.filter(s => s.frameStatus === 'done' && s.videoStatus !== 'done')
    if (readyScenes.length === 0) {
      alert('没有可生成视频的场景（请先生成首尾帧）')
      return
    }

    batchVideoStatus.value = { running: true, current: 0, total: readyScenes.length }

    try {
      for (const scene of scenes.value) {
        if (scene.frameStatus === 'done' && scene.videoStatus !== 'done') {
          await generateVideo(scene)
          batchVideoStatus.value.current++
        }
      }
      await saveProject()
    } finally {
      batchVideoStatus.value.running = false
    }
  }

  // ========== 视频合成 ==========
  const mergeStatus = ref<{
    running: boolean
    progress: number
    error?: string
  }>({
    running: false,
    progress: 0
  })

  const finalVideo = ref<{
    videoData?: string
    duration?: number
    size?: number
  } | null>(null)

  async function mergeAllVideos() {
    const readyScenes = scenes.value.filter(s => s.videoStatus === 'done' && s.videoUrl)
    if (readyScenes.length === 0) {
      alert('没有可合成的视频（请先生成场景视频）')
      return null
    }

    const pendingScenes = scenes.value.filter(s => !(s.videoStatus === 'done' && s.videoUrl))
    if (pendingScenes.length > 0) {
      const previewTitles = pendingScenes
        .slice(0, 3)
        .map(scene => scene.title)
        .join('、')
      const hasMore = pendingScenes.length > 3 ? ' 等' : ''
      const shouldContinue = confirm(
        `当前仅 ${readyScenes.length}/${scenes.value.length} 个场景视频可用。\n` +
        `未就绪场景：${previewTitles}${hasMore}。\n\n` +
        '继续合成将导致最终视频缺少部分剧情，是否继续？'
      )
      if (!shouldContinue) {
        return null
      }
    }

    mergeStatus.value = { running: true, progress: 10 }
    finalVideo.value = null

    try {
      mergeStatus.value.progress = 30

      const response = await $fetch<{
        success: boolean
        data: {
          videoData: string
          duration: number
          size: number
          sceneCount: number
        }
        error?: string
      }>('/api/video/merge', {
        method: 'POST',
        body: {
          projectId: projectId.value,
          scenes: readyScenes.map(s => ({
            id: s.id,
            title: s.title,
            videoUrl: s.videoUrl,
            duration: s.duration,
            dialogues: s.dialogues
          }))
          // 暂时不使用转场效果，直接拼接
        }
      })

      mergeStatus.value.progress = 90

      if (response.success && response.data) {
        finalVideo.value = {
          videoData: response.data.videoData,
          duration: response.data.duration,
          size: response.data.size
        }
        mergeStatus.value.progress = 100
        console.log(`[VideoMerge] 合成完成，${response.data.sceneCount} 个场景，时长 ${response.data.duration}秒`)
        return response.data
      } else {
        throw new Error(response.error || '合成失败')
      }
    } catch (e) {
      console.error('视频合成失败:', e)
      mergeStatus.value.error = e instanceof Error ? e.message : '合成失败'
      return null
    } finally {
      mergeStatus.value.running = false
    }
  }

  // ========== 流水线 ==========
  async function startPipeline() {
    if (scenes.value.length === 0) {
      alert('请先解析剧本')
      return
    }
    if (!currentStylePrompt.value) {
      alert('请先选择画风预设')
      return
    }

    pipelineStatus.value = { running: true, progress: 0, currentStep: '初始化...' }

    try {
      // 步骤1: 生成角色 (20%)
      pipelineStatus.value.currentStep = '生成角色立绘...'
      for (const char of characters.value) {
        if (!char.baseImage) {
          await generateCharacter(char)
        }
      }
      pipelineStatus.value.progress = 20

      // 步骤2: 生成首尾帧 (50%) - 使用连续性生成
      pipelineStatus.value.currentStep = '生成首尾帧（连续性模式）...'
      console.log('[Pipeline] 开始按顺序生成首尾帧，确保场景连续性')
      for (let i = 0; i < scenes.value.length; i++) {
        const scene = scenes.value[i]
        if (scene && scene.frameStatus !== 'done') {
          pipelineStatus.value.currentStep = `生成首尾帧 (${i + 1}/${scenes.value.length})...`
          // 传递场景索引，让 generateFrames 自动获取上一场景尾帧和构建连续性上下文
          await generateFrames(scene, undefined, i)
        }
        pipelineStatus.value.progress = 20 + Math.round((i + 1) / scenes.value.length * 30)
      }

      // 步骤3: 生成视频 (90%)
      pipelineStatus.value.currentStep = '生成场景视频...'
      for (let i = 0; i < scenes.value.length; i++) {
        const scene = scenes.value[i]
        if (scene && scene.videoStatus !== 'done') {
          await generateVideo(scene)
        }
        pipelineStatus.value.progress = 50 + Math.round((i + 1) / scenes.value.length * 40)
      }

      pipelineStatus.value.progress = 100
      pipelineStatus.value.currentStep = '生成完成!'
    } catch (e: unknown) {
      pipelineStatus.value.error = e instanceof Error ? e.message : '生成失败'
      pipelineStatus.value.currentStep = '生成失败'
    } finally {
      pipelineStatus.value.running = false
    }
  }

  // ========== 项目持久化 ==========
  
  // 项目预设配置 (从项目数据库字段读取)
  const projectStyleId = ref<string>('')
  const projectAspectRatio = ref<'16:9' | '9:16' | '1:1'>('16:9')
  
  async function loadProject(id: string) {
    loading.value = true
    try {
      const response = await $fetch<{
        success: boolean
        data: {
          project: { name: string, description?: string, styleId: string, aspectRatio: '16:9' | '9:16' | '1:1' }
          script?: {
            rawText?: string
            storyIdea?: string
            novelText?: string
            selectedStyleId?: string
            selectedModels?: SelectedModels
            outline?: StoryOutline
            inputMode?: 'idea' | 'script'
          }
          scenes: Array<{
            id: string
            title?: string
            description: string
            setting?: { location: string, timeOfDay: string, mood?: string }
            characters: Array<{ name: string, appearance?: string, emotion?: string }>
            dialogues?: Array<{ character: string, text: string, emotion?: string }>
            narration?: string | null
            duration: number
            firstFrame?: string
            lastFrame?: string
            status?: string
          }>
          characters: Array<{
            id: string
            name: string
            role?: string
            appearance: string
            personality?: string
            traits?: string[]
            background?: string
            motivation?: string
            speakingStyle?: string
            catchphrase?: string
            voiceTone?: string
            age?: number
            gender?: string
            baseImage?: string
            expressions?: Record<string, string>
            views?: Partial<Record<CharacterView, string>>
          }>
        }
      }>(`/api/project/${id}`)

      if (response.success && response.data) {
        projectName.value = response.data.project.name
        projectDescription.value = response.data.project.description || ''
        // 加载项目预设配置
        projectStyleId.value = response.data.project.styleId || ''
        projectAspectRatio.value = response.data.project.aspectRatio || '16:9'
        // 同步到 selectedStyleId (兼容旧逻辑)
        selectedStyleId.value = response.data.project.styleId || ''
        // 加载保存的故事创意和小说原文
        const scriptData = response.data.script
        storyIdea.value = scriptData?.storyIdea || scriptData?.rawText || ''
        novelText.value = scriptData?.novelText || ''
        // 加载故事大纲
        if (scriptData?.outline) {
          outline.value = scriptData.outline
        }
        // 加载输入模式
        if (scriptData?.inputMode) {
          inputMode.value = scriptData.inputMode
        }
        // 加载保存的模型选择
        if (scriptData?.selectedModels) {
          selectedModels.value = { ...selectedModels.value, ...scriptData.selectedModels }
        }

        scenes.value = response.data.scenes.map((s, i) => {
          const sceneAny = s as Record<string, unknown>
          return {
            id: s.id,
            title: s.title || `场景 ${i + 1}`,
            description: s.description,
            characters: s.characters || [],
            dialogues: s.dialogues || [],
            narration: s.narration || undefined,
            duration: s.duration || 8,
            setting: s.setting,
            active: i === 0,
            frameError: undefined,
            videoError: undefined,
            // 镜头语言
            shotType: (sceneAny.shotType as ShotType) || 'medium',
            cameraMovement: (sceneAny.cameraMovement as CameraMovement) || 'static',
            cameraNote: (sceneAny.cameraNote as string) || '',
            // 转场
            transitionIn: (sceneAny.transitionIn as WorkbenchTransitionType) || 'cut',
            transitionOut: (sceneAny.transitionOut as WorkbenchTransitionType) || 'cut',
            transitionDuration: (sceneAny.transitionDuration as number) || 0.5,
            // 帧和视频
            firstFrame: s.firstFrame,
            lastFrame: s.lastFrame,
            frameStatus: s.firstFrame ? 'done' as const : 'pending' as const,
            videoUrl: normalizeVideoUrl(sceneAny.videoUrl as string),
            videoStatus: sceneAny.videoUrl ? 'done' as const : 'pending' as const,
            storyboard: (sceneAny.storyboard as Storyboard),
            storyboardStatus: sceneAny.storyboard ? 'done' as const : 'pending' as const,
            sceneVisual: (sceneAny.sceneVisual as SceneVisual),
            sceneVisualStatus: sceneAny.sceneVisual ? 'done' as const : 'pending' as const
          }
        })

        characters.value = response.data.characters.map(c => ({
          id: c.id,
          name: c.name,
          appearance: c.appearance,
          role: c.role || 'supporting',
          personality: toOptionalString((c as { personality?: string | null }).personality),
          age: toOptionalNumber((c as { age?: number | null }).age),
          gender: toOptionalString((c as { gender?: string | null }).gender),
          baseImage: c.baseImage,
          expressions: (c as { expressions?: Record<string, string> }).expressions || undefined,
          views: (c as { views?: Partial<Record<CharacterView, string>> }).views,
          traits: toOptionalStringArray((c as { traits?: string[] | null }).traits),
          background: toOptionalString((c as { background?: string | null }).background),
          motivation: toOptionalString((c as { motivation?: string | null }).motivation),
          speakingStyle: toOptionalString((c as { speakingStyle?: string | null }).speakingStyle),
          catchphrase: toOptionalString((c as { catchphrase?: string | null }).catchphrase),
          voiceTone: toOptionalString((c as { voiceTone?: string | null }).voiceTone),
          generating: false,
          generatingViews: false
        }))

        // 根据数据自动切换输入模式和工作流步骤
        // 如果有小说原文 (novelText)，说明是"直接输入剧本"模式
        // 如果有故事创意 (storyIdea)，说明是"从创意生成"模式
        if (novelText.value) {
          inputMode.value = 'script'
        } else if (storyIdea.value) {
          inputMode.value = 'idea'
        }

        // 根据项目进度自动切换到对应步骤
        if (scenes.value.some(s => s.videoStatus === 'done')) {
          currentStep.value = 'video'
        } else if (scenes.value.some(s => s.firstFrame)) {
          currentStep.value = 'video'
        } else if (characters.value.length > 0) {
          currentStep.value = 'characters'
        } else if (scenes.value.length > 0 || outline.value) {
          currentStep.value = 'outline'
        }
      }
    } catch (e) {
      console.error('加载项目失败:', e)
    } finally {
      loading.value = false
    }
  }

  async function saveProject() {
    saving.value = true
    saveError.value = null
    try {
      let id = projectId.value

      if (!id) {
        // 新建项目时必须有风格和比例
        if (!projectStyleId.value) {
          throw new Error('请先选择画风预设')
        }
        const createRes = await $fetch<{
          success: boolean
          project: { id: string }
        }>('/api/project/create', {
          method: 'POST',
          body: {
            title: projectName.value || '未命名项目',
            description: '',
            styleId: projectStyleId.value,
            aspectRatio: projectAspectRatio.value
          }
        })
        if (createRes.success) {
          id = createRes.project.id
          router.replace({ query: { ...route.query, project: id } })
        }
      }

      if (!id) {
        throw new Error('创建项目失败')
      }

      const normalizeScopedId = (entity: 'scene' | 'char', sourceId: string) => {
        const scopedPrefix = `${entity}_${id}_`
        if (sourceId.startsWith(scopedPrefix)) return sourceId
        return `${scopedPrefix}${sourceId}`
      }

      // 统一规范 ID，避免不同项目间 ID 冲突
      const charIdMap = new Map<string, string>()
      scenes.value.forEach((scene) => {
        const nextId = normalizeScopedId('scene', scene.id)
        if (nextId !== scene.id) {
          scene.id = nextId
        }
      })
      characters.value.forEach((char) => {
        const previousId = char.id
        const nextId = normalizeScopedId('char', previousId)
        if (nextId !== previousId) {
          char.id = nextId
          charIdMap.set(previousId, nextId)
        }
      })
      if (charIdMap.size > 0) {
        relationships.value = relationships.value.map(rel => ({
          ...rel,
          fromCharacterId: charIdMap.get(rel.fromCharacterId) || rel.fromCharacterId,
          toCharacterId: charIdMap.get(rel.toCharacterId) || rel.toCharacterId
        }))
      }

      await $fetch(`/api/project/${id}`, {
        method: 'PUT',
        body: {
          name: projectName.value,
          description: projectDescription.value,
          styleId: projectStyleId.value,
          aspectRatio: projectAspectRatio.value,
          storyIdea: storyIdea.value,
          novelText: novelText.value,
          outline: outline.value,
          inputMode: inputMode.value,
          selectedModels: selectedModels.value,
          scenes: scenes.value.map(s => ({
            id: s.id,
            title: s.title,
            description: s.description,
            setting: s.setting,
            characters: s.characters,
            dialogues: s.dialogues,
            narration: s.narration,
            duration: s.duration,
            // 镜头语言
            shotType: s.shotType,
            cameraMovement: s.cameraMovement,
            cameraNote: s.cameraNote,
            // 转场
            transitionIn: s.transitionIn,
            transitionOut: s.transitionOut,
            transitionDuration: s.transitionDuration,
            // 帧和视频
            firstFrame: s.firstFrame,
            lastFrame: s.lastFrame,
            videoUrl: s.videoUrl,
            storyboard: s.storyboard,
            sceneVisual: s.sceneVisual,
            status: s.videoStatus === 'done' ? 'video_ready' : (s.frameStatus === 'done' ? 'frames_ready' : 'pending')
          })),
          characters: characters.value.map(c => ({
            id: c.id,
            name: c.name,
            role: c.role,
            appearance: c.appearance,
            personality: c.personality,
            traits: c.traits,
            background: c.background,
            motivation: c.motivation,
            speakingStyle: c.speakingStyle,
            catchphrase: c.catchphrase,
            voiceTone: c.voiceTone,
            age: c.age,
            gender: c.gender,
            baseImage: c.baseImage,
            expressions: c.expressions,
            views: c.views
          }))
        }
      })

      console.log('项目保存成功')
    } catch (e) {
      const message = getDisplayErrorMessage(e, '未知错误')
      const isPayloadTooLarge = /413|payload too large|request entity too large/i.test(message)

      if (isPayloadTooLarge) {
        saveError.value = '图片数据过大，项目未完整保存。请增大反向代理请求体限制（例如 Nginx client_max_body_size 50m）后重试。'
      } else {
        saveError.value = message
      }
      console.error('保存项目失败:', e)
    } finally {
      saving.value = false
    }
  }

  return {
    // 项目信息
    projectId,
    projectName,
    projectDescription,
    storyIdea,
    novelText,
    saving,
    saveError,
    loading,

    // 项目预设配置
    projectStyleId,
    projectAspectRatio,

    // 工作流步骤 (新增)
    currentStep,
    setCurrentStep,
    proceedToNextStep,

    // 输入模式 (新增)
    inputMode,

    // 风格选择 (兼容旧逻辑，实际使用 projectStyleId)
    selectedStyleId,
    currentStylePrompt,

    // 模型选择
    selectedModels,

    // 故事大纲 (新增)
    outline,
    generatingOutline,
    generateOutline,

    // 场景
    scenes,
    parsing,
    selectedScene,
    selectScene,
    addNewScene,
    deleteScene,
    updateScene,
    mergeWithNextScene,
    splitScene,
    parseScript,
    generateScenesFromOutline,

    // 分镜和场景视觉 (新增)
    generateStoryboard,
    extractSceneVisual,

    // 角色
    characters,
    generateCharacter,
    batchGenerateCharacters,
    generateCharacterExpression,
    updateCharacter,
    extractCharactersFromScript,
    extractCharactersFromOutline,
    generateCharacterViews,

    // 角色关系 (新增)
    relationships,
    addRelationship,
    updateRelationship,
    removeRelationship,

    // 首尾帧和视频
    generateFrames,
    generateVideo,
    batchGenerateFrames,
    batchGenerateVideos,
    batchFrameStatus,
    batchVideoStatus,

    // 视频合成
    mergeAllVideos,
    mergeStatus,
    finalVideo,

    // 流水线
    pipelineStatus,
    startPipeline,

    // 成本预估
    costEstimate,

    // 项目操作
    loadProject,
    saveProject
  }
}
