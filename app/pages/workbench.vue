<script setup lang="ts">
import { FileText, Users, Video, Music, Sparkles, Plus, Pencil, Trash2, Loader2, Play, Image, Check, AlertCircle, Merge, Split, ChevronDown } from 'lucide-vue-next'

// 生成工作台页面
definePageMeta({
  layout: 'default'
})

const route = useRoute()
const router = useRouter()
const projectId = computed(() => route.query.project as string | undefined)

// 支持 URL 参数切换标签页
const validTabs = ['script', 'characters', 'video', 'audio']
const activeTab = ref((route.query.tab as string) || 'script')

// 监听 URL 参数变化
watch(() => route.query.tab, (newTab) => {
  if (newTab && validTabs.includes(newTab as string)) {
    activeTab.value = newTab as string
  } else if (!newTab) {
    activeTab.value = 'script'
  }
})

// 切换标签时更新 URL
function setActiveTab(tab: string) {
  activeTab.value = tab
  router.replace({
    query: { ...route.query, tab: tab === 'script' ? undefined : tab }
  })
}
const scriptText = ref('')

// 场景数据
interface SceneData {
  id: string
  title: string
  description: string
  characters: Array<{ name: string; appearance?: string; emotion?: string }>
  dialogues: Array<{ character: string; text: string; emotion?: string }>
  duration: number
  setting?: { location: string; timeOfDay: string }
  active: boolean
  // 生成状态
  firstFrame?: string
  lastFrame?: string
  videoUrl?: string
  frameStatus: 'pending' | 'generating' | 'done' | 'error'
  videoStatus: 'pending' | 'generating' | 'done' | 'error'
}

const scenes = ref<SceneData[]>([])
const parsing = ref(false)

// 角色数据
interface CharacterData {
  id: string
  name: string
  appearance: string
  role: string
  baseImage?: string
  expressions?: Record<string, string> // 表情图片: { happy: 'base64...', sad: 'base64...' }
  generating: boolean
}
const characters = ref<CharacterData[]>([])

// 音频配置
const audioConfig = ref({
  enabled: true,
  bgmEnabled: false,
  voices: {} as Record<string, string>
})

// 流水线状态
const pipelineStatus = ref<{
  running: boolean
  taskId?: string
  progress: number
  currentStep: string
  error?: string
}>({
  running: false,
  progress: 0,
  currentStep: ''
})

// 图片预览状态
const imagePreviewOpen = ref(false)
const imagePreviewSrc = ref('')
const imagePreviewAlt = ref('')

function openImagePreview(src: string, alt = '图片预览') {
  imagePreviewSrc.value = src
  imagePreviewAlt.value = alt
  imagePreviewOpen.value = true
}

const tabs = [
  { key: 'script', label: '剧本编辑', icon: FileText },
  { key: 'characters', label: '角色管理', icon: Users },
  { key: 'video', label: '视频生成', icon: Video },
  { key: 'audio', label: '音频配置', icon: Music }
]

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
          characters: Array<{ name: string; appearance?: string; emotion?: string }>
          dialogues?: Array<{ character: string; text: string; emotion?: string }>
          duration: number
          setting?: { location: string; timeOfDay: string }
        }>
        characters?: Array<{ name: string; description?: string; role?: string }>
      }
    }>('/api/script/parse', {
      method: 'POST',
      body: { text: scriptText.value }
    })

    if (response.success && response.data?.scenes) {
      // 自动设置项目名称（基于解析出的标题）
      if (response.data.title && projectName.value === '新项目') {
        projectName.value = response.data.title
      }

      // 更新场景
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
        videoStatus: 'pending' as const
      }))

      // 提取角色
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
          generating: false
        }
      })

      // 自动保存
      await saveProject()
    }
  } catch (e) {
    console.error('解析失败:', e)
  } finally {
    parsing.value = false
  }
}

// ========== 角色管理 ==========
const characterEditDialogOpen = ref(false)
const editingCharacter = ref<CharacterData | null>(null)
const characterEditDialogRef = ref<{ updateExpression: (emotion: string, imageData: string) => void } | null>(null)

function openCharacterEdit(char: CharacterData) {
  editingCharacter.value = char
  characterEditDialogOpen.value = true
}

function handleCharacterSave(updatedChar: {
  id: string
  name: string
  appearance: string
  role: string
  baseImage?: string
  expressions?: Record<string, string>
}) {
  const charIndex = characters.value.findIndex(c => c.id === updatedChar.id)
  if (charIndex !== -1) {
    const existingChar = characters.value[charIndex]
    if (existingChar) {
      characters.value[charIndex] = {
        ...existingChar,
        name: updatedChar.name,
        appearance: updatedChar.appearance,
        role: updatedChar.role,
        expressions: updatedChar.expressions
      }
      saveProject()
    }
  }
  characterEditDialogOpen.value = false
  editingCharacter.value = null
}

