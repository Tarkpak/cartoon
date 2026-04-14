<script setup lang="ts">
import { Plus, Trash2 } from 'lucide-vue-next'

interface DialogueItem {
  character: string
  text: string
  emotion?: string
}

interface CharacterItem {
  name: string
  appearance?: string
  emotion?: string
}

// 景别类型
type ShotType = 'extreme_wide' | 'wide' | 'medium_wide' | 'medium' | 'medium_close' | 'close' | 'extreme_close' | 'detail'

// 运镜方式
type CameraMovement = 'static' | 'push' | 'pull' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down' | 'track' | 'dolly' | 'zoom_in' | 'zoom_out' | 'crane' | 'handheld' | 'arc'

// 转场效果
type TransitionType = 'cut' | 'fade' | 'dissolve' | 'wipe' | 'slide' | 'zoom' | 'blur' | 'flash' | 'none'

interface SceneEditData {
  id: string
  title: string
  description: string
  narration?: string
  characters: CharacterItem[]
  dialogues: DialogueItem[]
  duration: number
  setting?: { location: string, timeOfDay: string }
  // 镜头语言
  shotType?: ShotType
  cameraMovement?: CameraMovement
  cameraNote?: string
  // 转场
  transitionIn?: TransitionType
  transitionOut?: TransitionType
  transitionDuration?: number
}

