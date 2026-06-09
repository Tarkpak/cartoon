import { reactive } from 'vue'

// 应用内确认弹窗（替代原生 confirm），模块级单例
export interface ConfirmOptions {
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  variant?: 'default' | 'destructive'
}

interface ConfirmState {
  open: boolean
  title: string
  description: string
  confirmText: string
  cancelText: string
  variant: 'default' | 'destructive'
}

const state = reactive<ConfirmState>({
  open: false,
  title: '确认操作',
  description: '',
  confirmText: '确定',
  cancelText: '取消',
  variant: 'default'
})

let resolver: ((value: boolean) => void) | null = null

function settle(result: boolean) {
  if (resolver) {
    const resolve = resolver
    resolver = null
    resolve(result)
  }
  state.open = false
}

export function useConfirm() {
  function confirm(options: ConfirmOptions = {}): Promise<boolean> {
    // 上一个确认尚未解决时先以取消结束，避免 Promise 悬挂
    if (resolver) settle(false)

    state.title = options.title ?? '确认操作'
    state.description = options.description ?? ''
    state.confirmText = options.confirmText ?? '确定'
    state.cancelText = options.cancelText ?? '取消'
    state.variant = options.variant ?? 'default'
    state.open = true

    return new Promise<boolean>((resolve) => {
      resolver = resolve
    })
  }

  function handleOpenChange(open: boolean) {
    if (!open) settle(false)
  }

  return {
    confirmState: state,
    confirm,
    accept: () => settle(true),
    cancel: () => settle(false),
    handleOpenChange
  }
}