// 生成角色立绘
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
      // 自动保存
      await saveProject()
    }
  } catch (e) {
    console.error('角色生成失败:', e)
  } finally {
    char.generating = false
  }
}

// 生成角色表情变体
async function generateCharacterExpression(characterId: string, emotion: string) {
  const char = characters.value.find(c => c.id === characterId)
  if (!char || !char.baseImage) {
    console.warn('需要先生成角色基础立绘')
    return
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
      // 更新角色表情
      if (!char.expressions) {
        char.expressions = {}
      }
      char.expressions[emotion] = response.expressionImage

      // 更新编辑对话框中的表情
      if (characterEditDialogRef.value) {
        characterEditDialogRef.value.updateExpression(emotion, response.expressionImage)
      }

      // 保存项目
      await saveProject()
    }
  } catch (e) {
    console.error('表情生成失败:', e)
  }
}

// ========== 首尾帧生成 ==========
async function generateFrames(scene: SceneData, previousSceneLastFrame?: string) {
  scene.frameStatus = 'generating'
  try {
    // 构建角色资产映射 (name -> base64)
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
        // 传递上一场景的尾帧，用于保持场景连续性
        previousSceneLastFrame
      }
    })
    if (response.success) {
      scene.firstFrame = response.firstFrame.imageData
      scene.lastFrame = response.lastFrame.imageData
      scene.frameStatus = 'done'
      // 自动保存
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
          model: 'fast' // 使用 Veo 3.1 Fast 快速模型
        }
      }
    })
    
    if (response.success && response.taskId) {
      // 轮询视频状态
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
          result?: {
            videoData?: string
          }
        }
      }>(`/api/video/status/${taskId}`)

      if (response.task.status === 'completed' && response.task.result?.videoData) {
        const videoData = response.task.result.videoData
        // 格式化视频 URL
        if (videoData.startsWith('url:')) {
          // 服务端返回的 URL 路径
          scene.videoUrl = videoData.substring(4)
        } else if (videoData.startsWith('data:') || videoData.startsWith('http')) {
          scene.videoUrl = videoData
        } else if (videoData.startsWith('ref:')) {
          // 引用类型，需要单独下载
          console.warn('视频为引用类型，暂不支持播放')
          scene.videoStatus = 'error'
          return
        } else {
          // 假设是 base64 数据
          scene.videoUrl = `data:video/mp4;base64,${videoData}`
        }
        scene.videoStatus = 'done'
        // 自动保存
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

// ========== 批量生成首尾帧 ==========
const batchFrameStatus = ref({
  running: false,
  current: 0,
  total: 0
})

async function batchGenerateFrames() {
  const pendingScenes = scenes.value.filter(s => s.frameStatus !== 'done')
  if (pendingScenes.length === 0) {
    alert('所有场景已完成首尾帧生成')
    return
  }

  batchFrameStatus.value = {
    running: true,
    current: 0,
    total: pendingScenes.length
  }

  try {
    for (let i = 0; i < scenes.value.length; i++) {
      const scene = scenes.value[i]
      if (scene && scene.frameStatus !== 'done') {
        // 获取上一场景的尾帧保持连续性
        const prevScene = i > 0 ? scenes.value[i - 1] : undefined
        const previousSceneLastFrame = prevScene?.lastFrame
        await generateFrames(scene, previousSceneLastFrame)
        batchFrameStatus.value.current++
      }
    }
    await saveProject()
  } finally {
    batchFrameStatus.value.running = false
  }
}

// ========== 批量生成视频 ==========
const batchVideoStatus = ref({
  running: false,
  current: 0,
  total: 0
})

async function batchGenerateVideos() {
  const readyScenes = scenes.value.filter(s => s.frameStatus === 'done' && s.videoStatus !== 'done')
  if (readyScenes.length === 0) {
    alert('没有可生成视频的场景（请先生成首尾帧）')
    return
  }

  batchVideoStatus.value = {
    running: true,
    current: 0,
    total: readyScenes.length
  }

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

// ========== 开始生成流水线 ==========
async function startPipeline() {
  if (scenes.value.length === 0) {
    alert('请先解析剧本')
    return
  }

  pipelineStatus.value = {
    running: true,
    progress: 0,
    currentStep: '初始化...'
  }

  try {
    // 步骤1: 生成角色 (20%)
    pipelineStatus.value.currentStep = '生成角色立绘...'
    for (const char of characters.value) {
      if (!char.baseImage) {
        await generateCharacter(char)
      }
    }
    pipelineStatus.value.progress = 20

    // 步骤2: 生成首尾帧 (50%) - 按顺序生成，传递上一场景尾帧保持连续性
    pipelineStatus.value.currentStep = '生成首尾帧...'
    for (let i = 0; i < scenes.value.length; i++) {
      const scene = scenes.value[i]
      if (scene && scene.frameStatus !== 'done') {
        // 获取上一场景的尾帧（如果存在）
        const prevScene = i > 0 ? scenes.value[i - 1] : undefined
        const previousSceneLastFrame = prevScene?.lastFrame
        await generateFrames(scene, previousSceneLastFrame)
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

    // 完成
    pipelineStatus.value.progress = 100
    pipelineStatus.value.currentStep = '生成完成!'
    
  } catch (e: any) {
    pipelineStatus.value.error = e.message || '生成失败'
    pipelineStatus.value.currentStep = '生成失败'
  } finally {
    pipelineStatus.value.running = false
  }
}

// 选中场景
function selectScene(scene: SceneData) {
  scenes.value.forEach(s => s.active = false)
  scene.active = true
}

const selectedScene = computed(() => scenes.value.find(s => s.active))

// ========== 场景编辑 ==========
const editDialogOpen = ref(false)
const editingScene = ref<SceneData | null>(null)

function openSceneEdit(scene: SceneData) {
  editingScene.value = scene
  editDialogOpen.value = true
}

function handleSceneSave(updatedScene: {
  id: string
  title: string
  description: string
  characters: Array<{ name: string; appearance?: string; emotion?: string }>
  dialogues: Array<{ character: string; text: string; emotion?: string }>
  duration: number
  setting?: { location: string; timeOfDay: string }
}) {
  const sceneIndex = scenes.value.findIndex(s => s.id === updatedScene.id)
  if (sceneIndex !== -1) {
    const existingScene = scenes.value[sceneIndex]
    if (existingScene) {
      // 检查描述是否变化
      const descriptionChanged = existingScene.description !== updatedScene.description
      // 更新场景数据
      scenes.value[sceneIndex] = {
        ...existingScene,
        title: updatedScene.title,
        description: updatedScene.description,
        characters: updatedScene.characters,
        dialogues: updatedScene.dialogues,
        duration: updatedScene.duration,
        setting: updatedScene.setting,
        // 如果描述变了，需要重新生成首尾帧
        frameStatus: descriptionChanged ? 'pending' as const : existingScene.frameStatus
      }
      // 自动保存
      saveProject()
    }
  }
  editDialogOpen.value = false
  editingScene.value = null
}

// 删除场景
function deleteScene(scene: SceneData) {
  if (confirm(`确定要删除场景"${scene.title}"吗？`)) {
    const index = scenes.value.findIndex(s => s.id === scene.id)
    if (index !== -1) {
      scenes.value.splice(index, 1)
      // 如果删除的是当前选中的场景，选中第一个
      if (scene.active && scenes.value.length > 0) {
        scenes.value[0].active = true
      }
      saveProject()
    }
  }
}

// 添加新场景
function addNewScene() {
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
    videoStatus: 'pending'
  }
  scenes.value.push(newScene)
  // 打开编辑对话框
  openSceneEdit(newScene)
}

// ========== 场景拖拽排序 ==========
const draggedSceneIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function handleDragStart(event: DragEvent, index: number) {
  draggedSceneIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function handleDragOver(event: DragEvent, index: number) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  dragOverIndex.value = index
}

function handleDragLeave() {
  dragOverIndex.value = null
}

function handleDrop(event: DragEvent, targetIndex: number) {
  event.preventDefault()
  const sourceIndex = draggedSceneIndex.value
  
  if (sourceIndex !== null && sourceIndex !== targetIndex) {
    // 移动场景
    const [movedScene] = scenes.value.splice(sourceIndex, 1)
    if (movedScene) {
      scenes.value.splice(targetIndex, 0, movedScene)
      // 保存项目
      saveProject()
    }
  }
  
  draggedSceneIndex.value = null
  dragOverIndex.value = null
}

function handleDragEnd() {
  draggedSceneIndex.value = null
  dragOverIndex.value = null
}

// ========== 场景合并/拆分 ==========
// 合并当前场景与下一个场景
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

  // 合并场景数据
  const mergedScene: SceneData = {
    id: currentScene.id,
    title: `${currentScene.title} + ${nextScene.title}`,
    description: `${currentScene.description}\n\n${nextScene.description}`,
    characters: [...currentScene.characters],
    dialogues: [...currentScene.dialogues, ...nextScene.dialogues],
    duration: currentScene.duration + nextScene.duration,
    setting: currentScene.setting,
    active: currentScene.active || nextScene.active,
    frameStatus: 'pending', // 需要重新生成
    videoStatus: 'pending'
  }

  // 合并角色（去重）
  nextScene.characters.forEach(char => {
    if (!mergedScene.characters.find(c => c.name === char.name)) {
      mergedScene.characters.push(char)
    }
  })

  // 更新场景列表
  scenes.value.splice(sceneIndex, 2, mergedScene)

  // 保存项目
  saveProject()
}

// 拆分场景（在描述中间位置拆分）
function splitScene(sceneIndex: number) {
  const scene = scenes.value[sceneIndex]
  if (!scene) return

  // 找到描述的中间位置（按句号分割）
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

  // 按对话数量也进行拆分
  const dialogueMidPoint = Math.ceil(scene.dialogues.length / 2)

  // 创建两个新场景
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
    videoStatus: 'pending'
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
    videoStatus: 'pending'
  }

  // 更新场景列表
  scenes.value.splice(sceneIndex, 1, firstScene, secondScene)

  // 保存项目
  saveProject()
}

// ========== 项目持久化 ==========
const projectName = ref('新项目')
const projectDescription = ref('')
const saving = ref(false)
const loading = ref(false)

// ========== 成本预估 ==========
const costEstimate = computed(() => {
  const sceneCount = scenes.value.length
  const charCount = characters.value.length
  
  // 预估成本（基于API调用次数）
  const frameCost = sceneCount * 2 * 0.02 // 每个场景2张图，每张约$0.02
  const videoCost = sceneCount * 0.15 // 每个场景视频约$0.15
  const characterCost = charCount * 0.02 // 每个角色立绘约$0.02
  const expressionCost = charCount * 5 * 0.01 // 每角色5个表情，每个约$0.01
  
  const totalCost = frameCost + videoCost + characterCost + expressionCost
  
  // 预估时间（秒）
  const frameTime = sceneCount * 2 * 15 // 每张图约15秒
  const videoTime = sceneCount * 60 // 每个视频约60秒
  const characterTime = charCount * 20 // 每个角色约20秒
  
  const totalTime = frameTime + videoTime + characterTime
  
  return {
    sceneCount,
    charCount,
    totalCost: totalCost.toFixed(2),
    totalTime: Math.ceil(totalTime / 60), // 转为分钟
    breakdown: {
      frames: { count: sceneCount * 2, cost: frameCost.toFixed(2) },
      videos: { count: sceneCount, cost: videoCost.toFixed(2) },
      characters: { count: charCount, cost: characterCost.toFixed(2) }
    }
  }
})

// 加载项目数据
async function loadProject(id: string) {
  loading.value = true
  try {
    const response = await $fetch<{
      success: boolean
      data: {
        project: { name: string; description?: string }
        script?: { rawText: string }
        scenes: Array<{
          id: string
          title?: string
          description: string
          setting?: { location: string; timeOfDay: string; mood?: string }
          characters: Array<{ name: string; appearance?: string; emotion?: string }>
          dialogues?: Array<{ character: string; text: string; emotion?: string }>
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

      // 加载场景
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
        videoUrl: s.videoUrl, // 加载视频 URL
        videoStatus: s.videoUrl ? 'done' as const : 'pending' as const
      }))

      // 加载角色
      characters.value = response.data.characters.map(c => ({
        id: c.id,
        name: c.name,
        appearance: c.appearance,
        role: c.role || 'supporting',
        baseImage: c.baseImage,
        generating: false
      }))
    }
  } catch (e) {
    console.error('加载项目失败:', e)
  } finally {
    loading.value = false
  }
}

