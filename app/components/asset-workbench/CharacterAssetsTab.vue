<script setup lang="ts">
import { Loader2, Pencil, Sparkles, Upload, Users } from 'lucide-vue-next'
import type { CharacterData } from '~/composables/useAssetWorkbench'
import type { CharacterRoleOption } from '~/lib/asset-workbench-types'
import { buildAssetUploadInputId, resolveCharacterRoleLabel } from '~/lib/asset-workbench-types'
import { toImageSrc } from '~/lib/media'

const props = defineProps<{
  characters: CharacterData[]
  autoRunning: boolean
  editingCharacterId: string | null
  characterEditDraft: {
    id: string
    name: string
    appearance: string
    role: string
  }
  characterRoleOptions: CharacterRoleOption[]
  uploadingCharacterId: string | null
  getCharacterSceneCount: (character: CharacterData) => number
  setCharacterEditDraft: (draft: { name: string, role: string, appearance: string }) => void
}>()

const emit = defineEmits<{
  'preview-image': [payload: { src: string | undefined, alt: string }]
  'start-edit': [character: CharacterData]
  'cancel-edit': []
  'save-edit': []
  'save-edit-regenerate': []
  'generate': [characterId: string]
  'open-regenerate': [character: CharacterData]
  'upload-image': [payload: { characterId: string, event: Event }]
}>()

function triggerUploadInput(characterId: string) {
  if (typeof document === 'undefined') return
  const input = document.getElementById(buildAssetUploadInputId('char', characterId)) as HTMLInputElement | null
  input?.click()
}

const localDraft = reactive({
  name: '',
  role: 'supporting',
  appearance: ''
})

watch(
  () => [
    props.editingCharacterId,
    props.characterEditDraft.name,
    props.characterEditDraft.role,
    props.characterEditDraft.appearance
  ],
  () => {
    localDraft.name = props.characterEditDraft.name
    localDraft.role = props.characterEditDraft.role
    localDraft.appearance = props.characterEditDraft.appearance
  },
  { immediate: true }
)

watch(localDraft, (draft) => {
  if (
    draft.name === props.characterEditDraft.name
    && draft.role === props.characterEditDraft.role
    && draft.appearance === props.characterEditDraft.appearance
  ) {
    return
  }

  props.setCharacterEditDraft({
    name: draft.name,
    role: draft.role,
    appearance: draft.appearance
  })
}, { deep: true })
</script>

<template>
  <div
    v-if="characters.length === 0"
    class="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
  >
    暂未识别到角色。可返回“剧本解析”补充人物信息后重新解析。
  </div>
  <div
    v-else
    class="grid grid-cols-1 gap-3 md:grid-cols-2"
  >
    <div
      v-for="char in characters"
      :key="char.id"
      class="rounded-md border p-3"
    >
      <div class="flex items-start gap-3">
        <div class="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          <img
            v-if="char.baseImage"
            :src="toImageSrc(char.baseImage)"
            :alt="`${char.name} 角色图`"
            class="h-full w-full cursor-zoom-in object-cover"
            @click="emit('preview-image', { src: char.baseImage, alt: `${char.name} 角色图` })"
          >
          <Users
            v-else
            class="h-8 w-8 text-muted-foreground"
          />
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate font-medium">{{ char.name }}</span>
            <Badge
              variant="outline"
              class="text-[10px]"
            >
              {{ resolveCharacterRoleLabel(char.role) }}
            </Badge>
          </div>

          <template v-if="editingCharacterId === char.id">
            <div class="mt-2 space-y-2">
              <Input
                v-model="localDraft.name"
                class="h-8 text-xs"
                placeholder="角色名称"
              />
              <Select v-model="localDraft.role">
                <SelectTrigger class="h-8 w-full text-xs">
                  <SelectValue placeholder="选择角色类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="opt in characterRoleOptions"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                v-model="localDraft.appearance"
                class="min-h-[72px] text-xs"
                placeholder="角色外观描述（可人工补充）"
              />
            </div>
          </template>
          <template v-else>
            <p class="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {{ char.appearance || '暂无外观描述' }}
            </p>
            <div class="mt-2 flex flex-wrap gap-1">
              <Badge
                variant="outline"
                class="text-[10px]"
              >
                涉及场景 {{ getCharacterSceneCount(char) }}
              </Badge>
              <Badge
                :variant="char.generating ? 'default' : char.baseImage ? 'secondary' : 'outline'"
                class="text-[10px]"
              >
                {{ char.generating ? '生成中' : char.baseImage ? '已就绪' : '待生成' }}
              </Badge>
            </div>
          </template>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <template v-if="editingCharacterId === char.id">
          <Button
            size="sm"
            variant="outline"
            class="h-8 px-3 text-xs"
            :disabled="autoRunning || char.generating"
            @click="emit('save-edit')"
          >
            保存
          </Button>
          <Button
            size="sm"
            class="h-8 px-3 text-xs"
            :disabled="autoRunning || char.generating"
            @click="emit('save-edit-regenerate')"
          >
            <Loader2
              v-if="char.generating"
              class="mr-1 h-3.5 w-3.5 animate-spin"
            />
            保存并重生成
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-8 px-2 text-xs"
            :disabled="autoRunning || char.generating"
            @click="emit('cancel-edit')"
          >
            取消
          </Button>
        </template>
        <template v-else>
          <Button
            size="sm"
            variant="outline"
            class="h-8 px-3 text-xs"
            :disabled="autoRunning || char.generating"
            @click="emit('start-edit', char)"
          >
            <Pencil class="mr-1 h-3.5 w-3.5" />
            编辑
          </Button>
          <Button
            size="sm"
            variant="outline"
            class="h-8 px-3 text-xs"
            :disabled="autoRunning || char.generating"
            @click="emit('generate', char.id)"
          >
            <Loader2
              v-if="char.generating"
              class="mr-1 h-3.5 w-3.5 animate-spin"
            />
            {{ char.baseImage ? '重生成角色图' : '生成角色图' }}
          </Button>
          <Button
            size="sm"
            variant="outline"
            class="h-8 px-3 text-xs"
            :disabled="autoRunning || char.generating || !!uploadingCharacterId"
            @click="triggerUploadInput(char.id)"
          >
            <Loader2
              v-if="uploadingCharacterId === char.id"
              class="mr-1 h-3.5 w-3.5 animate-spin"
            />
            <Upload
              v-else
              class="mr-1 h-3.5 w-3.5"
            />
            上传角色图
          </Button>
          <Button
            v-if="char.baseImage"
            size="sm"
            variant="outline"
            class="h-8 px-3 text-xs"
            :disabled="autoRunning || char.generating"
            @click="emit('open-regenerate', char)"
          >
            <Sparkles class="mr-1 h-3.5 w-3.5" />
            二次生成
          </Button>
          <input
            :id="buildAssetUploadInputId('char', char.id)"
            type="file"
            accept="image/*"
            class="hidden"
            @change="emit('upload-image', { characterId: char.id, event: $event })"
          >
        </template>
      </div>
    </div>
  </div>
</template>
