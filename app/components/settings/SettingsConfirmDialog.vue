<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'

withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  confirmText?: string
  confirmVariant?: 'default' | 'destructive'
  busy?: boolean
  error?: string
}>(), {
  description: '',
  confirmText: '确定',
  confirmVariant: 'destructive',
  busy: false,
  error: ''
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm'): void
}>()

function handleOpenChange(open: boolean) {
  emit('update:open', open)
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

      <p
        v-if="error"
        class="text-sm text-destructive"
      >
        {{ error }}
      </p>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="busy"
          @click="handleOpenChange(false)"
        >
          取消
        </Button>
        <Button
          :variant="confirmVariant"
          :disabled="busy"
          @click="emit('confirm')"
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
