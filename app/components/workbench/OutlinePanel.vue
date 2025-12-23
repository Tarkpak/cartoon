<script setup lang="ts">
import { Loader2, Sparkles, Plus, Trash2, ChevronDown, ChevronUp, Palette } from 'lucide-vue-next'
import type { StoryOutline, Act, StoryGenre, StoryPace } from '#shared/types/outline'
import { getStyleById, type StylePreset } from '#shared/types/styles'

const props = defineProps<{
  outline: StoryOutline | null
  rawText: string
  generating: boolean
  selectedStyleId?: string
}>()

// 风格选择对话框
const styleDialogOpen = ref(false)
const localStyleId = ref(props.selectedStyleId || '')

const selectedStyle = computed(() =>
  localStyleId.value ? getStyleById(localStyleId.value) : null
)

const emit = defineEmits<{
  'update:rawText': [value: string]
  'update:outline': [value: StoryOutline]
  'update:selectedStyleId': [value: string]
  'generateOutline': []
  'proceedToCharacters': []
}>()

function handleStyleSelect(style: StylePreset) {
  localStyleId.value = style.id
  emit('update:selectedStyleId', style.id)
  styleDialogOpen.value = false
}

const localRawText = computed({
  get: () => props.rawText,
  set: v => emit('update:rawText', v)
})

// 展开/折叠状态
const expandedActs = ref<Set<string>>(new Set(['act_1', 'act_2', 'act_3']))

function toggleAct(actId: string) {
  if (expandedActs.value.has(actId)) {
    expandedActs.value.delete(actId)
  } else {
    expandedActs.value.add(actId)
  }
}

// 类型选项
const genreOptions: Array<{ value: StoryGenre, label: string }> = [
  { value: 'romance', label: '言情' },
  { value: 'fantasy', label: '奇幻' },
  { value: 'action', label: '动作' },
  { value: 'comedy', label: '喜剧' },
  { value: 'drama', label: '剧情' },
  { value: 'horror', label: '恐怖' },
  { value: 'mystery', label: '悬疑' },
  { value: 'scifi', label: '科幻' },
  { value: 'slice_of_life', label: '日常' }
]

const paceOptions: Array<{ value: StoryPace, label: string }> = [
  { value: 'slow', label: '慢节奏' },
  { value: 'medium', label: '中等' },
  { value: 'fast', label: '快节奏' }
]

const actTypeLabels: Record<string, string> = {
  setup: '第一幕·铺垫',
  confrontation: '第二幕·对抗',
  resolution: '第三幕·解决'
}

// 更新大纲字段
function updateOutlineField<K extends keyof StoryOutline>(field: K, value: StoryOutline[K]) {
  if (props.outline) {
    emit('update:outline', { ...props.outline, [field]: value })
  }
}

// 更新幕内容
function updateAct(actIndex: number, updates: Partial<Act>) {
  if (props.outline) {
    const newActs = [...props.outline.acts]
    const currentAct = newActs[actIndex]
    if (currentAct) {
      newActs[actIndex] = { ...currentAct, ...updates }
      emit('update:outline', { ...props.outline, acts: newActs })
    }
  }
}

// 添加关键事件
function addKeyEvent(actIndex: number) {
  if (props.outline) {
    const newActs = [...props.outline.acts]
    const currentAct = newActs[actIndex]
    if (currentAct) {
      newActs[actIndex] = {
        ...currentAct,
        keyEvents: [...currentAct.keyEvents, '']
      }
      emit('update:outline', { ...props.outline, acts: newActs })
    }
  }
}

// 更新关键事件
function updateKeyEvent(actIndex: number, eventIndex: number, value: string) {
  if (props.outline) {
    const newActs = [...props.outline.acts]
    const currentAct = newActs[actIndex]
    if (currentAct) {
      const newEvents = [...currentAct.keyEvents]
      newEvents[eventIndex] = value
      newActs[actIndex] = { ...currentAct, keyEvents: newEvents }
      emit('update:outline', { ...props.outline, acts: newActs })
    }
  }
}

// 删除关键事件
function removeKeyEvent(actIndex: number, eventIndex: number) {
  if (props.outline) {
    const newActs = [...props.outline.acts]
    const currentAct = newActs[actIndex]
    if (currentAct) {
      const newEvents = currentAct.keyEvents.filter((_: string, i: number) => i !== eventIndex)
      newActs[actIndex] = { ...currentAct, keyEvents: newEvents }
      emit('update:outline', { ...props.outline, acts: newActs })
    }
  }
}
</script>

