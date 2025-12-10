<script setup lang="ts">
import { FileText, Users, Video, Music, Sparkles, Plus, Pencil, Trash2, Loader2, Play, Image, Check, AlertCircle } from 'lucide-vue-next'

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
      // 自动保存
      await saveProject()
    }
  } catch (e) {
    console.error('角色生成失败:', e)
  } finally {
    char.generating = false
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

// ========== 项目持久化 ==========
const projectName = ref('新项目')
const saving = ref(false)
const loading = ref(false)

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
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-2xl font-bold">
          生成工作台
        </h1>
        <p class="text-muted-foreground">
          {{ projectId ? `项目 ${projectId}` : '新项目' }}
        </p>
      </div>
      <div class="flex items-center space-x-3">
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
              >
                <Plus class="w-4 h-4" />
              </Button>
            </div>
            <div class="space-y-4 max-h-[400px] overflow-y-auto">
              <div
                v-for="scene in scenes"
                :key="scene.id"
                class="border rounded-xl p-4 cursor-pointer transition"
                :class="scene.active
                  ? 'border-primary bg-accent'
                  : 'hover:border-primary/50'"
              >
                <div class="flex items-start justify-between mb-2">
                  <Badge :variant="scene.active ? 'default' : 'secondary'">
                    场景 {{ scenes.indexOf(scene) + 1 }}
                  </Badge>
                  <div class="flex space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8 w-8 p-0"
                    >
                      <Pencil class="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8 w-8 p-0 text-destructive"
                    >
                      <Trash2 class="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <h4 class="font-medium mb-1">
                  {{ scene.title }}
                </h4>
                <p class="text-sm text-muted-foreground mb-2">
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
              class="border rounded-xl p-4"
            >
              <div class="flex items-start space-x-4">
                <div class="w-20 h-20 bg-gradient-to-br from-purple-100 to-pink-100 rounded-lg flex items-center justify-center overflow-hidden">
                  <img
                    v-if="char.baseImage"
                    :src="`data:image/png;base64,${char.baseImage}`"
                    class="w-full h-full object-cover"
                  />
                  <Users v-else class="w-8 h-8 text-muted-foreground" />
                </div>
                <div class="flex-1">
                  <h4 class="font-semibold">{{ char.name }}</h4>
                  <p class="text-sm text-muted-foreground line-clamp-2">
                    {{ char.appearance || '暂无外貌描述' }}
                  </p>
                  <Badge variant="outline" class="mt-2">
                    {{ char.role === 'protagonist' ? '主角' : char.role === 'antagonist' ? '反派' : '配角' }}
                  </Badge>
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
              </div>
            </div>
          </div>
        </div>

        <!-- 视频生成面板 -->
        <div v-else-if="activeTab === 'video'" class="grid lg:grid-cols-3 gap-6">
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
                    class="w-full h-full object-cover"
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
                    class="w-full h-full object-cover"
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
  </div>
</template>
