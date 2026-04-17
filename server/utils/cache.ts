/**
 * 缓存工具
 * 提供内存缓存和结果缓存功能
 */

export interface CacheEntry<T> {
  value: T
  expiresAt: number
  createdAt: number
}

export interface CacheOptions {
  /** 过期时间（毫秒），默认 5 分钟 */
  ttl?: number
  /** 最大缓存数量，默认 100 */
  maxSize?: number
}

const DEFAULT_TTL = 5 * 60 * 1000 // 5 分钟
const DEFAULT_MAX_SIZE = 100

/**
 * 创建内存缓存
 */
export function createCache<T>(options: CacheOptions = {}) {
  const cache = new Map<string, CacheEntry<T>>()
  const ttl = options.ttl ?? DEFAULT_TTL
  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE

  return {
    /**
     * 获取缓存
     */
    get(key: string): T | undefined {
      const entry = cache.get(key)
      if (!entry) return undefined

      // 检查是否过期
      if (Date.now() > entry.expiresAt) {
        cache.delete(key)
        return undefined
      }

      return entry.value
    },

    /**
     * 设置缓存
     */
    set(key: string, value: T, customTtl?: number): void {
      // 检查容量
      if (cache.size >= maxSize) {
        // 删除最老的条目
        const oldestKey = cache.keys().next().value
        if (oldestKey) cache.delete(oldestKey)
      }

      cache.set(key, {
        value,
        expiresAt: Date.now() + (customTtl ?? ttl),
        createdAt: Date.now()
      })
    },

    /**
     * 检查是否存在
     */
    has(key: string): boolean {
      const entry = cache.get(key)
      if (!entry) return false
      if (Date.now() > entry.expiresAt) {
        cache.delete(key)
        return false
      }
      return true
    },

    /**
     * 删除缓存
     */
    delete(key: string): boolean {
      return cache.delete(key)
    },

    /**
     * 清空缓存
     */
    clear(): void {
      cache.clear()
    },

    /**
     * 获取缓存大小
     */
    size(): number {
      return cache.size
    },

    /**
     * 清理过期条目
     */
    cleanup(): number {
      let cleaned = 0
      const now = Date.now()
      for (const [key, entry] of cache.entries()) {
        if (now > entry.expiresAt) {
          cache.delete(key)
          cleaned++
        }
      }
      return cleaned
    },

    /**
     * 获取或设置（如果不存在则调用 factory 创建）
     */
    async getOrSet(
      key: string,
      factory: () => Promise<T>,
      customTtl?: number
    ): Promise<T> {
      const cached = this.get(key)
      if (cached !== undefined) return cached

      const value = await factory()
      this.set(key, value, customTtl)
      return value
    }
  }
}

// ==================== 全局缓存实例 ====================

/** 角色资产缓存（1小时） */
export const characterCache = createCache<{
  avatar: string
  expressions: Array<{ emotion: string, imageData: string }>
}>({
  ttl: 60 * 60 * 1000,
  maxSize: 50
})

/** 视频生成结果缓存（1小时） */
export const videoCache = createCache<{
  videoData: string
  metadata: Record<string, unknown>
}>({
  ttl: 60 * 60 * 1000,
  maxSize: 50
})

/** 剧本解析缓存（10分钟） */
export const scriptCache = createCache<{
  scenes: unknown[]
  characters: unknown[]
}>({
  ttl: 10 * 60 * 1000,
  maxSize: 20
})

/**
 * 生成缓存键
 */
export function generateCacheKey(prefix: string, ...parts: (string | number | object)[]): string {
  const normalized = parts.map((p) => {
    if (typeof p === 'object') return JSON.stringify(p)
    return String(p)
  })
  return `${prefix}:${normalized.join(':')}`
}

/**
 * 定期清理所有缓存
 */
export function startCacheCleanup(intervalMs: number = 60000): () => void {
  const timer = setInterval(() => {
    characterCache.cleanup()
    videoCache.cleanup()
    scriptCache.cleanup()
  }, intervalMs)

  return () => clearInterval(timer)
}
