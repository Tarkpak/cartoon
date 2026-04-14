<script setup lang="ts">
import { Users, Video, BookOpen, RefreshCw, Loader2 } from 'lucide-vue-next'
import { useDebounceFn } from '@vueuse/core'
import type { SceneData, CharacterData } from '~/composables/useWorkbench'
import type { StoryOutline } from '#shared/types/outline'

// 生成工作台页面
definePageMeta({
  layout: 'default'
})

const route = useRoute()
const router = useRouter()

// 使用 workbench composable
const {
  projectId,
  projectName,
  projectDescription,
  storyIdea,
  novelText,
  saving,
  saveError,
  // 工作流步骤
  currentStep,
  setCurrentStep,
  // 输入模式
  inputMode,
  // 风格选择
  selectedStyleId,
  projectStyleId,
  // 故事大纲
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
  // 角色
  characters,
  generateCharacter,
  batchGenerateCharacters,
  generateCharacterExpression,
  updateCharacter,
  extractCharactersFromOutline,
  generateCharacterViews,
  // 角色关系
  relationships,
  addRelationship,
  updateRelationship,
  removeRelationship,
  // 分镜
  generateStoryboard,
  extractSceneVisual,
  // 视频
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
  // 成本
  costEstimate,
  // 项目
  loadProject,
  saveProject
} = useWorkbench()

// 角色提取状态
const extractingCharacters = ref(false)

// 错误提示状态
const errorMessage = ref<string | null>(null)
const errorTimeout = ref<ReturnType<typeof setTimeout> | null>(null)

// 显示错误提示
function showError(message: string, duration = 5000) {
  errorMessage.value = message
  if (errorTimeout.value) {
    clearTimeout(errorTimeout.value)
  }
  errorTimeout.value = setTimeout(() => {
    errorMessage.value = null
  }, duration)
}

// 关闭错误提示
function closeError() {
  errorMessage.value = null
  if (errorTimeout.value) {
    clearTimeout(errorTimeout.value)
  }
}

// 包装 generateCharacter，添加错误处理
async function handleGenerateCharacter(char: CharacterData) {
  try {
    await generateCharacter(char)
  } catch (e: unknown) {
    const error = e as { data?: { message?: string }, message?: string }
    const message = error.data?.message || error.message || '角色生成失败，请重试'
    showError(message)
  }
}

// 批量生成角色立绘状态
const batchGeneratingCharacters = ref(false)
const batchCharacterProgress = ref<{ current: number, total: number, name: string } | undefined>(undefined)

// 批量生成角色立绘
async function handleBatchGenerateCharacters() {
  batchGeneratingCharacters.value = true
  batchCharacterProgress.value = { current: 0, total: 0, name: '' }

  try {
    await batchGenerateCharacters((current, total, name) => {
      batchCharacterProgress.value = { current, total, name }
    })
  } finally {
    batchGeneratingCharacters.value = false
    batchCharacterProgress.value = undefined
  }
}

// 工作流步骤定义 - 场景编辑与视频生成合并
const workflowSteps = computed(() => [
  {
    key: 'outline',
    label: '故事/剧本',
    icon: BookOpen,
    description: '创意生成或文本输入',
    completed: !!outline.value || scenes.value.length > 0,
    active: currentStep.value === 'outline'
  },
  {
    key: 'characters',
    label: '角色设定',
    icon: Users,
    description: '提取角色生成立绘',
    completed: characters.value.length > 0 && characters.value.some(c => c.baseImage),
    active: currentStep.value === 'characters'
  },
  {
    key: 'script',
    icon: Video,
    label: '场景与视频',
    description: '编辑场景并生成视频',
    completed: scenes.value.length > 0 && scenes.value.some(s => s.firstFrame || s.videoStatus === 'done'),
    active: currentStep.value === 'script'
  }
])

// 图片预览状态
const imagePreviewOpen = ref(false)
const imagePreviewSrc = ref('')
const imagePreviewAlt = ref('')

function openImagePreview(src: string, alt = '图片预览') {
  imagePreviewSrc.value = src
  imagePreviewAlt.value = alt
  imagePreviewOpen.value = true
}

// 场景编辑对话框
const editDialogOpen = ref(false)
const editingScene = ref<SceneData | null>(null)

function openSceneEdit(scene: SceneData) {
  editingScene.value = scene
  editDialogOpen.value = true
}

function handleSceneAdd() {
  const newScene = addNewScene()
  openSceneEdit(newScene)
}

