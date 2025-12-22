/**
 * Workbench 工作台共享状态和逻辑
 * 提供场景、角色、音频配置等核心功能
 */

// 分镜数据接口
export interface StoryboardShot {
  shotNumber: number
  shotType: 'wide' | 'medium' | 'close' | 'extreme_close' | 'detail'
  cameraMovement: 'static' | 'push' | 'pull' | 'pan_left' | 'pan_right' | 'track' | 'dolly' | 'zoom_in' | 'zoom_out'
  visualContent: string
  dialogue?: string | null
  character?: string | null
  emotion?: string
  duration: number
  notes?: string
}

export interface Storyboard {
  sceneId: string
  sceneTitle: string
  shots: StoryboardShot[]
  totalDuration: number
}

// 场景视觉数据接口
export interface SceneVisual {
  sceneId: string
  time: string
  location: string
  visualElements: string[]
  atmosphere: string
  sensoryDetails: string
  imagePrompt: string
}

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
  // 生成状态
  firstFrame?: string
  lastFrame?: string
  videoUrl?: string
  frameStatus: 'pending' | 'generating' | 'done' | 'error'
  videoStatus: 'pending' | 'generating' | 'done' | 'error'
  // 新增：分镜和场景视觉
  storyboard?: Storyboard
  storyboardStatus: 'pending' | 'generating' | 'done' | 'error'
  sceneVisual?: SceneVisual
  sceneVisualStatus: 'pending' | 'generating' | 'done' | 'error'
}

// 角色视角类型
export type CharacterView = 'front' | 'three_quarter' | 'side' | 'back' | 'top_down' | 'bottom_up'

// 角色数据接口
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
}

// 音频配置接口
export interface AudioConfig {
  enabled: boolean
  bgmEnabled: boolean
  voices: Record<string, string>
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
  const scriptText = ref('')
  const saving = ref(false)
  const loading = ref(false)

  // ========== 场景数据 ==========
  const scenes = ref<SceneData[]>([])
  const parsing = ref(false)

  // ========== 角色数据 ==========
  const characters = ref<CharacterData[]>([])

  // ========== 音频配置 ==========
  const audioConfig = ref<AudioConfig>({
    enabled: true,
    bgmEnabled: false,
    voices: {}
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
    if (!scriptText.value.trim()) return

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
        body: { text: scriptText.value }
      })

