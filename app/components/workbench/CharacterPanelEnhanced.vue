<script setup lang="ts">
import { Users, Loader2, Sparkles, Pencil, RotateCcw, Link2, ArrowRight, ImagePlus, Heart, Handshake, Swords, BookOpen, Trophy, Briefcase, HelpCircle, MessageCircle, Quote, Lightbulb } from 'lucide-vue-next'
import type { CharacterData } from '~/composables/useWorkbench'
import type { CharacterRelationship } from '#shared/types/outline'
import { toImageSrc } from '~/lib/media'

const props = defineProps<{
  characters: CharacterData[]
  relationships: CharacterRelationship[]
  extracting?: boolean
  batchGenerating?: boolean
  batchProgress?: { current: number, total: number, name: string }
  hasOutline?: boolean
  hasScenes?: boolean
}>()

const emit = defineEmits<{
  generateCharacter: [char: CharacterData]
  editCharacter: [char: CharacterData]
  previewImage: [src: string, alt: string]
  extractFromOutline: []
  batchGenerateCharacters: []
  generateViews: [char: CharacterData]
  updateRelationship: [rel: CharacterRelationship]
  addRelationship: []
  removeRelationship: [index: number]
  proceedToScript: []
}>()

// 计算未生成立绘的角色数量
const charsWithoutImage = computed(() =>
  props.characters.filter(c => !c.baseImage).length
)

// 关系类型选项
const relationshipTypes = [
  { value: 'lover', label: '恋人', icon: Heart },
  { value: 'friend', label: '朋友', icon: Handshake },
  { value: 'enemy', label: '敌人', icon: Swords },
  { value: 'family', label: '家人', icon: Users },
  { value: 'mentor', label: '师徒', icon: BookOpen },
  { value: 'rival', label: '对手', icon: Trophy },
  { value: 'colleague', label: '同事', icon: Briefcase },
  { value: 'stranger', label: '陌生人', icon: HelpCircle }
]

// 角色类型标签
const roleLabels: Record<string, { label: string, color: string }> = {
  protagonist: { label: '主角', color: 'bg-primary/10 text-primary' },
  antagonist: { label: '反派', color: 'bg-destructive/10 text-destructive' },
  supporting: { label: '配角', color: 'bg-muted text-muted-foreground' }
}

// 说话风格标签
const speakingStyleLabels: Record<string, string> = {
  formal: '正式',
  casual: '随意',
  polite: '礼貌',
  rude: '粗鲁',
  childish: '孩子气',
  mature: '成熟',
  humorous: '幽默',
  serious: '严肃',
  mysterious: '神秘',
  energetic: '活泼'
}

function getCharacterName(id: string): string {
  return props.characters.find(c => c.id === id)?.name || '未知'
}

function getRelationshipIcon(type: string) {
  return relationshipTypes.find(r => r.value === type)?.icon || HelpCircle
}

function previewImage(imageData: string | undefined, alt: string) {
  const src = toImageSrc(imageData)
  if (!src) return
  emit('previewImage', src, alt)
}
</script>

