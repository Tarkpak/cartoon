<script setup lang="ts">
import { Loader2, Plus, X, User, Meh, Smile, Frown, Angry, Zap, AlertTriangle } from 'lucide-vue-next'

interface CharacterEditData {
  id: string
  name: string
  appearance: string
  role: string
  baseImage?: string
  expressions?: Record<string, string>
  // 新增字段
  personality?: string
  traits?: string[]
  background?: string
  motivation?: string
  speakingStyle?: string
  catchphrase?: string
  voiceTone?: string
  age?: number
  gender?: string
}

const props = defineProps<{
  open: boolean
  character: CharacterEditData | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'save': [character: CharacterEditData]
  'generate-expression': [characterId: string, emotion: string]
}>()

// 本地编辑状态
const editForm = ref<CharacterEditData>({
  id: '',
  name: '',
  appearance: '',
  role: 'supporting',
  traits: []
})

// 新特点输入
const newTrait = ref('')

// 监听 character 变化，初始化表单
watch(() => props.character, (newChar) => {
  if (newChar) {
    editForm.value = {
      id: newChar.id,
      name: newChar.name,
      appearance: newChar.appearance,
      role: newChar.role,
      baseImage: newChar.baseImage,
      expressions: newChar.expressions ? { ...newChar.expressions } : {},
      personality: newChar.personality || '',
      traits: newChar.traits ? [...newChar.traits] : [],
      background: newChar.background || '',
      motivation: newChar.motivation || '',
      speakingStyle: newChar.speakingStyle || '',
      catchphrase: newChar.catchphrase || '',
      voiceTone: newChar.voiceTone || '',
      age: newChar.age,
      gender: newChar.gender
    }
  }
}, { immediate: true })

// 角色类型选项
const roleOptions = [
  { value: 'protagonist', label: '主角' },
  { value: 'antagonist', label: '反派' },
  { value: 'supporting', label: '配角' }
]

// 说话风格选项
const speakingStyleOptions = [
  { value: '', label: '未设定' },
  { value: 'formal', label: '正式' },
  { value: 'casual', label: '随意' },
  { value: 'polite', label: '礼貌' },
  { value: 'rude', label: '粗鲁' },
  { value: 'childish', label: '孩子气' },
  { value: 'mature', label: '成熟' },
  { value: 'humorous', label: '幽默' },
  { value: 'serious', label: '严肃' },
  { value: 'mysterious', label: '神秘' },
  { value: 'energetic', label: '活泼' }
]

// 性别选项
const genderOptions = [
  { value: '', label: '未设定' },
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' }
]

// 表情选项
const emotionOptions = [
  { value: 'neutral', label: '平静', icon: Meh },
  { value: 'happy', label: '开心', icon: Smile },
  { value: 'sad', label: '悲伤', icon: Frown },
  { value: 'angry', label: '愤怒', icon: Angry },
  { value: 'surprised', label: '惊讶', icon: Zap }
]

// 预设性格特点
const presetTraits = [
  '善良', '勇敢', '聪明', '冷静', '热情',
  '内向', '外向', '固执', '温柔', '傲娇',
  '腹黑', '天然呆', '毒舌', '中二', '高冷'
]

// 生成中的表情
const generatingEmotions = ref<Set<string>>(new Set())

// 当前标签页
const activeTab = ref<'basic' | 'personality' | 'expression'>('basic')

// 添加性格特点
function addTrait() {
  if (newTrait.value.trim() && !editForm.value.traits?.includes(newTrait.value.trim())) {
    if (!editForm.value.traits) {
      editForm.value.traits = []
    }
    editForm.value.traits.push(newTrait.value.trim())
    newTrait.value = ''
  }
}

function addPresetTrait(trait: string) {
  if (!editForm.value.traits?.includes(trait)) {
    if (!editForm.value.traits) {
      editForm.value.traits = []
    }
    editForm.value.traits.push(trait)
  }
}

function removeTrait(index: number) {
  editForm.value.traits?.splice(index, 1)
}

