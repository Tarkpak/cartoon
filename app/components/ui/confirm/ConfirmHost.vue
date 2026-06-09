<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const { confirmState, accept, cancel, handleOpenChange } = useConfirm()
</script>

<template>
  <Dialog
    :open="confirmState.open"
    @update:open="handleOpenChange"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ confirmState.title }}</DialogTitle>
        <DialogDescription>{{ confirmState.description }}</DialogDescription>
      </DialogHeader>
      <DialogFooter class="gap-2 sm:gap-2">
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
