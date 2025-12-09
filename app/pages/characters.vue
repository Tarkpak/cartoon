<script setup lang="ts">
import { Plus } from 'lucide-vue-next'

// 角色管理页面
definePageMeta({
  layout: 'default',
})

const characters = ref([
  {
    id: '1',
    name: '林浩',
    role: '主角',
    description: '25岁程序员，意外获得修仙功法，开启都市修仙之路',
    gradient: 'from-blue-400 to-purple-400',
    expressions: ['😐', '😊', '😢', '😠', '😲'],
  },
  {
    id: '2',
    name: '苏雨晴',
    role: '女主',
    description: '神秘修仙世家传人，引导林浩踏入修仙界',
    gradient: 'from-pink-400 to-rose-400',
    expressions: ['😐', '😊', '😢', '😠', '😲'],
  },
])

const roleVariants: Record<string, 'success' | 'default' | 'secondary'> = {
  '主角': 'success',
  '女主': 'default',
  '配角': 'secondary',
}
</script>

<template>
  <div class="p-8">
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-2xl font-bold">角色管理</h1>
        <p class="text-muted-foreground">管理项目中的角色资产</p>
      </div>
      <Button size="lg">
        <Plus class="w-5 h-5 mr-2" />
        添加角色
      </Button>
    </div>

    <div class="grid lg:grid-cols-3 gap-6">
      <!-- 角色卡片 -->
      <Card
        v-for="char in characters"
        :key="char.id"
        class="overflow-hidden hover:shadow-lg transition"
      >
        <div
          class="h-48 bg-gradient-to-br flex items-center justify-center"
          :class="char.gradient"
        >
          <div class="w-32 h-32 bg-white/30 rounded-full flex items-center justify-center">
            <span class="text-6xl">{{ char.name === '林浩' ? '👨' : '👩' }}</span>
          </div>
        </div>

        <CardContent class="pt-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-lg">{{ char.name }}</h3>
            <Badge :variant="roleVariants[char.role] || 'secondary'">
              {{ char.role }}
            </Badge>
          </div>
          
          <p class="text-muted-foreground text-sm mb-4">{{ char.description }}</p>

          <div class="mb-4">
            <div class="text-xs text-muted-foreground mb-2">表情变体</div>
            <div class="flex space-x-2">
              <div
                v-for="(expr, idx) in char.expressions"
                :key="idx"
                class="w-10 h-10 bg-muted rounded-lg flex items-center justify-center text-lg cursor-pointer hover:bg-accent"
              >
                {{ expr }}
              </div>
            </div>
          </div>

          <div class="flex space-x-2">
            <Button variant="outline" class="flex-1">编辑</Button>
            <Button variant="secondary" class="flex-1">重新生成</Button>
          </div>
        </CardContent>
      </Card>

      <!-- 添加角色卡片 -->
      <div
        class="border-2 border-dashed rounded-xl flex items-center justify-center min-h-[400px] cursor-pointer hover:border-primary hover:bg-accent transition"
      >
        <div class="text-center">
          <div class="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <Plus class="w-8 h-8 text-muted-foreground" />
          </div>
          <div class="text-muted-foreground font-medium">添加新角色</div>
          <div class="text-muted-foreground/70 text-sm mt-1">从剧本自动提取或手动创建</div>
        </div>
      </div>
    </div>
  </div>
</template>
