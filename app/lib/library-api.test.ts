import { describe, expect, it, vi } from 'vitest'
import { listAllLibraryAssets, perceptualHashDistance } from './library-api'

describe('perceptualHashDistance', () => {
  it('returns zero for identical hashes', () => {
    expect(perceptualHashDistance('0123456789abcdef', '0123456789abcdef')).toBe(0)
  })

  it('counts changed image hash bits', () => {
    expect(perceptualHashDistance('0000', '0001')).toBe(1)
    expect(perceptualHashDistance('0000', '000f')).toBe(4)
  })

  it('rejects missing or incompatible hashes', () => {
    expect(perceptualHashDistance(undefined, '0000')).toBeUndefined()
    expect(perceptualHashDistance('0000', '00000000')).toBeUndefined()
  })
})

describe('listAllLibraryAssets', () => {
  it('loads every page instead of truncating the library at 200 assets', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { items: Array.from({ length: 200 }, (_, index) => ({ id: `asset_${index}` })), total: 201, page: 1, pageSize: 200 } })
      .mockResolvedValueOnce({ success: true, data: { items: [{ id: 'asset_200' }], total: 201, page: 2, pageSize: 200 } })
    const globals = globalThis as typeof globalThis & { $fetch?: unknown }
    const originalFetch = globals.$fetch
    Object.assign(globals, { $fetch: fetchMock })
    try {
      const items = await listAllLibraryAssets({ includeDeleted: true })

      expect(items).toHaveLength(201)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenLastCalledWith('/api/library/assets', {
        query: { includeDeleted: true, page: 2, pageSize: 200 }
      })
    } finally {
      Object.assign(globals, { $fetch: originalFetch })
    }
  })
})