// 生成表情
function requestGenerateExpression(emotion: string) {
  if (!editForm.value.id) return
  generatingEmotions.value.add(emotion)
  emit('generate-expression', editForm.value.id, emotion)
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

// 暴露方法供父组件更新表情图片
defineExpose({
  updateExpression(emotion: string, imageData: string) {
    if (!editForm.value.expressions) {
      editForm.value.expressions = {}
    }
    editForm.value.expressions[emotion] = imageData
    generatingEmotions.value.delete(emotion)
  }
})
</script>

<template>
  <Dialog
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
    <DialogContent class="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle>编辑角色 - {{ editForm.name || '新角色' }}</DialogTitle>
        <DialogDescription>
          完善角色设定，让AI更好地理解角色特点
        </DialogDescription>
      </DialogHeader>

      <!-- 标签页切换 -->
      <div class="flex border-b -mx-6 px-6">
        <button
          class="px-4 py-2 text-sm font-medium transition"
          :class="activeTab === 'basic' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'"
          @click="activeTab = 'basic'"
        >
          基本信息
        </button>
        <button
          class="px-4 py-2 text-sm font-medium transition"
          :class="activeTab === 'personality' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'"
          @click="activeTab = 'personality'"
        >
          性格与背景
        </button>
        <button
          class="px-4 py-2 text-sm font-medium transition"
          :class="activeTab === 'expression' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'"
          @click="activeTab = 'expression'"
        >
          表情变体
        </button>
      </div>

      <div class="flex-1 overflow-y-auto py-4 space-y-6">
        <!-- 基本信息标签页 -->
        <div
          v-if="activeTab === 'basic'"
          class="space-y-6"
        >
          <div class="flex items-start space-x-6">
            <!-- 角色立绘 -->
            <div class="flex-shrink-0">
              <div class="w-32 h-32 bg-gradient-to-br from-purple-100 to-pink-100 rounded-xl flex items-center justify-center overflow-hidden">
                <img
                  v-if="editForm.baseImage"
                  :src="`data:image/png;base64,${editForm.baseImage}`"
                  class="w-full h-full object-cover"
                >
                <User
                  v-else
                  class="w-10 h-10 text-muted-foreground"
                />
              </div>
            </div>

            <!-- 基本信息表单 -->
            <div class="flex-1 space-y-4">
              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                  <label class="text-sm font-medium">角色名称</label>
                  <Input
                    v-model="editForm.name"
                    placeholder="输入角色名称"
                  />
                </div>
                <div class="space-y-2">
                  <label class="text-sm font-medium">角色类型</label>
                  <select
                    v-model="editForm.role"
                    class="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  >
                    <option
                      v-for="opt in roleOptions"
                      :key="opt.value"
                      :value="opt.value"
                    >
                      {{ opt.label }}
                    </option>
                  </select>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                  <label class="text-sm font-medium">年龄</label>
                  <Input
                    v-model.number="editForm.age"
                    type="number"
                    placeholder="如：18"
                  />
                </div>
                <div class="space-y-2">
                  <label class="text-sm font-medium">性别</label>
                  <select
                    v-model="editForm.gender"
                    class="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  >
                    <option
                      v-for="opt in genderOptions"
                      :key="opt.value"
                      :value="opt.value"
                    >
                      {{ opt.label }}
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <!-- 外貌描述 -->
          <div class="space-y-2">
            <label class="text-sm font-medium">外貌描述</label>
            <Textarea
              v-model="editForm.appearance"
              placeholder="详细描述角色的外貌特征，如：发型、发色、眼睛颜色、服装、配饰等..."
              class="min-h-[100px]"
            />
            <p class="text-xs text-muted-foreground">
              详细的外貌描述有助于生成更准确的角色立绘
            </p>
          </div>
        </div>

        <!-- 性格与背景标签页 -->
        <div
          v-if="activeTab === 'personality'"
          class="space-y-6"
        >
          <!-- 性格描述 -->
          <div class="space-y-2">
            <label class="text-sm font-medium">性格描述</label>
            <Textarea
              v-model="editForm.personality"
              placeholder="描述角色的性格特点，如：外冷内热、表面高冷实际很关心朋友..."
              class="min-h-[80px]"
            />
          </div>

          <!-- 性格特点标签 -->
          <div class="space-y-2">
            <label class="text-sm font-medium">性格特点标签</label>
            <div class="flex flex-wrap gap-2 mb-2">
              <Badge
                v-for="(trait, idx) in editForm.traits"
                :key="idx"
                variant="secondary"
                class="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                @click="removeTrait(idx)"
              >
                {{ trait }}
                <X class="w-3 h-3 ml-1" />
              </Badge>
            </div>
            <div class="flex space-x-2">
              <Input
                v-model="newTrait"
                placeholder="输入性格特点"
                class="flex-1"
                @keyup.enter="addTrait"
              />
              <Button
                variant="outline"
                size="sm"
                @click="addTrait"
              >
                <Plus class="w-4 h-4" />
              </Button>
            </div>
            <div class="flex flex-wrap gap-1 mt-2">
              <button
                v-for="trait in presetTraits"
                :key="trait"
                class="text-xs px-2 py-1 rounded-full border hover:bg-accent transition"
                :class="editForm.traits?.includes(trait) ? 'bg-primary text-primary-foreground' : ''"
                @click="addPresetTrait(trait)"
              >
                {{ trait }}
              </button>
            </div>
          </div>

          <!-- 角色背景 -->
          <div class="space-y-2">
            <label class="text-sm font-medium">角色背景</label>
            <Textarea
              v-model="editForm.background"
              placeholder="角色的过去经历、成长环境、重要事件等..."
              class="min-h-[80px]"
            />
          </div>

          <!-- 角色动机 -->
          <div class="space-y-2">
            <label class="text-sm font-medium">角色动机/目标</label>
            <Input
              v-model="editForm.motivation"
              placeholder="角色想要达成什么？驱动他/她行动的是什么？"
            />
          </div>

          <!-- 说话风格 -->
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">说话风格</label>
              <select
                v-model="editForm.speakingStyle"
                class="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option
                  v-for="opt in speakingStyleOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </select>
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">口头禅</label>
              <Input
                v-model="editForm.catchphrase"
                placeholder="如：真是的~、哼！"
              />
            </div>
          </div>

          <!-- 声音特点 -->
          <div class="space-y-2">
            <label class="text-sm font-medium">声音特点</label>
            <Input
              v-model="editForm.voiceTone"
              placeholder="如：低沉有磁性、清脆甜美、沙哑慵懒"
            />
          </div>
        </div>

        <!-- 表情变体标签页 -->
        <div
          v-if="activeTab === 'expression'"
          class="space-y-4"
        >
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium">表情变体预览</label>
            <span class="text-xs text-muted-foreground">点击生成不同表情</span>
          </div>

          <div class="grid grid-cols-5 gap-4">
            <div
              v-for="emotion in emotionOptions"
              :key="emotion.value"
              class="flex flex-col items-center space-y-2"
            >
              <div
                class="w-20 h-20 rounded-lg border-2 flex items-center justify-center cursor-pointer transition hover:border-primary overflow-hidden"
                :class="[
                  editForm.expressions?.[emotion.value] ? 'border-primary/50' : 'border-dashed border-muted-foreground/30',
                  generatingEmotions.has(emotion.value) ? 'animate-pulse' : ''
                ]"
                @click="requestGenerateExpression(emotion.value)"
              >
                <Loader2
                  v-if="generatingEmotions.has(emotion.value)"
                  class="w-6 h-6 animate-spin text-muted-foreground"
                />
                <img
                  v-else-if="editForm.expressions?.[emotion.value]"
                  :src="`data:image/png;base64,${editForm.expressions[emotion.value]}`"
                  class="w-full h-full object-cover"
                >
                <component
                  v-else
                  :is="emotion.icon"
                  class="w-8 h-8 text-muted-foreground opacity-50"
                />
              </div>
              <span class="text-sm text-muted-foreground">{{ emotion.label }}</span>
            </div>
          </div>

          <p
            v-if="!editForm.baseImage"
            class="text-sm text-amber-600 text-center py-4 flex items-center justify-center gap-1"
          >
            <AlertTriangle class="w-4 h-4" />
            请先生成角色基础立绘，才能生成表情变体
          </p>
        </div>
      </div>

      <DialogFooter class="border-t pt-4 -mx-6 px-6">
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
