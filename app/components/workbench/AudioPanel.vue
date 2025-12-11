<script setup lang="ts">
import type { AudioConfig, CharacterData } from '~/composables/useWorkbench'

const props = defineProps<{
  audioConfig: AudioConfig
  characters: CharacterData[]
}>()

const emit = defineEmits<{
  'update:audioConfig': [value: AudioConfig]
}>()

const localConfig = computed({
  get: () => props.audioConfig,
  set: v => emit('update:audioConfig', v)
})

function updateEnabled(value: boolean) {
  emit('update:audioConfig', { ...props.audioConfig, enabled: value })
}

function updateBgmEnabled(value: boolean) {
  emit('update:audioConfig', { ...props.audioConfig, bgmEnabled: value })
}

function updateVoice(charName: string, voice: string) {
  emit('update:audioConfig', {
    ...props.audioConfig,
    voices: { ...props.audioConfig.voices, [charName]: voice }
  })
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6">
    <div class="space-y-4">
      <h3 class="font-semibold">
        音频设置
      </h3>
      <div class="flex items-center justify-between p-4 border rounded-lg">
        <div>
          <div class="font-medium">
            启用配音
          </div>
          <p class="text-sm text-muted-foreground">
            为角色对话生成 AI 配音
          </p>
        </div>
        <Switch
          :checked="localConfig.enabled"
          @update:checked="updateEnabled"
        />
      </div>
      <div class="flex items-center justify-between p-4 border rounded-lg">
        <div>
          <div class="font-medium">
            背景音乐
          </div>
          <p class="text-sm text-muted-foreground">
            自动生成氛围背景音乐
          </p>
        </div>
        <Switch
          :checked="localConfig.bgmEnabled"
          @update:checked="updateBgmEnabled"
        />
      </div>
    </div>

    <div
      v-if="localConfig.enabled && characters.length > 0"
      class="space-y-4"
    >
      <h3 class="font-semibold">
        角色配音
      </h3>
      <div class="space-y-3">
        <div
          v-for="char in characters"
          :key="char.id"
          class="flex items-center justify-between p-4 border rounded-lg"
        >
          <div class="flex items-center space-x-3">
            <div class="w-10 h-10 bg-gradient-to-br from-purple-100 to-pink-100 rounded-full flex items-center justify-center">
              <span class="text-sm font-medium">{{ char.name[0] }}</span>
            </div>
            <span class="font-medium">{{ char.name }}</span>
          </div>
          <select
            :value="localConfig.voices[char.name] || ''"
            class="h-9 px-3 rounded-md border border-input bg-background text-sm"
            @change="updateVoice(char.name, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">
              自动选择
            </option>
            <option value="male_1">
              男声 1
            </option>
            <option value="male_2">
              男声 2
            </option>
            <option value="female_1">
              女声 1
            </option>
            <option value="female_2">
              女声 2
            </option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>