      if (response.success && response.data?.scenes) {
        if (response.data.title && projectName.value === '新项目') {
          projectName.value = response.data.title
        }

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

        const charNames = new Set<string>()
        scenes.value.forEach(s => s.characters.forEach(c => charNames.add(c.name)))

        characters.value = Array.from(charNames).map((name, i) => {
          const charInfo = response.data.characters?.find(c => c.name === name)
          const sceneChar = scenes.value.flatMap(s => s.characters).find(c => c.name === name)
          return {
            id: `char_${i + 1}`,
            name,
            appearance: sceneChar?.appearance || charInfo?.description || '',
            role: charInfo?.role || 'supporting',
            generating: false,
            generatingViews: false
          }
        })

        await saveProject()
      }
    } catch (e) {
      console.error('解析失败:', e)
    } finally {
      parsing.value = false
    }
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
            appearance: char.appearance || `${char.name}，动漫风格角色`
          },
          style: '日式动漫',
          generateExpressions: false
        }
      })
      if (response.success) {
        char.baseImage = response.asset.baseImage
        await saveProject()
      }
    } catch (e) {
      console.error('角色生成失败:', e)
    } finally {
      char.generating = false
    }
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

  // ========== 角色提取 (新增API) ==========
  async function extractCharactersFromScript() {
    if (!scriptText.value.trim()) return

    try {
      const response = await $fetch<{
        success: boolean
        characters: Array<{ role: string, role_content: string }>
      }>('/api/character/extract', {
        method: 'POST',
        body: {
          content: scriptText.value,
          style: '日式动漫'
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
          style: '日式动漫',
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
          style: '日式动漫'
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
          style: '日式动漫'
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
  async function generateFrames(scene: SceneData, previousSceneLastFrame?: string) {
    scene.frameStatus = 'generating'
    try {
      const characterAssets: Record<string, string> = {}
      characters.value.forEach((char) => {
        if (char.baseImage) {
          characterAssets[char.name] = char.baseImage
        }
      })

      const response = await $fetch<{
        success: boolean
        firstFrame: { imageData: string }
        lastFrame: { imageData: string }
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
          style: '日式动漫',
          characterAssets,
          previousSceneLastFrame
        }
      })
      if (response.success) {
        scene.firstFrame = response.firstFrame.imageData
        scene.lastFrame = response.lastFrame.imageData
        scene.frameStatus = 'done'
        await saveProject()
      }
    } catch (e) {
      console.error('首尾帧生成失败:', e)
      scene.frameStatus = 'error'
    }
  }

  // ========== 视频生成 ==========
  async function generateVideo(scene: SceneData) {
    if (!scene.firstFrame || !scene.lastFrame) {
      await generateFrames(scene)
    }
    if (scene.frameStatus !== 'done') return

    scene.videoStatus = 'generating'
    try {
      const response = await $fetch<{
        success: boolean
        taskId: string
      }>('/api/video/generate', {
        method: 'POST',
        body: {
          sceneId: scene.id,
          config: {
            prompt: scene.description,
            firstFrame: scene.firstFrame,
            lastFrame: scene.lastFrame,
            duration: scene.duration || 8,
            resolution: '720p',
            aspectRatio: '16:9',
            withAudio: audioConfig.value.enabled,
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
  async function batchGenerateFrames() {
    const pendingScenes = scenes.value.filter(s => s.frameStatus !== 'done')
    if (pendingScenes.length === 0) {
      alert('所有场景已完成首尾帧生成')
      return
    }

    batchFrameStatus.value = { running: true, current: 0, total: pendingScenes.length }

    try {
      for (let i = 0; i < scenes.value.length; i++) {
        const scene = scenes.value[i]
        if (scene && scene.frameStatus !== 'done') {
          const prevScene = i > 0 ? scenes.value[i - 1] : undefined
          await generateFrames(scene, prevScene?.lastFrame)
          batchFrameStatus.value.current++
        }
      }
      await saveProject()
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

      // 步骤2: 生成首尾帧 (50%)
      pipelineStatus.value.currentStep = '生成首尾帧...'
      for (let i = 0; i < scenes.value.length; i++) {
        const scene = scenes.value[i]
        if (scene && scene.frameStatus !== 'done') {
          const prevScene = i > 0 ? scenes.value[i - 1] : undefined
          await generateFrames(scene, prevScene?.lastFrame)
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
  async function loadProject(id: string) {
    loading.value = true
    try {
      const response = await $fetch<{
        success: boolean
        data: {
          project: { name: string, description?: string }
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
        scriptText.value = response.data.script?.rawText || ''

        scenes.value = response.data.scenes.map((s, i) => ({
          id: s.id,
          title: s.title || `场景 ${i + 1}`,
          description: s.description,
          characters: s.characters || [],
          dialogues: s.dialogues || [],
          duration: s.duration || 8,
          setting: s.setting,
          active: i === 0,
          firstFrame: s.firstFrame,
          lastFrame: s.lastFrame,
          frameStatus: s.firstFrame ? 'done' as const : 'pending' as const,
          videoUrl: (s as { videoUrl?: string }).videoUrl,
          videoStatus: (s as { videoUrl?: string }).videoUrl ? 'done' as const : 'pending' as const,
          storyboard: (s as { storyboard?: Storyboard }).storyboard,
          storyboardStatus: (s as { storyboard?: Storyboard }).storyboard ? 'done' as const : 'pending' as const,
          sceneVisual: (s as { sceneVisual?: SceneVisual }).sceneVisual,
          sceneVisualStatus: (s as { sceneVisual?: SceneVisual }).sceneVisual ? 'done' as const : 'pending' as const
        }))

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
        const createRes = await $fetch<{
          success: boolean
          project: { id: string }
        }>('/api/project/create', {
          method: 'POST',
          body: {
            title: projectName.value || '未命名项目',
            description: ''
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
          rawText: scriptText.value,
          scenes: scenes.value.map(s => ({
            id: s.id,
            title: s.title,
            description: s.description,
            setting: s.setting,
            characters: s.characters,
            dialogues: s.dialogues,
            duration: s.duration,
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
    scriptText,
    saving,
    loading,

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

    // 分镜和场景视觉 (新增)
    generateStoryboard,
    extractSceneVisual,

    // 角色
    characters,
    generateCharacter,
    generateCharacterExpression,
    updateCharacter,
    extractCharactersFromScript,
    generateCharacterViews,

    // 首尾帧和视频
    generateFrames,
    generateVideo,
    batchGenerateFrames,
    batchGenerateVideos,
    batchFrameStatus,
    batchVideoStatus,

    // 流水线
    pipelineStatus,
    startPipeline,

    // 音频
    audioConfig,

    // 成本预估
    costEstimate,

    // 项目操作
    loadProject,
    saveProject
  }
}