<template>
  <div class="grid lg:grid-cols-2 gap-6">
    <!-- 左侧: 原始创意/文本输入 -->
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold">
          故事创意
        </h3>
        <Button
          variant="default"
          size="sm"
          :disabled="generating || !rawText.trim()"
          @click="$emit('generateOutline')"
        >
          <Loader2
            v-if="generating"
            class="w-4 h-4 mr-2 animate-spin"
          />
          <Sparkles
            v-else
            class="w-4 h-4 mr-2"
          />
          {{ generating ? '生成中...' : 'AI生成大纲' }}
        </Button>
      </div>
      <Textarea
        v-model="localRawText"
        class="min-h-[400px]"
        placeholder="输入你的故事创意、小说片段或剧本草稿...

示例：
一个普通高中生意外获得了能看到他人命运红线的能力，却发现自己的红线连接着班上最不起眼的女生。当他试图改变命运时，却发现每一次干预都会带来意想不到的后果..."
      />
      <p class="text-xs text-muted-foreground">
        提示：输入越详细，生成的大纲越精准。可以包含人物设定、世界观、核心冲突等。
      </p>

      <!-- 风格选择 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium flex items-center gap-2">
            <Palette class="w-4 h-4" />
            视觉风格
          </label>
          <Button
            variant="outline"
            size="sm"
            @click="styleDialogOpen = true"
          >
            {{ selectedStyle ? '更换风格' : '选择风格' }}
          </Button>
        </div>
        <div
          v-if="selectedStyle"
          class="p-3 bg-accent rounded-lg flex items-center gap-3"
        >
          <div class="w-12 h-12 bg-gradient-to-br from-purple-200 to-pink-200 rounded-lg flex items-center justify-center">
            <span class="text-xl">🎨</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ selectedStyle.name }}</span>
              <span
                v-if="selectedStyle.isNew"
                class="px-1 py-0.5 text-[10px] bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded"
              >
                NEW
              </span>
            </div>
            <p class="text-xs text-muted-foreground truncate">{{ selectedStyle.description }}</p>
          </div>
        </div>
        <div
          v-else
          class="p-3 border-2 border-dashed rounded-lg text-center text-muted-foreground cursor-pointer hover:border-primary/50 transition"
          @click="styleDialogOpen = true"
        >
          <Palette class="w-6 h-6 mx-auto mb-1 opacity-50" />
          <p class="text-sm">点击选择视觉风格</p>
          <p class="text-xs">支持100+种风格预设</p>
        </div>
      </div>
    </div>

    <!-- 右侧: 大纲编辑 -->
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold">
          故事大纲
        </h3>
        <Button
          v-if="outline"
          size="sm"
          @click="$emit('proceedToCharacters')"
        >
          下一步：角色设定 →
        </Button>
      </div>

      <div
        v-if="!outline"
        class="border-2 border-dashed rounded-xl p-12 text-center text-muted-foreground"
      >
        <div class="text-4xl mb-4">
          📝
        </div>
        <p>输入故事创意后，点击"AI生成大纲"</p>
        <p class="text-sm mt-2">
          系统将自动生成三幕结构的故事大纲
        </p>
      </div>

      <div
        v-else
        class="space-y-4 max-h-[600px] overflow-y-auto pr-2"
      >
        <!-- 基本信息 -->
        <Card>
          <CardContent class="pt-4 space-y-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">故事标题</label>
              <Input
                :model-value="outline.title"
                placeholder="输入故事标题"
                @update:model-value="updateOutlineField('title', String($event))"
              />
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium">一句话概括 (Logline)</label>
              <Input
                :model-value="outline.logline"
                placeholder="用一句话概括你的故事"
                @update:model-value="updateOutlineField('logline', String($event))"
              />
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-2">
                <label class="text-sm font-medium">故事类型</label>
                <select
                  :value="outline.genre"
                  class="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  @change="updateOutlineField('genre', ($event.target as HTMLSelectElement).value as StoryGenre)"
                >
                  <option
                    v-for="opt in genreOptions"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }}
                  </option>
                </select>
              </div>
              <div class="space-y-2">
                <label class="text-sm font-medium">故事节奏</label>
                <select
                  :value="outline.pace"
                  class="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  @change="updateOutlineField('pace', ($event.target as HTMLSelectElement).value as StoryPace)"
                >
                  <option
                    v-for="opt in paceOptions"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }}
                  </option>
                </select>
              </div>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium">故事梗概</label>
              <Textarea
                :model-value="outline.synopsis"
                class="min-h-[80px]"
                placeholder="200-500字的故事梗概"
                @update:model-value="updateOutlineField('synopsis', String($event))"
              />
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium">主题/核心思想</label>
              <Input
                :model-value="outline.theme || ''"
                placeholder="这个故事想要表达什么？"
                @update:model-value="updateOutlineField('theme', String($event))"
              />
            </div>
          </CardContent>
        </Card>

        <!-- 三幕结构 -->
        <div class="space-y-3">
          <h4 class="font-medium text-sm text-muted-foreground">
            三幕结构
          </h4>
          <div
            v-for="(act, actIndex) in outline.acts"
            :key="act.id"
            class="border rounded-lg overflow-hidden"
          >
            <!-- 幕标题栏 -->
            <div
              class="flex items-center justify-between p-3 bg-accent cursor-pointer"
              @click="toggleAct(act.id)"
            >
              <div class="flex items-center space-x-2">
                <Badge
                  :variant="act.type === 'setup' ? 'default' : act.type === 'confrontation' ? 'secondary' : 'outline'"
                >
                  {{ actTypeLabels[act.type] }}
                </Badge>
                <span class="font-medium">{{ act.name }}</span>
              </div>
              <ChevronUp
                v-if="expandedActs.has(act.id)"
                class="w-4 h-4"
              />
              <ChevronDown
                v-else
                class="w-4 h-4"
              />
            </div>

            <!-- 幕内容 -->
            <div
              v-if="expandedActs.has(act.id)"
              class="p-4 space-y-4"
            >
              <div class="space-y-2">
                <label class="text-xs text-muted-foreground">幕名称</label>
                <Input
                  :model-value="act.name"
                  placeholder="本幕名称"
                  @update:model-value="updateAct(actIndex, { name: String($event) })"
                />
              </div>

              <div class="space-y-2">
                <label class="text-xs text-muted-foreground">本幕概要</label>
                <Textarea
                  :model-value="act.summary"
                  class="min-h-[60px]"
                  placeholder="描述本幕的主要内容..."
                  @update:model-value="updateAct(actIndex, { summary: String($event) })"
                />
              </div>

              <div class="space-y-2">
                <label class="text-xs text-muted-foreground">情感走向</label>
                <Input
                  :model-value="act.emotionalArc || ''"
                  placeholder="如：从平静到紧张"
                  @update:model-value="updateAct(actIndex, { emotionalArc: String($event) })"
                />
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-xs text-muted-foreground">关键事件</label>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-6 text-xs"
                    @click="addKeyEvent(actIndex)"
                  >
                    <Plus class="w-3 h-3 mr-1" />
                    添加
                  </Button>
                </div>
                <div class="space-y-2">
                  <div
                    v-for="(event, eventIndex) in act.keyEvents"
                    :key="eventIndex"
                    class="flex items-center space-x-2"
                  >
                    <span class="text-xs text-muted-foreground w-4">{{ eventIndex + 1 }}.</span>
                    <Input
                      :model-value="event"
                      class="flex-1 h-8 text-sm"
                      placeholder="关键事件描述"
                      @update:model-value="updateKeyEvent(actIndex, eventIndex, String($event))"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      @click="removeKeyEvent(actIndex, eventIndex)"
                    >
                      <Trash2 class="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 世界观设定 -->
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm">
              世界观设定
            </CardTitle>
          </CardHeader>
          <CardContent class="space-y-3">
            <div class="space-y-2">
              <label class="text-xs text-muted-foreground">世界观</label>
              <Textarea
                :model-value="outline.setting.world"
                class="min-h-[60px]"
                placeholder="描述故事发生的世界..."
                @update:model-value="updateOutlineField('setting', { ...outline.setting, world: String($event) })"
              />
            </div>
            <div class="space-y-2">
              <label class="text-xs text-muted-foreground">时代背景</label>
              <Input
                :model-value="outline.setting.era || ''"
                placeholder="如：现代都市、古代仙侠"
                @update:model-value="updateOutlineField('setting', { ...outline.setting, era: String($event) })"
              />
            </div>
            <div class="space-y-2">
              <label class="text-xs text-muted-foreground">主要场景</label>
              <div class="flex flex-wrap gap-2">
                <Badge
                  v-for="(loc, idx) in outline.setting.mainLocations"
                  :key="idx"
                  variant="outline"
                >
                  {{ loc }}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- 风格选择对话框 -->
    <Dialog v-model:open="styleDialogOpen">
      <DialogContent class="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Palette class="w-5 h-5" />
            选择视觉风格
          </DialogTitle>
          <DialogDescription>
            选择一种风格预设，将应用于角色立绘和视频生成
          </DialogDescription>
        </DialogHeader>
        <div class="flex-1 overflow-y-auto py-4">
          <StyleSelector
            v-model="localStyleId"
            @select="handleStyleSelect"
          />
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
