<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loader2 } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  label?: string
  placeholder?: string
  initialValue?: string
  confirmText?: string
  busy?: boolean
  error?: string
}>(), {
  description: '',
  label: '名称',
  placeholder: '',
  initialValue: '',
  confirmText: '确定',
  busy: false,
  error: ''
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm', value: string): void
}>()

const value = ref(props.initialValue)
const localError = ref('')

watch(() => props.open, (open) => {
  if (open) {
    value.value = props.initialValue
    localError.value = ''
  }
})

function handleOpenChange(open: boolean) {
  // 保存过程中不允许通过遮罩/ESC 关闭，避免状态错乱
  if (!open && props.busy) return
  emit('update:open', open)
}

function submit() {
  const trimmed = value.value.trim()
  if (!trimmed) {
    localError.value = '名称不能为空'
    return
  }
  emit('confirm', trimmed)
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleOpenChange"
  >
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription v-if="description">
          {{ description }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-1.5 py-1">
        <label class="text-xs text-muted-foreground">{{ label }}</label>
        <Input
          v-model="value"
          :placeholder="placeholder"
          :disabled="busy"
          @keydown.enter.prevent="submit"
          @update:model-value="localError = ''"
        />
        <p
          v-if="error || localError"
          class="text-xs text-destructive"
        >
          {{ error || localError }}
        </p>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="busy"
          @click="handleOpenChange(false)"
        >
          取消
        </Button>
        <Button
          :disabled="busy || !value.trim()"
          @click="submit"
        >
          <Loader2
            v-if="busy"
            class="mr-1.5 h-4 w-4 animate-spin"
          />
          {{ confirmText }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
