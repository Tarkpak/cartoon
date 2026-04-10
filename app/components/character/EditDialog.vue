<script setup lang="ts">
import { Loader2, User, Meh, Smile, Frown, Angry, Zap } from 'lucide-vue-next'
import { toImageSrc } from '~/lib/media'

interface CharacterEditData {
  id: string
  name: string
  appearance: string
  role: string
  baseImage?: string
  expressions?: Record<string, string> // 表情图片映射
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
  role: 'supporting'
})

// 监听 character 变化，初始化表单
watch(() => props.character, (newChar) => {
  if (newChar) {
    editForm.value = {
      id: newChar.id,
      name: newChar.name,
      appearance: newChar.appearance,
      role: newChar.role,
      baseImage: newChar.baseImage,
      expressions: newChar.expressions ? { ...newChar.expressions } : {}
    }
  }
}, { immediate: true })

// 角色类型选项
const roleOptions = [
  { value: 'protagonist', label: '主角' },
  { value: 'antagonist', label: '反派' },
  { value: 'supporting', label: '配角' }
]

// 表情选项
const emotionOptions = [
  { value: 'neutral', label: '平静', icon: Meh },
  { value: 'happy', label: '开心', icon: Smile },
  { value: 'sad', label: '悲伤', icon: Frown },
  { value: 'angry', label: '愤怒', icon: Angry },
  { value: 'surprised', label: '惊讶', icon: Zap }
]

// 生成中的表情
const generatingEmotions = ref<Set<string>>(new Set())

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
    <DialogContent class="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>编辑角色</DialogTitle>
        <DialogDescription>
          修改角色信息并预览不同表情
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-6 py-4">
        <!-- 角色基本信息 -->
        <div class="flex items-start space-x-6">
          <!-- 角色立绘 -->
          <div class="flex-shrink-0">
            <div class="w-32 h-32 bg-gradient-to-br from-purple-100 to-pink-100 rounded-xl flex items-center justify-center overflow-hidden">
              <img
                v-if="editForm.baseImage"
                :src="toImageSrc(editForm.baseImage)"
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
        </div>

        <!-- 外貌描述 -->
        <div class="space-y-2">
          <label class="text-sm font-medium">外貌描述</label>
          <Textarea
            v-model="editForm.appearance"
            placeholder="详细描述角色的外貌特征，如：发型、发色、眼睛颜色、服装等..."
            class="min-h-[100px]"
          />
          <p class="text-xs text-muted-foreground">
            详细的外貌描述有助于生成更准确的角色立绘
          </p>
        </div>

        <!-- 表情预览 -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium">表情变体预览</label>
            <span class="text-xs text-muted-foreground">点击生成不同表情</span>
          </div>

          <div class="grid grid-cols-5 gap-3">
            <div
              v-for="emotion in emotionOptions"
              :key="emotion.value"
              class="flex flex-col items-center space-y-2"
            >
              <div
                class="w-16 h-16 rounded-lg border-2 flex items-center justify-center cursor-pointer transition hover:border-primary overflow-hidden"
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
                  :src="toImageSrc(editForm.expressions[emotion.value])"
                  class="w-full h-full object-cover"
                >
                <component
                  v-else
                  :is="emotion.icon"
                  class="w-6 h-6 text-muted-foreground opacity-50"
                />
              </div>
              <span class="text-xs text-muted-foreground">{{ emotion.label }}</span>
            </div>
          </div>

          <p
            v-if="!editForm.baseImage"
            class="text-xs text-amber-600 text-center"
          >
            请先生成角色基础立绘，才能生成表情变体
          </p>
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