function handleSceneSave(updatedScene: {
  id: string
  title: string
  description: string
  narration?: string
  characters: Array<{ name: string, appearance?: string, emotion?: string }>
  dialogues: Array<{ character: string, text: string, emotion?: string }>
  duration: number
  setting?: { location: string, timeOfDay: string }
}) {
  updateScene(updatedScene)
  editDialogOpen.value = false
  editingScene.value = null
}

// 场景拖拽重排序
function handleReorderScenes(fromIndex: number, toIndex: number) {
  const [movedScene] = scenes.value.splice(fromIndex, 1)
  if (movedScene) {
    scenes.value.splice(toIndex, 0, movedScene)
    saveProject()
  }
}

// 角色编辑对话框
const characterEditDialogOpen = ref(false)
const editingCharacter = ref<CharacterData | null>(null)
const characterEditDialogRef = ref<{
  updateExpression: (emotion: string, imageData: string) => void
  clearGeneratingEmotion: (emotion: string) => void
} | null>(null)

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
  personality?: string
  traits?: string[]
  background?: string
  motivation?: string
  speakingStyle?: string
  catchphrase?: string
  voiceTone?: string
  age?: number
  gender?: string
}) {
  updateCharacter(updatedChar)
  characterEditDialogOpen.value = false
  editingCharacter.value = null
}

async function handleGenerateExpression(characterId: string, emotion: string) {
  try {
    const imageData = await generateCharacterExpression(characterId, emotion)
    if (imageData && characterEditDialogRef.value) {
      characterEditDialogRef.value.updateExpression(emotion, imageData)
      return
    }
    showError('表情生成失败，请重试')
  } finally {
    characterEditDialogRef.value?.clearGeneratingEmotion(emotion)
  }
}

// 角色提取 - 从大纲中提取
async function handleExtractFromOutline() {
  if (!outline.value) {
    alert('请先生成故事大纲')
    return
  }
  extractingCharacters.value = true
  try {
    await extractCharactersFromOutline()
  } finally {
    extractingCharacters.value = false
  }
}

// 大纲更新
const debouncedSaveOutline = useDebounceFn(() => {
  saveProject()
}, 800)

function handleOutlineUpdate(newOutline: StoryOutline) {
  outline.value = newOutline
  debouncedSaveOutline()
}

// 分镜和场景视觉对话框
const storyboardDialogOpen = ref(false)
const viewingStoryboardScene = ref<SceneData | null>(null)

const sceneVisualDialogOpen = ref(false)
const viewingSceneVisualScene = ref<SceneData | null>(null)

function handleGenerateStoryboard(scene: SceneData) {
  generateStoryboard(scene)
}

function handleViewStoryboard(scene: SceneData) {
  viewingStoryboardScene.value = scene
  storyboardDialogOpen.value = true
}

function handleExtractSceneVisual(scene: SceneData) {
  extractSceneVisual(scene)
}

function handleViewSceneVisual(scene: SceneData) {
  viewingSceneVisualScene.value = scene
  sceneVisualDialogOpen.value = true
}

// 步骤导航
function handleStepChange(step: string) {
  setCurrentStep(step as 'outline' | 'characters' | 'script' | 'video')
}

function applyStepFromRoute(step: unknown) {
  if (step === 'video') {
    // 兼容旧链接: /workbench?step=video
    setCurrentStep('script')
    return
  }

  const validSteps = new Set(['outline', 'characters', 'script'])
  if (typeof step === 'string' && validSteps.has(step)) {
    setCurrentStep(step as 'outline' | 'characters' | 'script')
  }
}

// 页面加载时加载项目
onMounted(async () => {
  if (projectId.value) {
    await loadProject(projectId.value)
  }
  applyStepFromRoute(route.query.step)
})

watch(() => route.query.step, (newStep) => {
  applyStepFromRoute(newStep)
})

watch(saveError, (message) => {
  if (message) {
    showError(`保存失败：${message}`)
  }
})
</script>

