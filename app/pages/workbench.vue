<script setup lang="ts">
import { FileText, Users, Video, Music, Sparkles, Plus, Pencil, Trash2, Wrench } from 'lucide-vue-next'

// 生成工作台页面
definePageMeta({
  layout: 'default',
})

const activeTab = ref('script')

const scriptText = ref(`清晨的阳光透过落地窗洒进办公室，林浩坐在工位上，盯着电脑屏幕发呆。

"林浩，开会了！"同事的声音打断了他的思绪。

他站起身，走向会议室。突然，一道奇异的光芒从他的胸口闪过...

"这是...修仙功法？"林浩难以置信地看着脑海中浮现的古老文字。`)

const scenes = ref([
  {
    id: 'scene_001',
    title: '办公室 - 清晨',
    description: '阳光透过落地窗洒进办公室，林浩坐在工位上发呆',
    characters: ['林浩'],
    duration: 8,
    active: true,
  },
  {
    id: 'scene_002',
    title: '会议室走廊',
    description: '林浩走向会议室，突然胸口闪过奇异光芒',
    characters: ['林浩', '同事'],
    duration: 6,
    active: false,
  },
  {
    id: 'scene_003',
    title: '林浩内心世界',
    description: '脑海中浮现古老文字，林浩震惊',
    characters: ['林浩'],
    duration: 8,
    active: false,
  },
])

const tabs = [
  { key: 'script', label: '剧本编辑', icon: FileText },
  { key: 'characters', label: '角色管理', icon: Users },
  { key: 'video', label: '视频生成', icon: Video },
  { key: 'audio', label: '音频配置', icon: Music },
]

async function parseScript() {
  // TODO: 调用 API 解析剧本
  console.log('解析剧本:', scriptText.value)
}
</script>

<template>
  <div class="p-8">
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-2xl font-bold">生成工作台</h1>
        <p class="text-muted-foreground">都市修仙传 - 第一章</p>
      </div>
      <div class="flex space-x-3">
        <Button variant="outline">保存草稿</Button>
        <Button>开始生成</Button>
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
          @click="activeTab = tab.key"
        >
          <component :is="tab.icon" class="w-4 h-4" />
          <span>{{ tab.label }}</span>
        </button>
      </div>

      <CardContent class="pt-6">
        <!-- 剧本编辑面板 -->
        <div v-if="activeTab === 'script'" class="grid lg:grid-cols-2 gap-6">
          <!-- 左侧: 原文输入 -->
          <div>
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-semibold">原文输入</h3>
              <Button
                variant="ghost"
                size="sm"
                @click="parseScript"
              >
                <Sparkles class="w-4 h-4 mr-2" />
                AI解析
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
              <h3 class="font-semibold">场景列表</h3>
              <Button variant="ghost" size="sm">
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
                    <Button variant="ghost" size="sm" class="h-8 w-8 p-0">
                      <Pencil class="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" class="h-8 w-8 p-0 text-destructive">
                      <Trash2 class="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <h4 class="font-medium mb-1">{{ scene.title }}</h4>
                <p class="text-sm text-muted-foreground mb-2">{{ scene.description }}</p>
                <div class="flex flex-wrap gap-2">
                  <Badge
                    v-for="char in scene.characters"
                    :key="char"
                    variant="outline"
                  >
                    {{ char }}
                  </Badge>
                  <Badge variant="outline">
                    {{ scene.duration }}秒
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 其他标签页占位 -->
        <div v-else class="text-center py-12 text-muted-foreground">
          <Wrench class="w-12 h-12 mx-auto mb-4" />
          <p>{{ tabs.find(t => t.key === activeTab)?.label }} 功能开发中...</p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
