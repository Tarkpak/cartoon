<script setup lang="ts">
import { Users, Loader2, Sparkles, Pencil, Scan, RotateCcw } from 'lucide-vue-next'
import type { CharacterData } from '~/composables/useWorkbench'

defineProps<{
  characters: CharacterData[]
  extracting?: boolean
}>()

defineEmits<{
  generateCharacter: [char: CharacterData]
  editCharacter: [char: CharacterData]
  previewImage: [src: string, alt: string]
  extractCharacters: []
  generateViews: [char: CharacterData]
}>()
</script>

<template>
  <div class="space-y-6">
    <!-- 角色提取按钮 -->
    <div class="flex justify-end">
      <Button
        variant="outline"
        size="sm"
        :disabled="extracting"
        @click="$emit('extractCharacters')"
      >
        <Loader2
          v-if="extracting"
          class="w-4 h-4 mr-2 animate-spin"
        />
        <Scan
          v-else
          class="w-4 h-4 mr-2"
        />
        {{ extracting ? '提取中...' : 'AI提取角色' }}
      </Button>
    </div>

    <div
      v-if="characters.length === 0"
      class="text-center py-12 text-muted-foreground"
    >
      <Users class="w-12 h-12 mx-auto mb-4" />
      <p>请先在剧本编辑中解析文本，或点击"AI提取角色"自动提取</p>
    </div>
    <div
      v-else
      class="grid md:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      <div
        v-for="char in characters"
        :key="char.id"
        class="border rounded-xl p-4 hover:border-primary/50 transition"
      >
        <div class="flex items-start space-x-4">
          <div class="w-20 h-20 bg-gradient-to-br from-purple-100 to-pink-100 rounded-lg flex items-center justify-center overflow-hidden">
            <img
              v-if="char.baseImage"
              :src="`data:image/png;base64,${char.baseImage}`"
              class="w-full h-full object-cover cursor-pointer hover:opacity-80 transition"
              @click.stop="$emit('previewImage', `data:image/png;base64,${char.baseImage}`, `${char.name} 立绘`)"
            >
            <Users
              v-else
              class="w-8 h-8 text-muted-foreground"
            />
          </div>
          <div class="flex-1 min-w-0">
            <h4 class="font-semibold">
              {{ char.name }}
            </h4>
            <p class="text-sm text-muted-foreground line-clamp-2">
              {{ char.appearance || '暂无外貌描述' }}
            </p>
            <div class="flex items-center space-x-2 mt-2">
              <Badge variant="outline">
                {{ char.role === 'protagonist' ? '主角' : char.role === 'antagonist' ? '反派' : '配角' }}
              </Badge>
              <Badge
                v-if="char.expressions && Object.keys(char.expressions).length > 0"
                variant="secondary"
              >
                {{ Object.keys(char.expressions).length }} 表情
              </Badge>
            </div>
          </div>
        </div>

        <!-- 表情预览条 -->
        <div
          v-if="char.expressions && Object.keys(char.expressions).length > 0"
          class="mt-3 flex space-x-1"
        >
          <div
            v-for="(imgData, emotion) in char.expressions"
            :key="emotion"
            class="w-8 h-8 rounded border overflow-hidden cursor-pointer hover:ring-2 ring-primary transition"
            :title="String(emotion)"
            @click.stop="$emit('previewImage', `data:image/png;base64,${imgData}`, `${char.name} - ${emotion}`)"
          >
            <img
              :src="`data:image/png;base64,${imgData}`"
              class="w-full h-full object-cover"
            >
          </div>
        </div>

        <!-- 多视角预览条 -->
        <div
          v-if="char.views && Object.keys(char.views).length > 0"
          class="mt-3"
        >
          <p class="text-xs text-muted-foreground mb-1">多视角:</p>
          <div class="flex space-x-1">
            <div
              v-for="(imgData, view) in char.views"
              :key="view"
              class="w-10 h-10 rounded border overflow-hidden cursor-pointer hover:ring-2 ring-primary transition"
              :title="String(view)"
              @click.stop="$emit('previewImage', `data:image/png;base64,${imgData}`, `${char.name} - ${view}`)"
            >
              <img
                :src="`data:image/png;base64,${imgData}`"
                class="w-full h-full object-cover"
              >
            </div>
          </div>
        </div>

        <div class="mt-4 flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            class="flex-1"
            :disabled="char.generating"
            @click="$emit('generateCharacter', char)"
          >
            <Loader2
              v-if="char.generating"
              class="w-4 h-4 mr-1 animate-spin"
            />
            <Sparkles
              v-else
              class="w-4 h-4 mr-1"
            />
            {{ char.baseImage ? '重新生成' : '生成立绘' }}
          </Button>
          <Button
            v-if="char.baseImage"
            variant="outline"
            size="sm"
            :disabled="char.generatingViews"
            title="生成多视角"
            @click="$emit('generateViews', char)"
          >
            <Loader2
              v-if="char.generatingViews"
              class="w-4 h-4 animate-spin"
            />
            <RotateCcw
              v-else
              class="w-4 h-4"
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            @click="$emit('editCharacter', char)"
          >
            <Pencil class="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
