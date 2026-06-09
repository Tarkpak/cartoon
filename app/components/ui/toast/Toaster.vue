<script setup lang="ts">
import { CheckCircle2, XCircle, AlertTriangle, Info, Bell, X } from 'lucide-vue-next'
import type { ToastItem, ToastVariant } from '~/composables/useToast'

const { toasts, dismiss } = useToast()

const iconByVariant: Record<ToastVariant, unknown> = {
  default: Bell,
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info
}

// 语义状态色（来自设计令牌），错误复用 destructive
const accentClassByVariant: Record<ToastVariant, string> = {
  default: 'text-foreground',
  success: 'text-success',
  error: 'text-destructive',
  warning: 'text-warning',
  info: 'text-info'
}

function resolveRole(variant: ToastVariant): 'alert' | 'status' {
  return variant === 'error' || variant === 'warning' ? 'alert' : 'status'
}

function resolveAriaLive(variant: ToastVariant): 'assertive' | 'polite' {
  return variant === 'error' || variant === 'warning' ? 'assertive' : 'polite'
}
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-0 z-[100] flex flex-col items-end gap-2 p-4 sm:p-6"
      aria-live="polite"
      aria-atomic="false"
    >
      <TransitionGroup
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-x-4 opacity-0"
        enter-to-class="translate-x-0 opacity-100"
        leave-active-class="transition duration-150 ease-in absolute"
        leave-from-class="translate-x-0 opacity-100"
        leave-to-class="translate-x-4 opacity-0"
        move-class="transition duration-200"
      >
        <div
          v-for="item in toasts"
          :key="item.id"
          :role="resolveRole(item.variant)"
          :aria-live="resolveAriaLive(item.variant)"
          class="pointer-events-auto flex w-[22rem] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg border bg-popover px-4 py-3 text-popover-foreground shadow-lg"
        >
          <component
            :is="(iconByVariant[item.variant] as never)"
            class="mt-0.5 h-5 w-5 shrink-0"
            :class="accentClassByVariant[item.variant]"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium leading-snug">
              {{ item.message }}
            </p>
            <p
              v-if="item.description"
              class="mt-0.5 text-xs leading-snug text-muted-foreground"
            >
              {{ item.description }}
            </p>
          </div>
          <button
            type="button"
            class="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="关闭通知"
            @click="dismiss(item.id)"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
