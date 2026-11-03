import type { App } from 'vue'

/**
 * KeepAlive detaches a cached component's DOM while it is inactive, and the
 * browser resets scrollTop/scrollLeft of every scroll container in that DOM.
 * This records offsets of any scrolled element while it is attached and, when
 * a cached component is re-activated, writes them back to elements that are
 * attached again but lost their offset.
 *
 * Offsets are captured on scroll, not on deactivation: by the time
 * `deactivated` runs the DOM is already detached and reads 0.
 */
export const PAGE_SCROLL_CONTAINER_ATTRIBUTE = 'data-page-scroll-container'

export interface ScrollRestoreTracker {
  record: (element: Element) => void
  restore: () => void
}

interface ScrollOffset {
  top: number
  left: number
}

export function createScrollRestoreTracker(): ScrollRestoreTracker {
  const offsets = new WeakMap<Element, ScrollOffset>()
  const tracked = new Set<WeakRef<Element>>()
  const refs = new WeakMap<Element, WeakRef<Element>>()

  function record(element: Element) {
    // A detached element always reads 0; never let that overwrite the offset.
    if (!element.isConnected) return
    offsets.set(element, { top: element.scrollTop, left: element.scrollLeft })
    if (!refs.has(element)) {
      const ref = new WeakRef(element)
      refs.set(element, ref)
      tracked.add(ref)
    }
  }

  function restore() {
    for (const ref of tracked) {
      const element = ref.deref()
      if (!element) {
        tracked.delete(ref)
        continue
      }
      if (!element.isConnected) continue
      const offset = offsets.get(element)
      if (!offset) continue
      if (element.scrollTop !== offset.top) element.scrollTop = offset.top
      if (element.scrollLeft !== offset.left) element.scrollLeft = offset.left
    }
  }

  return { record, restore }
}

export function installKeepAliveScrollRestore(app: App) {
  if (typeof window === 'undefined' || typeof WeakRef === 'undefined') return

  const tracker = createScrollRestoreTracker()
  document.addEventListener('scroll', (event) => {
    if (!(event.target instanceof Element)) return
    // The shared layout container is restored per route by pageScrollMemory.
    if (event.target.hasAttribute(PAGE_SCROLL_CONTAINER_ATTRIBUTE)) return
    tracker.record(event.target)
  }, { capture: true, passive: true })

  // Every component in a re-activated tree fires `activated`; coalesce them.
  let scheduled = false
  function scheduleRestore() {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      tracker.restore()
      // Layout may not be settled in the activation tick; retry next frame.
      requestAnimationFrame(() => {
        scheduled = false
        tracker.restore()
      })
    })
  }

  app.mixin({
    activated: scheduleRestore
  })
}

/**
 * The layout's content container sits outside the route KeepAlive and is
 * shared by every page, so its offset leaks from one page to the next. Keep
 * one offset per route path: save on leaving, restore when the page enters.
 */
export function createPageScrollMemory() {
  let container: HTMLElement | null = null
  const offsets = new Map<string, number>()

  function apply(key: string) {
    if (container) container.scrollTop = offsets.get(key) ?? 0
  }

  return {
    setContainer(element: HTMLElement | null) {
      container = element
    },
    save(key: string) {
      if (container?.isConnected) offsets.set(key, container.scrollTop)
    },
    restore(key: string) {
      apply(key)
      // The entering page may still be laying out; retry next frame.
      requestAnimationFrame(() => apply(key))
    }
  }
}

export const pageScrollMemory = createPageScrollMemory()
