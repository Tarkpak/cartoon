<script setup lang="ts">
const props = defineProps<{
  open: boolean
  title: string
  description: string
  targetLabel: string
  prompt: string
  promptPlaceholder: string
  error?: string | null
  loading: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'update:prompt': [prompt: string]
  'submit': []
}>()

const promptModel = computed({
  get: () => props.prompt,
  set: value => emit('update:prompt', value)
})
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-3">
        <div class="text-xs text-muted-foreground">
          目标：{{ targetLabel || '-' }}
        </div>
        <Textarea
          v-model="promptModel"
          class="min-h-[140px] text-sm"
          :placeholder="promptPlaceholder"
        />
        <p
          v-if="error"
          class="text-xs text-destructive"
        >
          {{ error }}
        </p>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="loading"
          @click="emit('update:open', false)"
        >
          取消
        </Button>
        <Button
          :disabled="!prompt.trim() || loading"
          @click="emit('submit')"
        >
          <Loader2
            v-if="loading"
            class="mr-2 h-4 w-4 animate-spin"
          />
          开始二次生成
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
