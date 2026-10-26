<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogFooter
} from '@/components/ui/dialog'
import ConfirmBody from './ConfirmBody.vue'
import { Button } from '@/components/ui/button'

const { confirmState, accept, cancel, handleOpenChange } = useConfirm()
</script>

<template>
  <Dialog
    :open="confirmState.open"
    @update:open="handleOpenChange"
  >
    <DialogContent
      class="z-[70] max-w-sm gap-5 p-5"
      overlay-class="z-[60]"
      hide-close
    >
      <ConfirmBody
        :title="confirmState.title"
        :description="confirmState.description"
        :variant="confirmState.variant"
      />
      <DialogFooter class="pt-0">
        <Button
          variant="outline"
          @click="cancel"
        >
          {{ confirmState.cancelText }}
        </Button>
        <Button
          :variant="confirmState.variant === 'destructive' ? 'destructive' : 'default'"
          @click="accept"
        >
          {{ confirmState.confirmText }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
