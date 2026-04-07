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
      duration: currentScene.duration + nextScene.duration,
      setting: currentScene.setting,
      active: currentScene.active || nextScene.active,
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

    const firstScene: SceneData = {
      id: scene.id,
      title: `${scene.title} (上)`,
      description: firstHalf,
      characters: [...scene.characters],
      dialogues: scene.dialogues.slice(0, dialogueMidPoint),
      duration: Math.ceil(scene.duration / 2),
      setting: scene.setting,
      active: scene.active,
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
      duration: Math.floor(scene.duration / 2),
      setting: scene.setting,
      active: false,
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

        scenes.value = response.data.scenes.map((s, i) => ({
          id: s.id || `scene_${i + 1}`,
          title: s.title || `${s.setting?.location || '场景'} - ${s.setting?.timeOfDay || ''}`,
          description: s.description,
          characters: s.characters || [],
          dialogues: s.dialogues || [],
          duration: s.duration || 8,
          setting: s.setting,
          active: i === 0,
          frameStatus: 'pending' as const,
          videoStatus: 'pending' as const,
          storyboardStatus: 'pending' as const,
          sceneVisualStatus: 'pending' as const
        }))

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
      const response = await $fetch<{
        success: boolean
        scenes: Array<{
          id: string
          title: string
          description: string
          setting: { location: string, timeOfDay: string, mood?: string, weather?: string }
          characters: Array<{ name: string, emotion?: string, action?: string }>
          dialogues: Array<{ character: string, text: string, emotion?: string }>
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
          targetSceneCount: 8,
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
            gender: char.gender,
            age: char.age,
            personality: char.personality,
            traits: char.traits
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

      // 构建角色资产映射
      const characterAssets: Record<string, string> = {}
      characters.value.forEach((char) => {
        if (char.baseImage) {
          characterAssets[char.name] = char.baseImage
        }
      })

      // 构建角色视觉锚点（用于强制角色一致性）
      const characterAnchors = characters.value
        .filter(char => char.baseImage)
        .map(char => ({
          name: char.name,
          coreFeatures: {
            hairStyle: extractFeatureFromAppearance(char.appearance, 'hair'),
            hairColor: extractFeatureFromAppearance(char.appearance, 'hairColor'),
            eyeColor: extractFeatureFromAppearance(char.appearance, 'eye'),
            facialFeatures: extractFeatureFromAppearance(char.appearance, 'face'),
            bodyType: extractFeatureFromAppearance(char.appearance, 'body')
          },
          outfit: {
            description: extractFeatureFromAppearance(char.appearance, 'outfit') || char.appearance || ''
          },
          referenceImage: char.baseImage,
          consistencyWeight: 0.9
        }))

      // 构建连续性上下文
      const continuityContext = buildContinuityContext(currentSceneIndex, totalScenes, !!prevLastFrame)

      console.log(`[generateFrames] 场景 ${scene.id} (${currentSceneIndex + 1}/${totalScenes})`)
      console.log(`[generateFrames] 上一场景尾帧: ${prevLastFrame ? '有' : '无'}`)
      console.log(`[generateFrames] 角色锚点: ${characterAnchors.length}个`)

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
          enforcePreviousFrameConnection: true
        }
      })
      if (response.success) {
        scene.firstFrame = response.firstFrame.imageData
        scene.lastFrame = response.lastFrame.imageData
        scene.frameStatus = 'done'
        console.log(`[generateFrames] 场景 ${scene.id} 首尾帧生成成功`, response.continuityInfo)
        await saveProject()
      }
    } catch (e) {
      console.error('首尾帧生成失败:', e)
      scene.frameStatus = 'error'
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

  // ========== 视频生成 ==========
  async function generateVideo(scene: SceneData) {
    if (!scene.firstFrame || !scene.lastFrame) {
      await generateFrames(scene)
    }
    if (scene.frameStatus !== 'done') return

    scene.videoStatus = 'generating'
    try {
      // 构建增强的视频生成 prompt，优先使用分镜脚本中的信息
      let enhancedPrompt = scene.description

      // 如果有分镜脚本，使用分镜中的镜头信息
      if (scene.storyboard && scene.storyboard.shots.length > 0) {
        const cinematicHints: string[] = []
        
        // 从分镜脚本中提取镜头信息
        const firstShot = scene.storyboard.shots[0]
        if (firstShot) {
          if (firstShot.shotType) {
            const shotTypeDescriptions: Record<string, string> = {
              extreme_wide: 'extreme wide shot showing vast landscape',
              wide: 'wide shot showing full environment',
              medium_wide: 'medium wide shot showing full body with environment',
              medium: 'medium shot from waist up',
              medium_close: 'medium close-up from chest up',
              close: 'close-up shot from shoulders up',
              extreme_close: 'extreme close-up on face or detail',
              detail: 'detail shot focusing on specific object'
            }
            cinematicHints.push(shotTypeDescriptions[firstShot.shotType] || firstShot.shotType)
          }
          
          if (firstShot.cameraMovement && firstShot.cameraMovement !== 'static') {
            const cameraMovementDescriptions: Record<string, string> = {
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
            cinematicHints.push(cameraMovementDescriptions[firstShot.cameraMovement] || firstShot.cameraMovement)
          }
          
          // 使用分镜中的视觉内容描述
          if (firstShot.visualContent) {
            enhancedPrompt = firstShot.visualContent
          }
        }
        
        if (cinematicHints.length > 0) {
          enhancedPrompt = `[Cinematography: ${cinematicHints.join(', ')}] ${enhancedPrompt}`
        }
      } else {
        // 没有分镜脚本时，使用场景级别的镜头设置
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
      }

      // 如果有场景视觉提取的 imagePrompt，也可以参考
      if (scene.sceneVisual?.imagePrompt) {
        console.log('[VideoGen] 场景有视觉提取数据，imagePrompt 长度:', scene.sceneVisual.imagePrompt.length)
      }

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
            aspectRatio: '16:9',
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
            result?: { videoData?: string }
          }
        }>(`/api/video/status/${taskId}`)

        if (response.task.status === 'completed' && response.task.result?.videoData) {
          const videoData = response.task.result.videoData
          if (videoData.startsWith('url:')) {
            scene.videoUrl = videoData.substring(4)
          } else if (videoData.startsWith('data:') || videoData.startsWith('http')) {
            scene.videoUrl = videoData
          } else if (videoData.startsWith('ref:')) {
            console.warn('视频为引用类型，暂不支持播放')
            scene.videoStatus = 'error'
            return
          } else {
            scene.videoUrl = `data:video/mp4;base64,${videoData}`
          }
          scene.videoStatus = 'done'
          await saveProject()
          return
        } else if (response.task.status === 'failed') {
          scene.videoStatus = 'error'
          return
        }
      } catch (e) {
        console.error('状态查询失败:', e)
      }
    }
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
          script?: { rawText: string }
          scenes: Array<{
            id: string
            title?: string
            description: string
            setting?: { location: string, timeOfDay: string, mood?: string }
            characters: Array<{ name: string, appearance?: string, emotion?: string }>
            dialogues?: Array<{ character: string, text: string, emotion?: string }>
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
            baseImage?: string
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
        const scriptData = response.data.script as { 
          rawText?: string
          storyIdea?: string
          novelText?: string
          selectedStyleId?: string
          selectedModels?: SelectedModels
          outline?: StoryOutline
          inputMode?: 'idea' | 'script'
        } | undefined
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
            duration: s.duration || 8,
            setting: s.setting,
            active: i === 0,
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
            videoUrl: (sceneAny.videoUrl as string),
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
          baseImage: c.baseImage,
          views: (c as { views?: Partial<Record<CharacterView, string>> }).views,
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
            baseImage: c.baseImage,
            views: c.views
          }))
        }
      })

      console.log('项目保存成功')
    } catch (e) {
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
