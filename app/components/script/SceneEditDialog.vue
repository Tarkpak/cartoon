<script setup lang="ts">
import { X, Plus, Trash2 } from 'lucide-vue-next'

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

interface SceneEditData {
  id: string
  title: string
  description: string
  characters: CharacterItem[]
  dialogues: DialogueItem[]
  duration: number
  setting?: { location: string; timeOfDay: string }
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
  characters: [],
  dialogues: [],
  duration: 8
})

// 监听 scene 变化，初始化表单
watch(() => props.scene, (newScene) => {
  if (newScene) {
    editForm.value = {
      id: newScene.id,
      title: newScene.title,
      description: newScene.description,
      characters: [...newScene.characters],
      dialogues: newScene.dialogues.map(d => ({ ...d })),
      duration: newScene.duration,
      setting: newScene.setting ? { ...newScene.setting } : undefined
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
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
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
            <select
              v-model="editForm.setting!.timeOfDay"
              class="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
            >
              <option v-for="opt in timeOfDayOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
        </div>

        <!-- 时长 -->
        <div class="space-y-2">
          <label class="text-sm font-medium">预计时长 (秒)</label>
          <div class="flex items-center space-x-4">
            <input
              v-model.number="editForm.duration"
              type="range"
              min="4"
              max="12"
              class="flex-1"
            />
            <span class="w-12 text-center font-medium">{{ editForm.duration }}秒</span>
          </div>
        </div>

        <!-- 对话列表 -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium">对话内容</label>
            <Button variant="ghost" size="sm" @click="addDialogue">
              <Plus class="w-4 h-4 mr-1" />
              添加对话
            </Button>
          </div>

          <div v-if="editForm.dialogues.length === 0" class="text-center py-6 text-muted-foreground border-2 border-dashed rounded-lg">
            <p class="text-sm">暂无对话，点击上方按钮添加</p>
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
                <select
                  v-model="dialogue.character"
                  class="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                >
                  <option
                    v-for="char in editForm.characters"
                    :key="char.name"
                    :value="char.name"
                  >
                    {{ char.name }}
                  </option>
                  <option
                    v-for="char in (availableCharacters || []).filter(c => !editForm.characters.find(ec => ec.name === c))"
                    :key="char"
                    :value="char"
                  >
                    {{ char }}
                  </option>
                </select>
              </div>

              <!-- 情绪选择 -->
              <div class="space-y-1">
                <label class="text-xs text-muted-foreground">情绪</label>
                <select
                  v-model="dialogue.emotion"
                  class="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                >
                  <option v-for="opt in emotionOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
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
        <Button variant="outline" @click="handleCancel">
          取消
        </Button>
        <Button @click="handleSave">
          保存修改
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
