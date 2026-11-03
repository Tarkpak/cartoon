import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => !element.hasAttribute('inert') && element.getClientRects().length > 0)
}

/**
 * Modal behaviour for full-screen overlays that can't use the Dialog primitive
 * (lightboxes and canvas editors that must stack above any open dialog):
 * Escape closes, focus moves inside on open, Tab is trapped, and focus returns
 * to the opener on close.
 */
export function useModalOverlay(options: {
  open: Ref<boolean>
  root: Ref<HTMLElement | null>
  onClose: () => void
}) {
  let returnFocusTo: HTMLElement | null = null

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      options.onClose()
      return
    }
    if (event.key !== 'Tab' || !options.root.value) return
    const focusable = focusableWithin(options.root.value)
    if (focusable.length === 0) {
      event.preventDefault()
      options.root.value.focus()
      return
    }
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    const active = document.activeElement
    if (event.shiftKey && (active === first || !options.root.value.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !options.root.value.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  function activate() {
    returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', handleKeydown, true)
    void nextTick(() => {
      const root = options.root.value
      if (!root) return
      const target = focusableWithin(root)[0] ?? root
      target.focus({ preventScroll: true })
    })
  }

  function deactivate() {
    document.removeEventListener('keydown', handleKeydown, true)
    const target = returnFocusTo
    returnFocusTo = null
    if (target?.isConnected) target.focus({ preventScroll: true })
  }

  watch(options.open, (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) activate()
    else if (!isOpen && wasOpen) deactivate()
  }, { immediate: true })

  onBeforeUnmount(() => {
    if (options.open.value) deactivate()
  })
}