// 保存项目
async function saveProject() {
  saving.value = true
  try {
    let id = projectId.value

    // 如果没有项目ID，先创建项目
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
        // 更新 URL 添加项目ID
        router.replace({ query: { ...route.query, project: id } })
      }
    }

    if (!id) {
      throw new Error('创建项目失败')
    }

    // 保存项目数据
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
          videoUrl: s.videoUrl, // 保存视频 URL
          status: s.videoStatus === 'done' ? 'video_ready' : (s.frameStatus === 'done' ? 'frames_ready' : 'pending')
        })),
        characters: characters.value.map(c => ({
          id: c.id,
          name: c.name,
          role: c.role,
          appearance: c.appearance,
          baseImage: c.baseImage
        }))
      }
    })

    console.log('项目保存成功')
  } catch (e) {
    // 保存失败只记录日志，不阻断流程
    console.error('保存项目失败:', e)
  } finally {
    saving.value = false
  }
}

// 页面加载时加载项目
onMounted(() => {
  if (projectId.value) {
    loadProject(projectId.value)
  }
})
</script>

<template>
  <div class="p-8">
    <div class="flex justify-between items-start mb-8">
      <div class="space-y-2">
        <div class="flex items-center space-x-3">
          <Input
            v-model="projectName"
            class="text-2xl font-bold h-auto py-1 px-2 w-64 border-transparent hover:border-input focus:border-primary"
            placeholder="输入项目名称..."
          />
          <Badge v-if="projectId" variant="secondary" class="text-xs">
            {{ projectId }}
          </Badge>
        </div>
        <Input
          v-model="projectDescription"
          class="text-sm text-muted-foreground h-auto py-1 px-2 w-96 border-transparent hover:border-input focus:border-primary"
          placeholder="添加项目描述..."
        />
      </div>

      <div class="flex items-center space-x-4">
        <!-- 成本预估 -->
        <div v-if="scenes.length > 0" class="text-right text-sm space-y-1">
          <div class="flex items-center space-x-2 text-muted-foreground">
            <span>{{ costEstimate.sceneCount }} 场景</span>
            <span>·</span>
            <span>{{ costEstimate.charCount }} 角色</span>
          </div>
          <div class="flex items-center space-x-2">
            <span class="text-xs text-muted-foreground">预估:</span>
            <Badge variant="outline" class="text-xs">
              ~${{ costEstimate.totalCost }}
            </Badge>
            <Badge variant="outline" class="text-xs">
              ~{{ costEstimate.totalTime }}分钟
            </Badge>
          </div>
        </div>

        <!-- 流水线进度 -->
        <div v-if="pipelineStatus.running" class="flex items-center space-x-2 text-sm">
          <Loader2 class="w-4 h-4 animate-spin" />
          <span>{{ pipelineStatus.currentStep }}</span>
          <span class="text-muted-foreground">{{ pipelineStatus.progress }}%</span>
        </div>
        <Button variant="outline" :disabled="pipelineStatus.running || saving" @click="saveProject">
          <Loader2 v-if="saving" class="w-4 h-4 mr-2 animate-spin" />
          {{ saving ? '保存中...' : '保存草稿' }}
        </Button>
        <Button @click="startPipeline" :disabled="scenes.length === 0 || pipelineStatus.running">
          <Play v-if="!pipelineStatus.running" class="w-4 h-4 mr-2" />
          <Loader2 v-else class="w-4 h-4 mr-2 animate-spin" />
          {{ pipelineStatus.running ? '生成中...' : '开始生成' }}
        </Button>
      </div>
    </div>

    <Card>
      <!-- 标签栏 -->
      <div class="flex border-b">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="px-6 py-4 font-medium flex items-center space-x-2 transition"
          :class="activeTab === tab.key
            ? 'text-primary border-b-2 border-primary bg-accent'
            : 'text-muted-foreground hover:bg-accent'"
          @click="setActiveTab(tab.key)"
        >
          <component
            :is="tab.icon"
            class="w-4 h-4"
          />
          <span>{{ tab.label }}</span>
        </button>
      </div>

      <CardContent class="pt-6">
        <!-- 剧本编辑面板 -->
        <div
          v-if="activeTab === 'script'"
          class="grid lg:grid-cols-2 gap-6"
        >
          <!-- 左侧: 原文输入 -->
          <div>
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-semibold">
                原文输入
              </h3>
              <Button
                variant="ghost"
                size="sm"
                :disabled="parsing || !scriptText.trim()"
                @click="parseScript"
              >
                <Loader2
                  v-if="parsing"
                  class="w-4 h-4 mr-2 animate-spin"
                />
                <Sparkles
                  v-else
                  class="w-4 h-4 mr-2"
                />
                {{ parsing ? '解析中...' : 'AI解析' }}
              </Button>
            </div>
            <Textarea
              v-model="scriptText"
              class="min-h-[300px]"
              placeholder="粘贴或输入小说文本..."
            />
          </div>

          <!-- 右侧: 解析结果 -->
          <div>
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-semibold">
                场景列表
              </h3>
              <Button
                variant="ghost"
                size="sm"
                @click="addNewScene"
              >
                <Plus class="w-4 h-4" />
              </Button>
            </div>
            <div class="space-y-4 max-h-[400px] overflow-y-auto">
              <div
                v-for="(scene, sceneIndex) in scenes"
                :key="scene.id"
                class="border rounded-xl p-4 cursor-pointer transition group"
                :class="[
                  scene.active ? 'border-primary bg-accent' : 'hover:border-primary/50',
                  dragOverIndex === sceneIndex && draggedSceneIndex !== sceneIndex ? 'border-dashed border-2 border-primary' : '',
                  draggedSceneIndex === sceneIndex ? 'opacity-50' : ''
                ]"
                draggable="true"
                @click="selectScene(scene)"
                @dragstart="handleDragStart($event, sceneIndex)"
                @dragover="handleDragOver($event, sceneIndex)"
                @dragleave="handleDragLeave"
                @drop="handleDrop($event, sceneIndex)"
                @dragend="handleDragEnd"
              >
                <div class="flex items-start justify-between mb-2">
                  <div class="flex items-center space-x-2">
                    <!-- 拖拽手柄 -->
                    <div class="cursor-grab opacity-0 group-hover:opacity-100 transition text-muted-foreground">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>
                    </div>
                    <Badge :variant="scene.active ? 'default' : 'secondary'">
                      场景 {{ sceneIndex + 1 }}
                    </Badge>
                  </div>
                  <div class="flex space-x-1 opacity-0 group-hover:opacity-100 transition">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 w-7 p-0"
                      title="拆分场景"
                      @click.stop="splitScene(sceneIndex)"
                    >
                      <Split class="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 w-7 p-0"
                      title="与下一场景合并"
                      :disabled="sceneIndex >= scenes.length - 1"
                      @click.stop="mergeWithNextScene(sceneIndex)"
                    >
                      <Merge class="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 w-7 p-0"
                      title="编辑场景"
                      @click.stop="openSceneEdit(scene)"
                    >
                      <Pencil class="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      title="删除场景"
                      @click.stop="deleteScene(scene)"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <h4 class="font-medium mb-1">
                  {{ scene.title }}
                </h4>
                <p class="text-sm text-muted-foreground mb-2 line-clamp-2">
                  {{ scene.description }}
                </p>
                <div class="flex flex-wrap gap-2">
                  <Badge
                    v-for="char in scene.characters"
                    :key="char.name"
                    variant="outline"
                  >
                    {{ char.name }}
                  </Badge>
                  <Badge variant="outline">
                    {{ scene.duration }}秒
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 角色管理面板 -->
        <div v-else-if="activeTab === 'characters'" class="space-y-6">
          <div v-if="characters.length === 0" class="text-center py-12 text-muted-foreground">
            <Users class="w-12 h-12 mx-auto mb-4" />
            <p>请先在剧本编辑中解析文本，自动提取角色</p>
          </div>
          <div v-else class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div
              v-for="char in characters"
              :key="char.id"
              class="border rounded-xl p-4 hover:border-primary/50 transition"
            >
              <div class="flex items-start space-x-4">
                <div class="w-20 h-20 bg-gradient-to-br from-purple-100 to-pink-100 rounded-lg flex items-center justify-center overflow-hidden">
                  <img
                    v-if="char.baseImage"
                    :src="`data:image/png;base64,${char.baseImage}`"
                    class="w-full h-full object-cover cursor-pointer hover:opacity-80 transition"
                    @click.stop="openImagePreview(`data:image/png;base64,${char.baseImage}`, `${char.name} 立绘`)"
                  />
                  <Users v-else class="w-8 h-8 text-muted-foreground" />
                </div>
                <div class="flex-1 min-w-0">
                  <h4 class="font-semibold">{{ char.name }}</h4>
                  <p class="text-sm text-muted-foreground line-clamp-2">
                    {{ char.appearance || '暂无外貌描述' }}
                  </p>
                  <div class="flex items-center space-x-2 mt-2">
                    <Badge variant="outline">
                      {{ char.role === 'protagonist' ? '主角' : char.role === 'antagonist' ? '反派' : '配角' }}
                    </Badge>
                    <Badge v-if="char.expressions && Object.keys(char.expressions).length > 0" variant="secondary">
                      {{ Object.keys(char.expressions).length }} 表情
                    </Badge>
                  </div>
                </div>
              </div>

              <!-- 表情预览条 -->
              <div v-if="char.expressions && Object.keys(char.expressions).length > 0" class="mt-3 flex space-x-1">
                <div
                  v-for="(imgData, emotion) in char.expressions"
                  :key="emotion"
                  class="w-8 h-8 rounded border overflow-hidden cursor-pointer hover:ring-2 ring-primary transition"
                  :title="emotion"
                  @click.stop="openImagePreview(`data:image/png;base64,${imgData}`, `${char.name} - ${emotion}`)"
                >
                  <img :src="`data:image/png;base64,${imgData}`" class="w-full h-full object-cover" />
                </div>
              </div>

              <div class="mt-4 flex space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  class="flex-1"
                  @click="generateCharacter(char)"
                  :disabled="char.generating"
                >
                  <Loader2 v-if="char.generating" class="w-4 h-4 mr-1 animate-spin" />
                  <Sparkles v-else class="w-4 h-4 mr-1" />
                  {{ char.baseImage ? '重新生成' : '生成立绘' }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  @click="openCharacterEdit(char)"
                >
                  <Pencil class="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <!-- 视频生成面板 -->
        <div v-else-if="activeTab === 'video'" class="space-y-6">
          <!-- 批量操作栏 -->
          <div v-if="scenes.length > 0" class="flex items-center justify-between p-4 bg-accent rounded-lg">
            <div class="flex items-center space-x-4">
              <div class="text-sm">
                <span class="font-medium">{{ scenes.length }}</span> 个场景
                <span class="text-muted-foreground mx-2">·</span>
                <span class="text-green-600">{{ scenes.filter(s => s.frameStatus === 'done').length }}</span> 首尾帧完成
                <span class="text-muted-foreground mx-2">·</span>
                <span class="text-blue-600">{{ scenes.filter(s => s.videoStatus === 'done').length }}</span> 视频完成
              </div>
            </div>
            <div class="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                @click="batchGenerateFrames"
                :disabled="batchFrameStatus.running || batchVideoStatus.running"
              >
                <Loader2 v-if="batchFrameStatus.running" class="w-4 h-4 mr-2 animate-spin" />
                <Image v-else class="w-4 h-4 mr-2" />
                {{ batchFrameStatus.running ? `生成中 (${batchFrameStatus.current}/${batchFrameStatus.total})` : '批量生成首尾帧' }}
              </Button>
              <Button
                variant="outline"
                size="sm"
                @click="batchGenerateVideos"
                :disabled="batchFrameStatus.running || batchVideoStatus.running || scenes.filter(s => s.frameStatus === 'done').length === 0"
              >
                <Loader2 v-if="batchVideoStatus.running" class="w-4 h-4 mr-2 animate-spin" />
                <Video v-else class="w-4 h-4 mr-2" />
                {{ batchVideoStatus.running ? `生成中 (${batchVideoStatus.current}/${batchVideoStatus.total})` : '批量生成视频' }}
              </Button>
            </div>
          </div>

          <div class="grid lg:grid-cols-3 gap-6">
          <!-- 场景列表 -->
          <div class="space-y-4">
            <h3 class="font-semibold">场景队列</h3>
            <div v-if="scenes.length === 0" class="text-center py-8 text-muted-foreground">
              <Video class="w-8 h-8 mx-auto mb-2" />
              <p class="text-sm">请先解析剧本</p>
            </div>
            <div v-else class="space-y-2 max-h-[400px] overflow-y-auto">
              <div
                v-for="(scene, idx) in scenes"
                :key="scene.id"
                class="p-3 border rounded-lg cursor-pointer transition"
                :class="scene.active ? 'border-primary bg-accent' : 'hover:border-primary/50'"
                @click="selectScene(scene)"
              >
                <div class="flex items-center justify-between">
                  <span class="font-medium text-sm">场景 {{ idx + 1 }}</span>
                  <div class="flex items-center space-x-1">
                    <Check v-if="scene.frameStatus === 'done'" class="w-4 h-4 text-green-500" />
                    <Loader2 v-else-if="scene.frameStatus === 'generating'" class="w-4 h-4 animate-spin text-purple-500" />
                    <AlertCircle v-else-if="scene.frameStatus === 'error'" class="w-4 h-4 text-red-500" />
                    <div v-else class="w-4 h-4 rounded-full bg-muted" />
                  </div>
                </div>
                <p class="text-xs text-muted-foreground mt-1 line-clamp-2">{{ scene.title }}</p>
              </div>
            </div>
          </div>

          <!-- 首尾帧预览 -->
          <div class="space-y-4">
            <h3 class="font-semibold">首尾帧预览</h3>
            <div v-if="selectedScene" class="space-y-4">
              <div>
                <div class="text-xs text-muted-foreground mb-2">第一帧</div>
                <div class="aspect-video bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg flex items-center justify-center overflow-hidden">
                  <img
                    v-if="selectedScene.firstFrame"
                    :src="`data:image/png;base64,${selectedScene.firstFrame}`"
                    class="w-full h-full object-cover cursor-pointer hover:opacity-90 transition"
                    @click="openImagePreview(`data:image/png;base64,${selectedScene.firstFrame}`, `${selectedScene.title} - 第一帧`)"
                  />
                  <Image v-else class="w-8 h-8 text-muted-foreground" />
                </div>
              </div>
              <div>
                <div class="text-xs text-muted-foreground mb-2">最后一帧</div>
                <div class="aspect-video bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg flex items-center justify-center overflow-hidden">
                  <img
                    v-if="selectedScene.lastFrame"
                    :src="`data:image/png;base64,${selectedScene.lastFrame}`"
                    class="w-full h-full object-cover cursor-pointer hover:opacity-90 transition"
                    @click="openImagePreview(`data:image/png;base64,${selectedScene.lastFrame}`, `${selectedScene.title} - 最后一帧`)"
                  />
                  <Image v-else class="w-8 h-8 text-muted-foreground" />
                </div>
              </div>
              <Button
                variant="outline"
                class="w-full"
                @click="generateFrames(selectedScene)"
                :disabled="selectedScene.frameStatus === 'generating'"
              >
                <Loader2 v-if="selectedScene.frameStatus === 'generating'" class="w-4 h-4 mr-2 animate-spin" />
                <Sparkles v-else class="w-4 h-4 mr-2" />
                {{ selectedScene.firstFrame ? '重新生成' : '生成首尾帧' }}
              </Button>
            </div>
            <div v-else class="text-center py-8 text-muted-foreground">
              <p class="text-sm">请选择一个场景</p>
            </div>
          </div>

          <!-- 视频预览 -->
          <div class="space-y-4">
            <h3 class="font-semibold">视频预览</h3>
            <div v-if="selectedScene" class="space-y-4">
              <div class="aspect-video bg-gray-900 rounded-lg flex items-center justify-center overflow-hidden">
                <video
                  v-if="selectedScene.videoUrl"
                  :src="selectedScene.videoUrl"
                  controls
                  class="w-full h-full"
                />
                <div v-else class="text-center text-gray-400">
                  <Play class="w-12 h-12 mx-auto mb-2" />
                  <p class="text-sm">等待视频生成</p>
                </div>
              </div>
              <Button
                class="w-full"
                @click="generateVideo(selectedScene)"
                :disabled="selectedScene.videoStatus === 'generating' || selectedScene.frameStatus !== 'done'"
              >
                <Loader2 v-if="selectedScene.videoStatus === 'generating'" class="w-4 h-4 mr-2 animate-spin" />
                <Play v-else class="w-4 h-4 mr-2" />
                {{ selectedScene.videoUrl ? '重新生成视频' : '生成视频' }}
              </Button>
              <p v-if="selectedScene.frameStatus !== 'done'" class="text-xs text-muted-foreground text-center">
                请先生成首尾帧
              </p>
            </div>
          </div>
          </div>
        </div>

        <!-- 音频配置面板 -->
        <div v-else-if="activeTab === 'audio'" class="max-w-2xl mx-auto space-y-6">
          <div class="space-y-4">
            <h3 class="font-semibold">音频设置</h3>
            <div class="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <div class="font-medium">启用配音</div>
                <p class="text-sm text-muted-foreground">为角色对话生成 AI 配音</p>
              </div>
              <Switch v-model:checked="audioConfig.enabled" />
            </div>
            <div class="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <div class="font-medium">背景音乐</div>
                <p class="text-sm text-muted-foreground">自动生成氛围背景音乐</p>
              </div>
              <Switch v-model:checked="audioConfig.bgmEnabled" />
            </div>
          </div>

          <div v-if="audioConfig.enabled && characters.length > 0" class="space-y-4">
            <h3 class="font-semibold">角色配音</h3>
            <div class="space-y-3">
              <div
                v-for="char in characters"
                :key="char.id"
                class="flex items-center justify-between p-4 border rounded-lg"
              >
                <div class="flex items-center space-x-3">
                  <div class="w-10 h-10 bg-gradient-to-br from-purple-100 to-pink-100 rounded-full flex items-center justify-center">
                    <span class="text-sm font-medium">{{ char.name[0] }}</span>
                  </div>
                  <span class="font-medium">{{ char.name }}</span>
                </div>
                <select
                  v-model="audioConfig.voices[char.name]"
                  class="h-9 px-3 rounded-md border border-input bg-background text-sm"
                >
                  <option value="">自动选择</option>
                  <option value="male_1">男声 1</option>
                  <option value="male_2">男声 2</option>
                  <option value="female_1">女声 1</option>
                  <option value="female_2">女声 2</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- 流水线进度条 -->
    <div v-if="pipelineStatus.running || pipelineStatus.progress === 100" class="mt-6">
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium">{{ pipelineStatus.currentStep }}</span>
            <span class="text-sm text-muted-foreground">{{ pipelineStatus.progress }}%</span>
          </div>
          <div class="h-2 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full bg-primary transition-all duration-300"
              :style="{ width: `${pipelineStatus.progress}%` }"
            />
          </div>
          <p v-if="pipelineStatus.error" class="mt-2 text-sm text-destructive">
            {{ pipelineStatus.error }}
          </p>
        </CardContent>
      </Card>
    </div>

    <!-- 场景编辑对话框 -->
    <ScriptSceneEditDialog
      v-model:open="editDialogOpen"
      :scene="editingScene"
      :available-characters="characters.map(c => c.name)"
      @save="handleSceneSave"
    />

    <!-- 角色编辑对话框 -->
    <CharacterEditDialog
      ref="characterEditDialogRef"
      v-model:open="characterEditDialogOpen"
      :character="editingCharacter"
      @save="handleCharacterSave"
      @generate-expression="generateCharacterExpression"
    />

    <!-- 图片预览弹窗 -->
    <ImagePreview
      v-model:open="imagePreviewOpen"
      :src="imagePreviewSrc"
      :alt="imagePreviewAlt"
    />
  </div>
</template>
