import { reactive } from 'vue'

// 应用内 Toast 通知体系（模块级单例，跨组件共享同一队列）
export type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: number
  message: string
  description?: string
  variant: ToastVariant
  duration: number
}

export interface ToastOptions {
  description?: string
  /** 毫秒；传 0 表示不自动消失 */
  duration?: number
}

const toasts = reactive<ToastItem[]>([])
let seq = 0

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  default: 3500,
  success: 3000,
  info: 3500,
  warning: 5000,
  error: 6000
}

function dismiss(id: number) {
  const index = toasts.findIndex(item => item.id === id)
  if (index !== -1) toasts.splice(index, 1)
}

function clear() {
  toasts.splice(0, toasts.length)
}

function push(message: string, variant: ToastVariant, options?: ToastOptions): number {
  const id = ++seq
  const duration = options?.duration ?? DEFAULT_DURATION[variant]
  toasts.push({
    id,
    message,
    description: options?.description,
    variant,
    duration
  })

  // 队列上限，避免长时间运行后堆积过多
  if (toasts.length > 6) {
    toasts.splice(0, toasts.length - 6)
  }

  if (duration > 0 && import.meta.client) {
    window.setTimeout(() => dismiss(id), duration)
  }

  return id
}

export function useToast() {
  const toast = {
    show: (message: string, options?: ToastOptions) => push(message, 'default', options),
    success: (message: string, options?: ToastOptions) => push(message, 'success', options),
    error: (message: string, options?: ToastOptions) => push(message, 'error', options),
    warning: (message: string, options?: ToastOptions) => push(message, 'warning', options),
    info: (message: string, options?: ToastOptions) => push(message, 'info', options)
  }

  return {
    toasts,
    toast,
    dismiss,
    clear
  }
}
