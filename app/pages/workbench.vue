<script setup lang="ts">
import { FileText, Users, Video, BookOpen } from 'lucide-vue-next'
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
  scriptText,
  saving,
  // 工作流步骤
  currentStep,
  setCurrentStep,
  proceedToNextStep,
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
  generateCharacterExpression,
  updateCharacter,
  extractCharactersFromScript,
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

// 工作流步骤定义
const workflowSteps = computed(() => [
  {
    key: 'outline',
    label: '故事大纲',
    icon: BookOpen,
    description: '构建故事结构',
    completed: !!outline.value,
    active: currentStep.value === 'outline'
  },
  {
    key: 'characters',
    label: '角色设定',
    icon: Users,
    description: '创建角色形象',
    completed: characters.value.length > 0 && characters.value.some(c => c.baseImage),
    active: currentStep.value === 'characters'
  },
  {
    key: 'script',
    label: '剧本编辑',
    icon: FileText,
    description: '编写场景对话',
    completed: scenes.value.length > 0,
    active: currentStep.value === 'script'
  },
  {
    key: 'video',
    label: '视频生成',
    icon: Video,
    description: '生成动画视频',
    completed: scenes.value.some(s => s.videoStatus === 'done'),
    active: currentStep.value === 'video'
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
  const imageData = await generateCharacterExpression(characterId, emotion)
  if (imageData && characterEditDialogRef.value) {
    characterEditDialogRef.value.updateExpression(emotion, imageData)
  }
}

// 角色提取
async function handleExtractCharacters() {
  if (!scriptText.value.trim()) {
    alert('请先输入剧本内容')
    return
  }
  extractingCharacters.value = true
  try {
    await extractCharactersFromScript()
  } finally {
    extractingCharacters.value = false
  }
}

// 从大纲提取角色
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
function handleOutlineUpdate(newOutline: StoryOutline) {
  outline.value = newOutline
  saveProject()
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

// 页面加载时加载项目
onMounted(() => {
  if (projectId.value) {
    loadProject(projectId.value)
  }
})
</script>

<template>
  <div class="p-8">
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
      :can-start="scenes.length > 0"
      @update:project-name="projectName = $event"
      @update:project-description="projectDescription = $event"
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
        <!-- 故事大纲面板 -->
        <WorkbenchOutlinePanel
          v-if="currentStep === 'outline'"
          :outline="outline"
          :raw-text="scriptText"
          :generating="generatingOutline"
          @update:raw-text="scriptText = $event"
          @update:outline="handleOutlineUpdate"
          @generate-outline="generateOutline"
          @proceed-to-characters="setCurrentStep('characters')"
        />

        <!-- 角色管理面板 (增强版) -->
        <WorkbenchCharacterPanelEnhanced
          v-else-if="currentStep === 'characters'"
          :characters="characters"
          :relationships="relationships"
          :extracting="extractingCharacters"
          :has-outline="!!outline"
          @generate-character="generateCharacter"
          @edit-character="openCharacterEdit"
          @preview-image="openImagePreview"
          @extract-characters="handleExtractCharacters"
          @extract-from-outline="handleExtractFromOutline"
          @generate-views="generateCharacterViews"
          @update-relationship="updateRelationship"
          @add-relationship="addRelationship"
          @remove-relationship="removeRelationship"
          @proceed-to-script="setCurrentStep('script')"
        />

        <!-- 剧本编辑面板 -->
        <WorkbenchScriptPanel
          v-else-if="currentStep === 'script'"
          :script-text="scriptText"
          :scenes="scenes"
          :parsing="parsing"
          :has-outline="!!outline"
          :has-characters="characters.length > 0"
          @update:script-text="scriptText = $event"
          @parse-script="parseScript"
          @generate-from-outline="generateScenesFromOutline"
          @select-scene="selectScene"
          @add-scene="handleSceneAdd"
          @edit-scene="openSceneEdit"
          @delete-scene="deleteScene"
          @split-scene="splitScene"
          @merge-scene="mergeWithNextScene"
          @reorder-scenes="handleReorderScenes"
          @generate-storyboard="handleGenerateStoryboard"
          @extract-scene-visual="handleExtractSceneVisual"
          @view-storyboard="handleViewStoryboard"
          @view-scene-visual="handleViewSceneVisual"
        />

        <!-- 视频生成面板 -->
        <WorkbenchVideoPanel
          v-else-if="currentStep === 'video'"
          :scenes="scenes"
          :selected-scene="selectedScene"
          :batch-frame-status="batchFrameStatus"
          :batch-video-status="batchVideoStatus"
          @select-scene="selectScene"
          @generate-frames="generateFrames"
          @generate-video="generateVideo"
          @batch-generate-frames="batchGenerateFrames"
          @batch-generate-videos="batchGenerateVideos"
          @preview-image="openImagePreview"
        />
      </CardContent>
    </Card>

    <!-- 流水线进度条 -->
    <WorkbenchPipelineProgress :status="pipelineStatus" />

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
          <DialogTitle>分镜脚本 - {{ viewingStoryboardScene?.title }}</DialogTitle>
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
          <DialogTitle>场景视觉 - {{ viewingSceneVisualScene?.title }}</DialogTitle>
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
