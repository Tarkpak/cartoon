/**
 * 并发控制工具
 * 用于限制对外部 API（如 Gemini）的并发请求数量
 */

export interface ConcurrencyLimiterOptions {
  /** 最大并发数 */
  maxConcurrency: number
  /** 队列最大长度（超过则拒绝新请求） */
  maxQueueSize?: number
  /** 任务超时时间（毫秒） */
  timeout?: number
}

interface QueuedTask<T> {
  task: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
  addedAt: number
}

/**
 * 并发限制器
 * 使用令牌桶算法控制并发请求数量
 */
export class ConcurrencyLimiter {
  private readonly maxConcurrency: number
  private readonly maxQueueSize: number
  private readonly timeout: number
  private currentRunning: number = 0
  private queue: QueuedTask<unknown>[] = []

  // 统计信息
  private stats = {
    totalExecuted: 0,
    totalQueued: 0,
    totalRejected: 0,
    totalTimeout: 0
  }

  constructor(options: ConcurrencyLimiterOptions) {
    this.maxConcurrency = options.maxConcurrency
    this.maxQueueSize = options.maxQueueSize ?? 100
    this.timeout = options.timeout ?? 60000 // 默认 60 秒超时
  }

  /**
   * 获取当前统计信息
   */
  getStats() {
    return {
      ...this.stats,
      currentRunning: this.currentRunning,
      queueLength: this.queue.length,
      maxConcurrency: this.maxConcurrency
    }
  }

  /**
   * 执行任务（带并发控制）
   */
  async execute<T>(task: () => Promise<T>): Promise<T> {
    // 检查队列是否已满
    if (this.queue.length >= this.maxQueueSize) {
      this.stats.totalRejected++
      throw new Error(`并发队列已满（当前队列: ${this.queue.length}，最大: ${this.maxQueueSize}）`)
    }

    // 如果有空闲槽位，直接执行
    if (this.currentRunning < this.maxConcurrency) {
      return this.runTask(task)
    }

    // 否则加入队列等待
    return new Promise<T>((resolve, reject) => {
      const queuedTask: QueuedTask<T> = {
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
        addedAt: Date.now()
      }
      this.queue.push(queuedTask as QueuedTask<unknown>)
      this.stats.totalQueued++

      // 设置超时
      if (this.timeout > 0) {
        setTimeout(() => {
          const index = this.queue.findIndex(t => t === queuedTask)
          if (index !== -1) {
            this.queue.splice(index, 1)
            this.stats.totalTimeout++
            reject(new Error(`任务等待超时（超时: ${this.timeout}ms）`))
          }
        }, this.timeout)
      }
    })
  }

  /**
   * 执行任务
   */
  private async runTask<T>(task: () => Promise<T>): Promise<T> {
    this.currentRunning++
    this.stats.totalExecuted++

    try {
      const result = await task()
      return result
    } finally {
      this.currentRunning--
      this.processQueue()
    }
  }

  /**
   * 处理队列中的任务
   */
  private processQueue(): void {
    while (this.currentRunning < this.maxConcurrency && this.queue.length > 0) {
      const queuedTask = this.queue.shift()
      if (queuedTask) {
        this.runTask(queuedTask.task)
          .then(queuedTask.resolve)
          .catch(queuedTask.reject)
      }
    }
  }

  /**
   * 清空队列
   */
  clear(): void {
    const error = new Error('队列已清空')
    for (const task of this.queue) {
      task.reject(error)
    }
    this.queue = []
  }
}

// ============================================================
// 预配置的限制器实例
// ============================================================

/**
 * Gemini API 并发限制器
 * 限制对 Gemini API 的并发请求数量
 */
export const geminiLimiter = new ConcurrencyLimiter({
  maxConcurrency: 5, // Gemini API 建议的并发数
  maxQueueSize: 50,
  timeout: 120000 // 2分钟超时（图片/视频生成可能较慢）
})

/**
 * 视频生成并发限制器
 * 视频生成较慢，限制较低的并发数
 */
export const videoLimiter = new ConcurrencyLimiter({
  maxConcurrency: 2,
  maxQueueSize: 20,
  timeout: 300000 // 5分钟超时
})

/**
 * 图片生成并发限制器
 */
export const imageLimiter = new ConcurrencyLimiter({
  maxConcurrency: 3,
  maxQueueSize: 30,
  timeout: 120000 // 2分钟超时
})

// ============================================================
// 批量执行工具
// ============================================================

export interface BatchExecuteOptions<T, R> {
  /** 要处理的项目列表 */
  items: T[]
  /** 处理单个项目的函数 */
  processor: (item: T, index: number) => Promise<R>
  /** 并发限制器 */
  limiter?: ConcurrencyLimiter
  /** 最大并发数（如果不使用限制器） */
  maxConcurrency?: number
  /** 进度回调 */
  onProgress?: (completed: number, total: number, result: R | null, error: Error | null) => void
  /** 是否在出错时继续 */
  continueOnError?: boolean
}

export interface BatchResult<R> {
  results: (R | null)[]
  errors: (Error | null)[]
  successCount: number
  errorCount: number
}

/**
 * 批量执行任务（带并发控制）
 */
export async function batchExecute<T, R>(
  options: BatchExecuteOptions<T, R>
): Promise<BatchResult<R>> {
  const {
    items,
    processor,
    limiter,
    maxConcurrency = 5,
    onProgress,
    continueOnError = true
  } = options

  const results: (R | null)[] = new Array(items.length).fill(null)
  const errors: (Error | null)[] = new Array(items.length).fill(null)
  let completed = 0
  let successCount = 0
  let errorCount = 0

  // 使用限制器或创建简单的并发控制
  const effectiveLimiter = limiter ?? new ConcurrencyLimiter({
    maxConcurrency,
    maxQueueSize: items.length + 10
  })

  const promises = items.map(async (item, index) => {
    try {
      const result = await effectiveLimiter.execute(() => processor(item, index))
      results[index] = result
      successCount++
      onProgress?.(++completed, items.length, result, null)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      errors[index] = err
      errorCount++
      onProgress?.(++completed, items.length, null, err)

      if (!continueOnError) {
        throw err
      }
    }
  })

  await Promise.all(promises)

  return { results, errors, successCount, errorCount }
}

/**
 * 串行执行任务（一个接一个）
 */
export async function serialExecute<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number, result: R) => void
): Promise<R[]> {
  const results: R[] = []

  for (let i = 0; i < items.length; i++) {
    const result = await processor(items[i]!, i)
    results.push(result)
    onProgress?.(i + 1, items.length, result)
  }

  return results
}