<template>
  <div class="p-8">
    <!-- 全局错误提示 -->
    <Transition name="slide-down">
      <div
        v-if="errorMessage"
        class="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-lg w-full px-4"
      >
        <div class="bg-destructive text-destructive-foreground px-4 py-3 rounded-lg shadow-lg flex items-start justify-between">
          <div class="flex-1 pr-4">
            <p class="font-medium">生成失败</p>
            <p class="text-sm opacity-90 mt-1">{{ errorMessage }}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="h-7 w-7 text-destructive-foreground/80 hover:text-destructive-foreground"
            @click="closeError"
          >
            ✕
          </Button>
        </div>
      </div>
    </Transition>

    <!-- 头部 -->
    <WorkbenchHeader
      :project-id="projectId"
      :project-name="projectName"
      :project-description="projectDescription"
      :scene-count="costEstimate.sceneCount"
      :char-count="costEstimate.charCount"
      :total-cost="costEstimate.totalCost"
      :total-time="costEstimate.totalTime"
      :pipeline-status="pipelineStatus"
      :saving="saving"
      :can-start="scenes.length > 0 && !!(projectStyleId || selectedStyleId)"
      :selected-style-id="selectedStyleId"
      @update:project-name="projectName = $event"
      @update:project-description="projectDescription = $event"
      @update:selected-style-id="selectedStyleId = $event; projectStyleId = $event"
      @save="saveProject"
      @start-pipeline="startPipeline"
    />

    <!-- 步骤导航 -->
    <WorkbenchStepNav
      :steps="workflowSteps"
      :current-step="currentStep"
      @update:current-step="handleStepChange"
    />

    <Card>
      <CardContent class="pt-6">
        <!-- 故事大纲面板 (支持两种输入模式) -->
        <WorkbenchOutlinePanel
          v-if="currentStep === 'outline'"
          :outline="outline"
          :raw-text="storyIdea"
          :script-text="novelText"
          :generating="generatingOutline"
          :parsing="parsing"
          :has-scenes="scenes.length > 0"
          :input-mode="inputMode"
          @update:raw-text="storyIdea = $event"
          @update:script-text="novelText = $event"
          @update:outline="handleOutlineUpdate"
          @update:input-mode="inputMode = $event"
          @generate-outline="generateOutline"
          @parse-script="parseScript"
          @proceed-to-characters="setCurrentStep('characters')"
        />

        <!-- 角色管理面板 (从场景提取角色) -->
        <WorkbenchCharacterPanelEnhanced
          v-else-if="currentStep === 'characters'"
          :characters="characters"
          :relationships="relationships"
          :extracting="extractingCharacters"
          :batch-generating="batchGeneratingCharacters"
          :batch-progress="batchCharacterProgress"
          :has-outline="!!outline"
          :has-scenes="scenes.length > 0"
          @generate-character="handleGenerateCharacter"
          @edit-character="openCharacterEdit"
          @preview-image="openImagePreview"
          @extract-from-outline="handleExtractFromOutline"
          @batch-generate-characters="handleBatchGenerateCharacters"
          @generate-views="generateCharacterViews"
          @update-relationship="updateRelationship"
          @add-relationship="addRelationship"
          @remove-relationship="removeRelationship"
          @proceed-to-script="setCurrentStep('script')"
        />

        <!-- 场景编辑 + 视频生成（合并工作区） -->
        <template v-else-if="currentStep === 'script'">
          <WorkbenchVideoPanel
            :scenes="scenes"
            :selected-scene="selectedScene"
            :batch-frame-status="batchFrameStatus"
            :batch-video-status="batchVideoStatus"
            :merge-status="mergeStatus"
            :final-video="finalVideo"
            @select-scene="selectScene"
            @add-scene="handleSceneAdd"
            @edit-scene="openSceneEdit"
            @delete-scene="deleteScene"
            @split-scene="splitScene"
            @merge-scene="mergeWithNextScene"
            @generate-storyboard="handleGenerateStoryboard"
            @extract-scene-visual="handleExtractSceneVisual"
            @view-storyboard="handleViewStoryboard"
            @view-scene-visual="handleViewSceneVisual"
            @generate-frames="generateFrames"
            @generate-video="generateVideo"
            @batch-generate-frames="batchGenerateFrames"
            @batch-generate-videos="batchGenerateVideos"
            @merge-all-videos="mergeAllVideos"
            @preview-image="openImagePreview"
          />
        </template>
      </CardContent>
    </Card>

    <!-- 流水线进度条 -->
    <WorkbenchPipelineProgress :status="pipelineStatus" />

    <!-- 时间线视图 -->
    <div
      v-if="scenes.length > 0"
      class="mt-6"
    >
      <WorkbenchTimelineView
        :scenes="scenes"
        :selected-scene-id="selectedScene?.id"
        @select-scene="selectScene"
        @edit-scene="openSceneEdit"
      />
    </div>

    <!-- 场景编辑对话框 -->
    <ScriptSceneEditDialog
      v-model:open="editDialogOpen"
      :scene="editingScene"
      :available-characters="characters.map(c => c.name)"
      @save="handleSceneSave"
    />

    <!-- 角色编辑对话框 (增强版) -->
    <CharacterEditDialogEnhanced
      ref="characterEditDialogRef"
      v-model:open="characterEditDialogOpen"
      :character="editingCharacter"
      @save="handleCharacterSave"
      @generate-expression="handleGenerateExpression"
    />

    <!-- 图片预览弹窗 -->
    <ImagePreview
      v-model:open="imagePreviewOpen"
      :src="imagePreviewSrc"
      :alt="imagePreviewAlt"
    />

    <!-- 分镜查看对话框 -->
    <Dialog v-model:open="storyboardDialogOpen">
      <DialogContent class="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div class="flex items-center justify-between pr-8">
            <DialogTitle>分镜脚本 - {{ viewingStoryboardScene?.title }}</DialogTitle>
            <Button
              v-if="viewingStoryboardScene"
              variant="outline"
              size="sm"
              :disabled="viewingStoryboardScene?.storyboardStatus === 'generating'"
              @click="handleGenerateStoryboard(viewingStoryboardScene)"
            >
              <Loader2
                v-if="viewingStoryboardScene?.storyboardStatus === 'generating'"
                class="w-4 h-4 mr-2 animate-spin"
              />
              <RefreshCw
                v-else
                class="w-4 h-4 mr-2"
              />
              重新生成
            </Button>
          </div>
        </DialogHeader>
        <div
          v-if="viewingStoryboardScene?.storyboard"
          class="space-y-4"
        >
          <div class="text-sm text-muted-foreground">
            总时长: {{ viewingStoryboardScene.storyboard.totalDuration }}秒
          </div>
          <div
            v-for="shot in viewingStoryboardScene.storyboard.shots"
            :key="shot.shotNumber"
            class="border rounded-lg p-4 space-y-2"
          >
            <div class="flex items-center justify-between">
              <Badge>镜头 {{ shot.shotNumber }}</Badge>
              <div class="flex space-x-2">
                <Badge variant="outline">
                  {{ shot.shotType }}
                </Badge>
                <Badge variant="outline">
                  {{ shot.cameraMovement }}
                </Badge>
                <Badge variant="secondary">
                  {{ shot.duration }}秒
                </Badge>
              </div>
            </div>
            <p class="text-sm">
              {{ shot.visualContent }}
            </p>
            <div
              v-if="shot.dialogue"
              class="text-sm text-muted-foreground italic"
            >
              {{ shot.character }}: "{{ shot.dialogue }}"
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <!-- 场景视觉查看对话框 -->
    <Dialog v-model:open="sceneVisualDialogOpen">
      <DialogContent class="max-w-2xl">
        <DialogHeader>
          <div class="flex items-center justify-between pr-8">
            <DialogTitle>场景视觉 - {{ viewingSceneVisualScene?.title }}</DialogTitle>
            <Button
              v-if="viewingSceneVisualScene"
              variant="outline"
              size="sm"
              :disabled="viewingSceneVisualScene?.sceneVisualStatus === 'generating'"
              @click="handleExtractSceneVisual(viewingSceneVisualScene)"
            >
              <Loader2
                v-if="viewingSceneVisualScene?.sceneVisualStatus === 'generating'"
                class="w-4 h-4 mr-2 animate-spin"
              />
              <RefreshCw
                v-else
                class="w-4 h-4 mr-2"
              />
              重新生成
            </Button>
          </div>
        </DialogHeader>
        <div
          v-if="viewingSceneVisualScene?.sceneVisual"
          class="space-y-4"
        >
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span class="text-muted-foreground">时间:</span>
              {{ viewingSceneVisualScene.sceneVisual.time }}
            </div>
            <div>
              <span class="text-muted-foreground">地点:</span>
              {{ viewingSceneVisualScene.sceneVisual.location }}
            </div>
          </div>
          <div>
            <h4 class="font-medium mb-2">
              视觉元素
            </h4>
            <div class="flex flex-wrap gap-2">
              <Badge
                v-for="(element, idx) in viewingSceneVisualScene.sceneVisual.visualElements"
                :key="idx"
                variant="outline"
              >
                {{ element }}
              </Badge>
            </div>
          </div>
          <div>
            <h4 class="font-medium mb-2">
              氛围
            </h4>
            <p class="text-sm text-muted-foreground">
              {{ viewingSceneVisualScene.sceneVisual.atmosphere }}
            </p>
          </div>
          <div>
            <h4 class="font-medium mb-2">
              感官细节
            </h4>
            <p class="text-sm text-muted-foreground">
              {{ viewingSceneVisualScene.sceneVisual.sensoryDetails }}
            </p>
          </div>
          <div>
            <h4 class="font-medium mb-2">
              文生图提示词
            </h4>
            <div class="bg-muted p-3 rounded-lg text-sm">
              {{ viewingSceneVisualScene.sceneVisual.imagePrompt }}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>


<style scoped>
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translate(-50%, -20px);
}
</style>
