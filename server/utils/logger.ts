/**
 * 日志系统
 * 提供统一的日志记录、成本追踪和性能统计
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  module: string
  message: string
  data?: Record<string, unknown>
  duration?: number
  cost?: number
}

export interface CostEntry {
  timestamp: string
  module: string
  operation: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  estimatedCost: number
}

export interface PerformanceEntry {
  timestamp: string
  module: string
  operation: string
  duration: number
  success: boolean
}

// 日志存储
const logs: LogEntry[] = []
const costs: CostEntry[] = []
const performance: PerformanceEntry[] = []

// 配置
const config = {
  level: LogLevel.INFO,
  maxLogs: 1000,
  maxCosts: 500,
  maxPerformance: 500
}

/**
 * 日志记录器
 */
export const logger = {
  debug(module: string, message: string, data?: Record<string, unknown>) {
    log(LogLevel.DEBUG, module, message, data)
  },

  info(module: string, message: string, data?: Record<string, unknown>) {
    log(LogLevel.INFO, module, message, data)
  },

  warn(module: string, message: string, data?: Record<string, unknown>) {
    log(LogLevel.WARN, module, message, data)
  },

  error(module: string, message: string, data?: Record<string, unknown>) {
    log(LogLevel.ERROR, module, message, data)
  },

  // 设置日志级别
  setLevel(level: LogLevel) {
    config.level = level
  },

  // 获取日志
  getLogs(options?: {
    level?: LogLevel
    module?: string
    limit?: number
  }): LogEntry[] {
    let result = [...logs]

    if (options?.level !== undefined) {
      result = result.filter(l => l.level >= options.level!)
    }
    if (options?.module) {
      result = result.filter(l => l.module === options.module)
    }

    return result.slice(-(options?.limit || 100))
  },

  // 清空日志
  clearLogs() {
    logs.length = 0
  }
}

/**
 * 记录日志
 */
function log(
  level: LogLevel,
  module: string,
  message: string,
  data?: Record<string, unknown>
) {
  if (level < config.level) return

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    data
  }

  logs.push(entry)

  // 限制日志数量
  if (logs.length > config.maxLogs) {
    logs.shift()
  }

  // 同时输出到控制台
  const levelNames = ['DEBUG', 'INFO', 'WARN', 'ERROR']
  const prefix = `[${levelNames[level]}][${module}]`
  const consoleMsg = `${prefix} ${message}`

  switch (level) {
    case LogLevel.DEBUG:
      console.debug(consoleMsg, data || '')
      break
    case LogLevel.INFO:
      console.info(consoleMsg, data || '')
      break
    case LogLevel.WARN:
      console.warn(consoleMsg, data || '')
      break
    case LogLevel.ERROR:
      console.error(consoleMsg, data || '')
      break
  }
}

/**
 * 成本追踪器
 */
export const costTracker = {
  // 记录 API 调用成本
  record(entry: Omit<CostEntry, 'timestamp'>) {
    costs.push({
      ...entry,
      timestamp: new Date().toISOString()
    })

    // 限制记录数量
    if (costs.length > config.maxCosts) {
      costs.shift()
    }

    logger.info('CostTracker', `API 调用: ${entry.operation}`, {
      model: entry.model,
      cost: entry.estimatedCost
    })
  },

  // 获取成本统计
  getStats(options?: {
    startDate?: string
    endDate?: string
    module?: string
  }): {
    totalCost: number
    breakdown: Record<string, number>
    entries: CostEntry[]
  } {
    let result = [...costs]

    if (options?.startDate) {
      result = result.filter(c => c.timestamp >= options.startDate!)
    }
    if (options?.endDate) {
      result = result.filter(c => c.timestamp <= options.endDate!)
    }
    if (options?.module) {
      result = result.filter(c => c.module === options.module)
    }

    const totalCost = result.reduce((sum, c) => sum + c.estimatedCost, 0)
    const breakdown: Record<string, number> = {}

    for (const entry of result) {
      const key = entry.model || entry.operation
      breakdown[key] = (breakdown[key] || 0) + entry.estimatedCost
    }

    return { totalCost, breakdown, entries: result }
  },

  // 清空记录
  clear() {
    costs.length = 0
  }
}

/**
 * 性能追踪器
 */
export const perfTracker = {
  // 记录操作耗时
  record(entry: Omit<PerformanceEntry, 'timestamp'>) {
    performance.push({
      ...entry,
      timestamp: new Date().toISOString()
    })

    // 限制记录数量
    if (performance.length > config.maxPerformance) {
      performance.shift()
    }
  },

  // 创建计时器
  start(module: string, operation: string): () => void {
    const startTime = Date.now()

    return (success: boolean = true) => {
      const duration = Date.now() - startTime
      this.record({ module, operation, duration, success })

      logger.debug('PerfTracker', `${operation} 完成`, {
        duration: `${duration}ms`,
        success
      })
    }
  },

  // 获取性能统计
  getStats(options?: {
    module?: string
    operation?: string
  }): {
    avgDuration: number
    maxDuration: number
    minDuration: number
    successRate: number
    totalCalls: number
  } {
    let result = [...performance]

    if (options?.module) {
      result = result.filter(p => p.module === options.module)
    }
    if (options?.operation) {
      result = result.filter(p => p.operation === options.operation)
    }

    if (result.length === 0) {
      return {
        avgDuration: 0,
        maxDuration: 0,
        minDuration: 0,
        successRate: 0,
        totalCalls: 0
      }
    }

    const durations = result.map(p => p.duration)
    const successes = result.filter(p => p.success).length

    return {
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      maxDuration: Math.max(...durations),
      minDuration: Math.min(...durations),
      successRate: successes / result.length,
      totalCalls: result.length
    }
  },

  // 清空记录
  clear() {
    performance.length = 0
  }
}

/**
 * API 成本估算 (基于 Google AI 定价)
 */
export const estimateCost = {
  // Gemini Pro 文本
  geminiText(inputTokens: number, outputTokens: number): number {
    // $0.00025/1K input, $0.0005/1K output (估算)
    return (inputTokens / 1000) * 0.00025 + (outputTokens / 1000) * 0.0005
  },

  // Gemini Pro 图片
  geminiImage(): number {
    // $0.0025/image (估算)
    return 0.0025
  },

  // Veo 视频
  veoVideo(durationSeconds: number, resolution: '480p' | '720p' | '1080p' = '1080p'): number {
    // $0.03/秒 480p, $0.05/秒 720p, $0.08/秒 1080p (估算)
    if (resolution === '1080p') return durationSeconds * 0.08
    if (resolution === '720p') return durationSeconds * 0.05
    return durationSeconds * 0.03
  },

  // TTS 音频
  ttsAudio(characters: number): number {
    // $0.000015/字符 (估算)
    return characters * 0.000015
  }
}
