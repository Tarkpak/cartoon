import { computed, getCurrentInstance, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Ref } from 'vue'

export const DEFAULT_INCREMENTAL_PAGE_SIZE = 24

/**
 * Render a long list in pages. Only the first `limit` items are mounted; when
 * the sentinel element nears the viewport (or any scrolling ancestor's
 * visible area) the next page is appended.
 */
export function useIncrementalList<T>(
  source: () => T[],
  options: {
    pageSize?: number
    rootMargin?: string
    resetKey?: () => unknown
    /**
     * When provided, items added after the initial render (a few at a time,
     * e.g. the user clicking "add") are revealed even if they land past the
     * current page. Bulk additions such as loading a project are not.
     */
    getKey?: (item: T) => string
  } = {}
) {
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_INCREMENTAL_PAGE_SIZE)
  const limit = ref(pageSize)
  const sentinel: Ref<HTMLElement | null> = ref(null)

  const total = computed(() => source().length)
  const visibleItems = computed(() => source().slice(0, limit.value))
  const hasMore = computed(() => total.value > limit.value)

  function loadMore() {
    if (!hasMore.value) return
    limit.value += pageSize
  }

  function loadAll() {
    limit.value = Math.max(limit.value, total.value)
  }

  function reset() {
    limit.value = pageSize
  }

  // Make sure the item at `index` is rendered, e.g. before scrolling to it.
  function ensureIndexVisible(index: number) {
    if (index < limit.value) return
    limit.value = Math.ceil((index + 1) / pageSize) * pageSize
  }

  if (options.resetKey) {
    watch(options.resetKey, reset)
  }

  const getKey = options.getKey
  if (getKey) {
    watch(
      () => source().map(getKey),
      (keys, previousKeys) => {
        const known = new Set(previousKeys)
        const addedIndexes: number[] = []
        keys.forEach((key, index) => {
          if (!known.has(key)) addedIndexes.push(index)
        })
        if (addedIndexes.length === 0 || addedIndexes.length >= pageSize) return
        ensureIndexVisible(Math.max(...addedIndexes))
      }
    )
  }

  let observer: IntersectionObserver | null = null

  function disconnect() {
    observer?.disconnect()
    observer = null
  }

  function connect(element: HTMLElement) {
    disconnect()
    if (typeof IntersectionObserver === 'undefined') return
    observer = new IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting)) return
      loadMore()
      // The observer only fires on changes; if the sentinel is still in view
      // after appending a page, re-observe so the next page loads too.
      void nextTick(() => {
        if (!observer || !hasMore.value || sentinel.value !== element) return
        observer.unobserve(element)
        observer.observe(element)
      })
    }, { rootMargin: options.rootMargin ?? '600px 0px' })
    observer.observe(element)
  }

  watch(sentinel, (element) => {
    if (element) {
      connect(element)
    } else {
      disconnect()
    }
  }, { flush: 'post' })

  if (getCurrentInstance()) {
    onBeforeUnmount(disconnect)
  }

  return {
    sentinel,
    limit,
    total,
    visibleItems,
    hasMore,
    loadMore,
    loadAll,
    reset,
    ensureIndexVisible
  }
}