<template>
  <div class="space-y-6">
    <!-- 操作栏 -->
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-2">
        <!-- 从大纲提取角色按钮 -->
        <Button
          v-if="hasOutline && characters.length === 0"
          variant="default"
          size="sm"
          :disabled="extracting"
          @click="$emit('extractFromOutline')"
        >
          <Loader2
            v-if="extracting"
            class="w-4 h-4 mr-2 animate-spin"
          />
          <BookOpen
            v-else
            class="w-4 h-4 mr-2"
          />
          {{ extracting ? '提取中...' : '从大纲提取角色' }}
        </Button>
        <!-- 批量生成立绘按钮 -->
        <Button
          v-if="characters.length > 0 && charsWithoutImage > 0"
          variant="outline"
          size="sm"
          :disabled="batchGenerating"
          @click="$emit('batchGenerateCharacters')"
        >
          <Loader2
            v-if="batchGenerating"
            class="w-4 h-4 mr-2 animate-spin"
          />
          <ImagePlus
            v-else
            class="w-4 h-4 mr-2"
          />
          {{ batchGenerating ? `生成中 (${batchProgress?.current || 0}/${batchProgress?.total || 0})` : `一键生成立绘 (${charsWithoutImage})` }}
        </Button>
        <span
          v-if="!hasScenes && !hasOutline"
          class="text-sm text-muted-foreground"
        >
          请先在上一步生成大纲或解析剧本
        </span>
      </div>
      <Button
        v-if="characters.length > 0"
        size="sm"
        @click="$emit('proceedToScript')"
      >
        下一步：场景编辑 →
      </Button>
    </div>

    <!-- 批量生成进度条 -->
    <div
      v-if="batchGenerating && batchProgress"
      class="bg-accent rounded-lg p-3"
    >
      <div class="flex items-center justify-between text-sm mb-2">
        <span>正在生成: {{ batchProgress.name }}</span>
        <span class="text-muted-foreground">{{ batchProgress.current }}/{{ batchProgress.total }}</span>
      </div>
      <Progress :model-value="(batchProgress.current / batchProgress.total) * 100" />
    </div>

    <!-- 空状态 -->
    <div
      v-if="characters.length === 0"
      class="text-center py-12 text-muted-foreground border-2 border-dashed rounded-xl"
    >
      <Users class="w-12 h-12 mx-auto mb-4" />
      <p class="font-medium">还没有角色</p>
      <p class="text-sm mt-1">
        {{ hasOutline ? '点击"从大纲提取角色"自动识别角色信息' : '请先完成故事/剧本步骤，生成大纲' }}
      </p>
    </div>

    <!-- 角色列表 -->
    <div
      v-else
      class="grid lg:grid-cols-2 gap-6"
    >
      <!-- 左侧：角色卡片 -->
      <div class="space-y-4">
        <h3 class="font-semibold flex items-center">
          <Users class="w-4 h-4 mr-2" />
          角色列表 ({{ characters.length }})
        </h3>
        <div class="space-y-3 max-h-[500px] overflow-y-auto pr-2">
          <div
            v-for="char in characters"
            :key="char.id"
            class="border rounded-xl p-4 hover:border-primary/50 transition"
          >
            <div class="flex items-start space-x-4">
              <!-- 角色头像 -->
              <div class="w-20 h-20 bg-muted rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                <img
                  v-if="char.baseImage"
                  :src="toImageSrc(char.baseImage)"
                  class="w-full h-full object-cover cursor-pointer hover:opacity-80 transition"
                  @click.stop="previewImage(char.baseImage, `${char.name} 立绘`)"
                >
                <Users
                  v-else
                  class="w-8 h-8 text-muted-foreground"
                />
              </div>

              <!-- 角色信息 -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center space-x-2 mb-1">
                  <h4 class="font-semibold">
                    {{ char.name }}
                  </h4>
                  <span
                    v-if="char.role"
                    class="text-xs px-2 py-0.5 rounded-full"
                    :class="roleLabels[char.role]?.color || 'bg-gray-100'"
                  >
                    {{ roleLabels[char.role]?.label || char.role }}
                  </span>
                </div>

                <!-- 性格特点 -->
                <div
                  v-if="char.traits && char.traits.length > 0"
                  class="flex flex-wrap gap-1 mb-2"
                >
                  <Badge
                    v-for="trait in char.traits.slice(0, 3)"
                    :key="trait"
                    variant="secondary"
                    class="text-xs"
                  >
                    {{ trait }}
                  </Badge>
                  <Badge
                    v-if="char.traits.length > 3"
                    variant="outline"
                    class="text-xs"
                  >
                    +{{ char.traits.length - 3 }}
                  </Badge>
                </div>

                <!-- 外貌描述 -->
                <p class="text-sm text-muted-foreground line-clamp-2 mb-2">
                  {{ char.appearance || '暂无外貌描述' }}
                </p>

                <!-- 说话风格 -->
                <div
                  v-if="char.speakingStyle || char.catchphrase"
                  class="text-xs text-muted-foreground flex items-center"
                >
                  <span v-if="char.speakingStyle" class="flex items-center">
                    <MessageCircle class="w-3 h-3 mr-1" />
                    {{ speakingStyleLabels[char.speakingStyle] || char.speakingStyle }}
                  </span>
                  <span
                    v-if="char.catchphrase"
                    class="ml-2 flex items-center"
                  >
                    <Quote class="w-3 h-3 mr-1" />
                    "{{ char.catchphrase }}"
                  </span>
                </div>
              </div>
            </div>

            <!-- 表情预览 -->
            <div
              v-if="char.expressions && Object.keys(char.expressions).length > 0"
              class="mt-3 flex space-x-1"
            >
              <div
                v-for="(imgData, emotion) in char.expressions"
                :key="emotion"
                class="w-8 h-8 rounded border overflow-hidden cursor-pointer hover:ring-2 ring-primary transition"
                :title="String(emotion)"
                @click.stop="previewImage(typeof imgData === 'string' ? imgData : undefined, `${char.name} - ${emotion}`)"
              >
                <img
                  :src="toImageSrc(typeof imgData === 'string' ? imgData : undefined)"
                  class="w-full h-full object-cover"
                >
              </div>
            </div>

            <!-- 操作按钮 -->
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

      <!-- 右侧：角色关系图 -->
      <div class="space-y-4">
        <h3 class="font-semibold flex items-center">
          <Link2 class="w-4 h-4 mr-2" />
          角色关系
        </h3>

        <div
          v-if="relationships.length === 0"
          class="border-2 border-dashed rounded-xl p-8 text-center text-muted-foreground"
        >
          <Link2 class="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p class="text-sm">暂无角色关系</p>
          <Button
            variant="outline"
            size="sm"
            class="mt-3"
            :disabled="characters.length < 2"
            @click="$emit('addRelationship')"
          >
            添加关系
          </Button>
        </div>

        <div
          v-else
          class="space-y-3"
        >
          <div
            v-for="(rel, idx) in relationships"
            :key="idx"
            class="flex items-center space-x-3 p-3 border rounded-lg"
          >
            <div class="flex items-center space-x-2 flex-1">
              <Badge variant="outline">
                {{ getCharacterName(rel.fromCharacterId) }}
              </Badge>
              <div class="flex items-center space-x-1 text-muted-foreground">
                <component :is="getRelationshipIcon(rel.type)" class="w-4 h-4" />
                <ArrowRight class="w-4 h-4" />
              </div>
              <Badge variant="outline">
                {{ getCharacterName(rel.toCharacterId) }}
              </Badge>
            </div>
            <Select
              :model-value="rel.type"
              @update:model-value="$emit('updateRelationship', { ...rel, type: String($event) as any })"
            >
              <SelectTrigger class="h-8 w-[110px] text-sm">
                <SelectValue placeholder="关系" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="rt in relationshipTypes"
                  :key="rt.value"
                  :value="rt.value"
                >
                  {{ rt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              class="h-8 w-8 p-0 text-destructive"
              @click="$emit('removeRelationship', idx)"
            >
              ×
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            class="w-full"
            :disabled="characters.length < 2"
            @click="$emit('addRelationship')"
          >
            + 添加关系
          </Button>
        </div>

        <!-- 角色背景提示 -->
        <Card class="bg-accent/50">
          <CardContent class="pt-4">
            <h4 class="font-medium text-sm mb-2 flex items-center gap-1">
              <Lightbulb class="w-4 h-4" />
              角色设定提示
            </h4>
            <ul class="text-xs text-muted-foreground space-y-1">
              <li>• 点击角色卡片的编辑按钮可以完善角色设定</li>
              <li>• 详细的性格和背景描述有助于生成更准确的对话</li>
              <li>• 角色关系会影响对话语气和互动方式</li>
              <li>• 说话风格和口头禅让角色更有辨识度</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
