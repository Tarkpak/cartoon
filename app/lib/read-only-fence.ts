import type { Directive } from 'vue'

export interface ReadOnlyFenceOptions {
  readOnly: boolean
  /** Controls inside these selectors stay usable while read-only (browsing, previewing). */
  allow?: string[]
  /** Controls inside these selectors follow their own flag, e.g. export permission. */
  conditional?: Array<{ selector: string, enabled: boolean }>
}

/** Anything inside an element with this attribute stays usable in read-only mode. */
export const READ_ONLY_ALLOWED_SELECTOR = '[data-readonly-allowed]'

const CONTROL_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'a',
  '[role="switch"]',
  '[role="combobox"]',
  '[role="checkbox"]',
  '[contenteditable="true"]'
].join(', ')

/** Decides whether one control must be locked. Exported for tests. */
export function shouldLockControl(control: Pick<Element, 'closest'>, options: ReadOnlyFenceOptions): boolean {
  for (const rule of options.conditional || []) {
    if (control.closest(rule.selector)) return !rule.enabled
  }
  if (!options.readOnly) return false
  const allowed = [READ_ONLY_ALLOWED_SELECTOR, ...(options.allow || [])]
  return !allowed.some(selector => control.closest(selector))
}

export function applyReadOnlyFence(root: HTMLElement, options: ReadOnlyFenceOptions) {
  for (const control of root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)) {
    control.inert = shouldLockControl(control, options)
  }
}

const fenceState = new WeakMap<HTMLElement, { observer: MutationObserver, options: ReadOnlyFenceOptions }>()

/**
 * Locks editing controls in a read-only project while keeping navigation,
 * previews and anything marked `data-readonly-allowed` usable. Re-applies
 * itself when the subtree changes.
 */
export const vReadOnlyFence: Directive<HTMLElement, ReadOnlyFenceOptions> = {
  mounted(root, binding) {
    const state = {
      options: binding.value,
      observer: new MutationObserver(() => applyReadOnlyFence(root, state.options))
    }
    state.observer.observe(root, { childList: true, subtree: true })
    fenceState.set(root, state)
    applyReadOnlyFence(root, binding.value)
  },
  updated(root, binding) {
    const state = fenceState.get(root)
    if (state) state.options = binding.value
    applyReadOnlyFence(root, binding.value)
  },
  unmounted(root) {
    fenceState.get(root)?.observer.disconnect()
    fenceState.delete(root)
  }
}