const props = defineProps<{
  open: boolean
  scene: SceneEditData | null
  availableCharacters?: string[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'save': [scene: SceneEditData]
}>()

// 本地编辑状态
const editForm = ref<SceneEditData>({
  id: '',
  title: '',
  description: '',
  narration: '',
  characters: [],
  dialogues: [],
  duration: 8,
  shotType: 'medium',
  cameraMovement: 'static',
  cameraNote: '',
  transitionIn: 'cut',
  transitionOut: 'cut',
  transitionDuration: 0.5
})

// 监听 scene 变化，初始化表单
watch(() => props.scene, (newScene) => {
  if (newScene) {
    editForm.value = {
      id: newScene.id,
      title: newScene.title,
      description: newScene.description,
      narration: newScene.narration || '',
      characters: [...newScene.characters],
      dialogues: newScene.dialogues.map(d => ({ ...d })),
      duration: newScene.duration,
      setting: newScene.setting ? { ...newScene.setting } : undefined,
      shotType: newScene.shotType || 'medium',
      cameraMovement: newScene.cameraMovement || 'static',
      cameraNote: newScene.cameraNote || '',
      transitionIn: newScene.transitionIn || 'cut',
      transitionOut: newScene.transitionOut || 'cut',
      transitionDuration: newScene.transitionDuration || 0.5
    }
  }
}, { immediate: true })

// 情绪选项
const emotionOptions = [
  { value: '', label: '默认' },
  { value: 'happy', label: '开心' },
  { value: 'sad', label: '悲伤' },
  { value: 'angry', label: '愤怒' },
  { value: 'surprised', label: '惊讶' },
  { value: 'confused', label: '困惑' },
  { value: 'scared', label: '害怕' },
  { value: 'calm', label: '平静' }
]

// 时间选项
const timeOfDayOptions = [
  { value: 'morning', label: '清晨' },
  { value: 'day', label: '白天' },
  { value: 'afternoon', label: '下午' },
  { value: 'evening', label: '傍晚' },
  { value: 'night', label: '夜晚' }
]

// 景别选项
const shotTypeOptions = [
  { value: 'extreme_wide', label: '大远景', desc: '展示宏大场景' },
  { value: 'wide', label: '全景', desc: '展示完整环境' },
  { value: 'medium_wide', label: '中全景', desc: '人物全身+环境' },
  { value: 'medium', label: '中景', desc: '人物膝盖以上' },
  { value: 'medium_close', label: '中近景', desc: '人物胸部以上' },
  { value: 'close', label: '近景', desc: '人物肩部以上' },
  { value: 'extreme_close', label: '特写', desc: '面部或局部' },
  { value: 'detail', label: '细节特写', desc: '物品或细节' }
]

// 运镜选项
const cameraMovementOptions = [
  { value: 'static', label: '定镜', desc: '固定机位' },
  { value: 'push', label: '推镜头', desc: '向前推进' },
  { value: 'pull', label: '拉镜头', desc: '向后拉远' },
  { value: 'pan_left', label: '左摇', desc: '水平左移' },
  { value: 'pan_right', label: '右摇', desc: '水平右移' },
  { value: 'tilt_up', label: '上摇', desc: '垂直上移' },
  { value: 'tilt_down', label: '下摇', desc: '垂直下移' },
  { value: 'track', label: '跟镜头', desc: '跟随主体' },
  { value: 'dolly', label: '移镜头', desc: '平行移动' },
  { value: 'zoom_in', label: '变焦推进', desc: '镜头拉近' },
  { value: 'zoom_out', label: '变焦拉远', desc: '镜头拉远' },
  { value: 'crane', label: '升降镜头', desc: '垂直升降' },
  { value: 'handheld', label: '手持晃动', desc: '真实感' },
  { value: 'arc', label: '环绕镜头', desc: '绕主体旋转' }
]

// 转场选项
const transitionOptions = [
  { value: 'cut', label: '硬切', desc: '直接切换' },
  { value: 'fade', label: '淡入淡出', desc: '渐变黑场' },
  { value: 'dissolve', label: '叠化', desc: '画面融合' },
  { value: 'wipe', label: '划变', desc: '擦除切换' },
  { value: 'slide', label: '滑动', desc: '滑入滑出' },
  { value: 'zoom', label: '缩放', desc: '放大缩小' },
  { value: 'blur', label: '模糊', desc: '虚焦过渡' },
  { value: 'flash', label: '闪白', desc: '白场过渡' },
  { value: 'none', label: '无', desc: '不使用转场' }
]

// 添加对话
function addDialogue() {
  editForm.value.dialogues.push({
    character: editForm.value.characters[0]?.name || '',
    text: '',
    emotion: ''
  })
}

// 删除对话
function removeDialogue(index: number) {
  editForm.value.dialogues.splice(index, 1)
}

// 保存
function handleSave() {
  emit('save', { ...editForm.value })
  emit('update:open', false)
}

// 取消
function handleCancel() {
  emit('update:open', false)
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
    <DialogContent class="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>编辑场景</DialogTitle>
        <DialogDescription>
          修改场景的标题、描述和对话内容
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-6 py-4">
        <!-- 场景标题 -->
        <div class="space-y-2">
          <label class="text-sm font-medium">场景标题</label>
          <Input
            v-model="editForm.title"
            placeholder="输入场景标题"
          />
        </div>

        <!-- 场景描述 -->
        <div class="space-y-2">
          <label class="text-sm font-medium">场景描述</label>
          <Textarea
            v-model="editForm.description"
            placeholder="描述场景的画面内容..."
            class="min-h-[100px]"
          />
        </div>

        <!-- 旁白 -->
        <div class="space-y-2">
          <label class="text-sm font-medium">旁白（可选）</label>
          <Textarea
            v-model="editForm.narration"
            placeholder="输入画外音/旁白内容..."
            class="min-h-[80px]"
          />
        </div>

        <!-- 场景设定 -->
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">地点</label>
            <Input
              v-model="editForm.setting!.location"
              placeholder="场景地点"
            />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">时间</label>
            <Select v-model="editForm.setting!.timeOfDay">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="选择时间" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in timeOfDayOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <!-- 时长 -->
        <div class="space-y-2">
          <label class="text-sm font-medium">预计时长 (秒)</label>
          <div class="flex items-center space-x-4">
            <Slider
              :model-value="[editForm.duration]"
              :min="2"
              :max="15"
              :step="0.5"
              class="flex-1"
              @update:model-value="editForm.duration = Number($event?.[0] ?? editForm.duration)"
            />
            <span class="w-16 text-center font-medium">{{ editForm.duration }}秒</span>
          </div>
          <p class="text-xs text-muted-foreground">支持 2-15 秒灵活时长</p>
        </div>

        <!-- 镜头语言设置 -->
        <div class="space-y-4 border-t pt-4">
          <h4 class="text-sm font-medium flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-blue-500" />
            镜头语言
          </h4>

          <div class="grid grid-cols-2 gap-4">
            <!-- 景别 -->
            <div class="space-y-2">
              <label class="text-sm font-medium">景别</label>
              <Select v-model="editForm.shotType">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="选择景别" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="opt in shotTypeOptions"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }} - {{ opt.desc }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <!-- 运镜 -->
            <div class="space-y-2">
              <label class="text-sm font-medium">运镜方式</label>
              <Select v-model="editForm.cameraMovement">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="选择运镜方式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="opt in cameraMovementOptions"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }} - {{ opt.desc }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <!-- 镜头备注 -->
          <div class="space-y-2">
            <label class="text-sm font-medium">镜头备注</label>
            <Input
              v-model="editForm.cameraNote"
              placeholder="可选：补充镜头运动细节，如 缓慢推进至角色面部"
            />
          </div>
        </div>

        <!-- 转场设置 -->
        <div class="space-y-4 border-t pt-4">
          <h4 class="text-sm font-medium flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-purple-500" />
            转场效果
          </h4>

          <div class="grid grid-cols-3 gap-4">
            <!-- 入场转场 -->
            <div class="space-y-2">
              <label class="text-sm font-medium">入场转场</label>
              <Select v-model="editForm.transitionIn">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="选择入场转场" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="opt in transitionOptions"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <!-- 出场转场 -->
            <div class="space-y-2">
              <label class="text-sm font-medium">出场转场</label>
              <Select v-model="editForm.transitionOut">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="选择出场转场" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="opt in transitionOptions"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <!-- 转场时长 -->
            <div class="space-y-2">
              <label class="text-sm font-medium">转场时长</label>
              <div class="flex items-center space-x-2">
                <Slider
                  :model-value="[editForm.transitionDuration || 0.5]"
                  :min="0.2"
                  :max="2"
                  :step="0.1"
                  class="flex-1"
                  @update:model-value="editForm.transitionDuration = Number($event?.[0] ?? editForm.transitionDuration)"
                />
                <span class="w-12 text-center text-sm">{{ editForm.transitionDuration }}s</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 对话列表 -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium">对话内容</label>
            <Button
              variant="ghost"
              size="sm"
              @click="addDialogue"
            >
              <Plus class="w-4 h-4 mr-1" />
              添加对话
            </Button>
          </div>

          <div
            v-if="editForm.dialogues.length === 0"
            class="text-center py-6 text-muted-foreground border-2 border-dashed rounded-lg"
          >
            <p class="text-sm">
              暂无对话，点击上方按钮添加
            </p>
          </div>

          <div
            v-for="(dialogue, index) in editForm.dialogues"
            :key="index"
            class="border rounded-lg p-4 space-y-3"
          >
            <div class="flex items-start justify-between">
              <span class="text-xs text-muted-foreground">对话 {{ index + 1 }}</span>
              <Button
                variant="ghost"
                size="sm"
                class="h-6 w-6 p-0 text-destructive hover:text-destructive"
                @click="removeDialogue(index)"
              >
                <Trash2 class="w-3 h-3" />
              </Button>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <!-- 角色选择 -->
              <div class="space-y-1">
                <label class="text-xs text-muted-foreground">角色</label>
                <Select v-model="dialogue.character">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="选择角色" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="char in editForm.characters"
                      :key="char.name"
                      :value="char.name"
                    >
                      {{ char.name }}
                    </SelectItem>
                    <SelectItem
                      v-for="char in (availableCharacters || []).filter(c => !editForm.characters.find(ec => ec.name === c))"
                      :key="char"
                      :value="char"
                    >
                      {{ char }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <!-- 情绪选择 -->
              <div class="space-y-1">
                <label class="text-xs text-muted-foreground">情绪</label>
                <Select
                  :model-value="dialogue.emotion || '__default__'"
                  @update:model-value="dialogue.emotion = String($event) === '__default__' ? '' : String($event)"
                >
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="选择情绪" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="opt in emotionOptions"
                      :key="opt.value || '__default__'"
                      :value="opt.value || '__default__'"
                    >
                      {{ opt.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <!-- 对话内容 -->
            <div class="space-y-1">
              <label class="text-xs text-muted-foreground">台词</label>
              <Textarea
                v-model="dialogue.text"
                placeholder="输入角色台词..."
                class="min-h-[60px]"
              />
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          @click="handleCancel"
        >
          取消
        </Button>
        <Button @click="handleSave">
          保存修改
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
