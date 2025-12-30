<script setup lang="ts">
import { Loader2, Sparkles, Plus, Trash2, ChevronDown, ChevronUp, FileText, BookOpen, FileEdit, CheckCircle } from 'lucide-vue-next'
import type { StoryOutline, Act, StoryGenre, StoryPace } from '#shared/types/outline'

const props = defineProps<{
  outline: StoryOutline | null
  rawText: string
  scriptText: string
  generating: boolean
  parsing: boolean
  hasScenes: boolean
  inputMode: 'idea' | 'script'
}>()

const emit = defineEmits<{
  'update:rawText': [value: string]
  'update:scriptText': [value: string]
  'update:outline': [value: StoryOutline]
  'update:inputMode': [value: 'idea' | 'script']
  'generateOutline': []
  'parseScript': []
  'proceedToCharacters': []
}>()

// 输入模式：'idea' 从创意生成大纲，'script' 直接输入剧本文本
// 使用 v-model 模式，支持外部控制
const localInputMode = computed({
  get: () => props.inputMode,
  set: v => emit('update:inputMode', v)
})

const localRawText = computed({
  get: () => props.rawText,
  set: v => emit('update:rawText', v)
})

const localScriptText = computed({
  get: () => props.scriptText,
  set: v => emit('update:scriptText', v)
})

// 判断是否可以进入下一步
const canProceed = computed(() => {
  if (localInputMode.value === 'idea') {
    return !!props.outline
  } else {
    return props.hasScenes
  }
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
    <!-- 左侧: 输入区域 -->
    <div class="space-y-4">
      <!-- 输入模式切换 -->
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <Button
            :variant="localInputMode === 'script' ? 'default' : 'outline'"
            size="sm"
            @click="localInputMode = 'script'"
          >
            <FileText class="w-4 h-4 mr-2" />
            直接输入剧本
          </Button>
          <Button
            :variant="localInputMode === 'idea' ? 'default' : 'outline'"
            size="sm"
            @click="localInputMode = 'idea'"
          >
            <BookOpen class="w-4 h-4 mr-2" />
            从创意生成
          </Button>
        </div>
      </div>

      <!-- 模式 A: 从创意生成大纲 -->
      <div v-if="localInputMode === 'idea'" class="space-y-4">
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
          class="min-h-[300px]"
          placeholder="输入你的故事创意、小说片段或剧本草稿...

示例：
一个普通高中生意外获得了能看到他人命运红线的能力，却发现自己的红线连接着班上最不起眼的女生。当他试图改变命运时，却发现每一次干预都会带来意想不到的后果..."
        />
        <p class="text-xs text-muted-foreground">
          提示：输入越详细，生成的大纲越精准。可以包含人物设定、世界观、核心冲突等。
        </p>
      </div>

      <!-- 模式 B: 直接输入剧本文本 -->
      <div v-else class="space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold">
            剧本/小说文本
          </h3>
          <Button
            variant="default"
            size="sm"
            :disabled="parsing || !scriptText.trim()"
            @click="$emit('parseScript')"
          >
            <Loader2
              v-if="parsing"
              class="w-4 h-4 mr-2 animate-spin"
            />
            <Sparkles
              v-else
              class="w-4 h-4 mr-2"
            />
            {{ parsing ? '解析中...' : 'AI解析场景' }}
          </Button>
        </div>
        <Textarea
          v-model="localScriptText"
          class="min-h-[300px]"
          placeholder="直接粘贴小说文本或剧本内容...

AI 将自动解析出：
- 场景划分
- 角色列表
- 对话内容
- 场景描述"
        />
        <p class="text-xs text-muted-foreground">
          提示：支持小说、剧本、对话等多种格式，AI 会智能识别并解析为结构化场景。
        </p>
      </div>
    </div>

    <!-- 右侧: 结果展示 -->
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold">
          {{ localInputMode === 'idea' ? '故事大纲' : '解析结果' }}
        </h3>
        <Button
          v-if="canProceed"
          size="sm"
          @click="$emit('proceedToCharacters')"
        >
          下一步：角色设定 →
        </Button>
      </div>

      <!-- 模式 A 结果: 大纲展示 -->
      <template v-if="localInputMode === 'idea'">
        <div
          v-if="!outline"
          class="border-2 border-dashed rounded-xl p-12 text-center text-muted-foreground"
        >
          <div class="mb-4 flex justify-center">
            <FileEdit class="w-12 h-12" />
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
      </template>

      <!-- 模式 B 结果: 场景解析结果预览 -->
      <template v-else>
        <div
          v-if="!hasScenes"
          class="border-2 border-dashed rounded-xl p-12 text-center text-muted-foreground"
        >
          <div class="mb-4 flex justify-center">
            <FileText class="w-12 h-12" />
          </div>
          <p>粘贴剧本文本后，点击"AI解析场景"</p>
          <p class="text-sm mt-2">
            系统将自动识别场景、角色和对话
          </p>
        </div>

        <div
          v-else
          class="border-2 border-green-200 bg-green-50 rounded-xl p-8 text-center"
        >
          <div class="mb-4 flex justify-center">
            <CheckCircle class="w-12 h-12 text-green-600" />
          </div>
          <p class="font-medium text-green-700">场景解析完成</p>
          <p class="text-sm mt-2 text-green-600">
            已成功解析出场景和角色，点击"下一步"继续
          </p>
          <p class="text-xs mt-4 text-muted-foreground">
            你可以在后续步骤中编辑场景内容
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
