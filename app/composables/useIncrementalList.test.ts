import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { useIncrementalList } from './useIncrementalList'

describe('useIncrementalList', () => {
  it('renders items page by page', () => {
    const items = ref(Array.from({ length: 50 }, (_, index) => index))
    const list = useIncrementalList(() => items.value, { pageSize: 20 })

    expect(list.visibleItems.value).toHaveLength(20)
    expect(list.hasMore.value).toBe(true)

    list.loadMore()
    expect(list.visibleItems.value).toHaveLength(40)

    list.loadMore()
    expect(list.visibleItems.value).toHaveLength(50)
    expect(list.hasMore.value).toBe(false)
  })

  it('resets to the first page when the reset key changes', async () => {
    const items = ref(Array.from({ length: 50 }, (_, index) => index))
    const keyword = ref('')
    const list = useIncrementalList(() => items.value, { pageSize: 10, resetKey: () => keyword.value })

    list.loadMore()
    expect(list.limit.value).toBe(20)

    keyword.value = 'a'
    await nextTick()
    expect(list.limit.value).toBe(10)
  })

  it('expands to include a requested index', () => {
    const items = ref(Array.from({ length: 100 }, (_, index) => index))
    const list = useIncrementalList(() => items.value, { pageSize: 24 })

    list.ensureIndexVisible(30)
    expect(list.limit.value).toBe(48)
    expect(list.visibleItems.value).toContain(30)

    list.loadAll()
    expect(list.visibleItems.value).toHaveLength(100)
  })

  it('reveals a few newly appended items but not bulk loads', async () => {
    const items = ref<string[]>([])
    const list = useIncrementalList(() => items.value, { pageSize: 10, getKey: item => item })

    items.value = Array.from({ length: 50 }, (_, index) => `item_${index}`)
    await nextTick()
    expect(list.limit.value).toBe(10)

    items.value = [...items.value, 'added']
    await nextTick()
    expect(list.visibleItems.value).toContain('added')
  })
})
