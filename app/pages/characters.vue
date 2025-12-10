<script setup lang="ts">
import { Plus, Loader2 } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// 角色管理页面
definePageMeta({
  layout: 'default'
})

interface Character {
  id: string
  name: string
  role: string | null
  appearance: string
  baseImage: string | null
  expressions: string | null
}

const characters = ref<Character[]>([])
const loading = ref(true)

// 添加角色对话框
const showAddDialog = ref(false)
const newCharacter = ref({
  name: '',
  role: 'supporting',
  appearance: ''
})
const creating = ref(false)

// 获取角色列表
async function fetchCharacters() {
  loading.value = true
  try {
    // TODO: 实现角色列表 API
    characters.value = []
  } catch (e) {
    console.error('获取角色失败:', e)
  } finally {
    loading.value = false
  }
}

// 添加角色
async function addCharacter() {
  if (!newCharacter.value.name.trim()) return
  
  creating.value = true
  try {
    // TODO: 调用角色生成 API
    console.log('创建角色:', newCharacter.value)
    showAddDialog.value = false
    newCharacter.value = { name: '', role: 'supporting', appearance: '' }
    await fetchCharacters()
  } catch (e) {
    console.error('添加角色失败:', e)
  } finally {
    creating.value = false
  }
}

// 打开添加对话框
function openAddDialog() {
  newCharacter.value = { name: '', role: 'supporting', appearance: '' }
  showAddDialog.value = true
}

onMounted(fetchCharacters)

// 获取渐变色
function getGradient(index: number): string {
  const gradients = [
    'from-blue-400 to-purple-400',
    'from-pink-400 to-rose-400',
    'from-green-400 to-cyan-400',
    'from-orange-400 to-yellow-400'
  ]
  return gradients[index % gradients.length]
}

// 获取表情列表
function getExpressions(_char: Character): string[] {
  return ['😐', '😊', '😢', '😠', '😲']
}

const roleMap: Record<string, string> = {
  protagonist: '主角',
  antagonist: '反派',
  supporting: '配角',
  extra: '群演'
}

const roleVariants: Record<string, 'success' | 'default' | 'secondary'> = {
  protagonist: 'success',
  antagonist: 'default',
  supporting: 'secondary',
  extra: 'secondary'
}
</script>

<template>
  <div class="p-8">
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-2xl font-bold">
          角色管理
        </h1>
        <p class="text-muted-foreground">
          管理项目中的角色资产
        </p>
      </div>
      <Button size="lg" @click="openAddDialog">
        <Plus class="w-5 h-5 mr-2" />
        添加角色
      </Button>
    </div>

    <!-- 加载状态 -->
    <div
      v-if="loading"
      class="flex items-center justify-center py-12"
    >
      <Loader2 class="w-8 h-8 animate-spin text-muted-foreground" />
    </div>

    <div
      v-else
      class="grid lg:grid-cols-3 gap-6"
    >
      <!-- 角色卡片 -->
      <Card
        v-for="(char, index) in characters"
        :key="char.id"
        class="overflow-hidden hover:shadow-lg transition"
      >
        <div
          class="h-48 bg-gradient-to-br flex items-center justify-center"
          :class="getGradient(index)"
        >
          <div class="w-32 h-32 bg-white/30 rounded-full flex items-center justify-center">
            <span class="text-6xl">👤</span>
          </div>
        </div>

        <CardContent class="pt-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-lg">
              {{ char.name }}
            </h3>
            <Badge :variant="roleVariants[char.role || 'supporting'] || 'secondary'">
              {{ roleMap[char.role || 'supporting'] || '配角' }}
            </Badge>
          </div>

          <p class="text-muted-foreground text-sm mb-4">
            {{ char.appearance || '暂无描述' }}
          </p>

          <div class="mb-4">
            <div class="text-xs text-muted-foreground mb-2">
              表情变体
            </div>
            <div class="flex space-x-2">
              <div
                v-for="(expr, idx) in getExpressions(char)"
                :key="idx"
                class="w-10 h-10 bg-muted rounded-lg flex items-center justify-center text-lg cursor-pointer hover:bg-accent"
              >
                {{ expr }}
              </div>
            </div>
          </div>

          <div class="flex space-x-2">
            <Button
              variant="outline"
              class="flex-1"
            >
              编辑
            </Button>
            <Button
              variant="secondary"
              class="flex-1"
            >
              重新生成
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- 添加角色卡片 -->
      <div
        class="border-2 border-dashed rounded-xl flex items-center justify-center min-h-[400px] cursor-pointer hover:border-primary hover:bg-accent transition"
        @click="openAddDialog"
      >
        <div class="text-center">
          <div class="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <Plus class="w-8 h-8 text-muted-foreground" />
          </div>
          <div class="text-muted-foreground font-medium">
            添加新角色
          </div>
          <div class="text-muted-foreground/70 text-sm mt-1">
            从剧本自动提取或手动创建
          </div>
        </div>
      </div>
    </div>

    <!-- 添加角色对话框 -->
    <Dialog v-model:open="showAddDialog">
      <DialogContent class="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>添加角色</DialogTitle>
          <DialogDescription>
            创建新角色或从剧本中自动提取
          </DialogDescription>
        </DialogHeader>
        <div class="grid gap-4 py-4">
          <div class="grid gap-2">
            <label class="text-sm font-medium">角色名称</label>
            <Input
              v-model="newCharacter.name"
              placeholder="输入角色名称..."
            />
          </div>
          <div class="grid gap-2">
            <label class="text-sm font-medium">角色类型</label>
            <select
              v-model="newCharacter.role"
              class="h-10 px-3 rounded-md border border-input bg-background text-sm"
            >
              <option value="protagonist">主角</option>
              <option value="antagonist">反派</option>
              <option value="supporting">配角</option>
              <option value="extra">群演</option>
            </select>
          </div>
          <div class="grid gap-2">
            <label class="text-sm font-medium">外貌描述</label>
            <Textarea
              v-model="newCharacter.appearance"
              placeholder="描述角色的外貌特征，用于生成角色立绘..."
              rows="3"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showAddDialog = false">
            取消
          </Button>
          <Button @click="addCharacter" :disabled="!newCharacter.name.trim() || creating">
            <Loader2 v-if="creating" class="w-4 h-4 mr-2 animate-spin" />
            生成角色
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
