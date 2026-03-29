/**
 * 性能监控模块
 * 提供操作计时、内存监控和性能指标收集
 */

/**
 * 性能指标
 */
export interface PerformanceMetric {
  name: string
  duration: number
  timestamp: string
  success: boolean
  metadata?: Record<string, unknown>
}

/**
 * 内存快照
 */
export interface MemorySnapshot {
  timestamp: string
  heapUsed: number
  heapTotal: number
  external: number
  rss: number
}

/**
 * 性能统计
 */
export interface PerformanceStats {
  name: string
  count: number
  totalDuration: number
  avgDuration: number
  minDuration: number
  maxDuration: number
  successRate: number
  p50: number
  p95: number
  p99: number
}

/**
 * 性能监控器
 */
export class PerformanceMonitor {
  private metrics: PerformanceMetric[] = []
  private memorySnapshots: MemorySnapshot[] = []
  private readonly maxMetrics: number
  private readonly maxSnapshots: number

  constructor(options?: { maxMetrics?: number; maxSnapshots?: number }) {
    this.maxMetrics = options?.maxMetrics ?? 1000
    this.maxSnapshots = options?.maxSnapshots ?? 100
  }

  /**
   * 记录性能指标
   */
  record(metric: Omit<PerformanceMetric, "timestamp">): void {
    this.metrics.push({
      ...metric,
      timestamp: new Date().toISOString(),
    })

    // 保持最大数量限制
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics)
    }
  }

  /**
   * 测量异步操作性能
   */
  async measure<T>(
    name: string,
    operation: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const start = performance.now()
    let success = true

    try {
      const result = await operation()
      return result
    } catch (error) {
      success = false
      throw error
    } finally {
      const duration = performance.now() - start
      this.record({ name, duration, success, metadata })
    }
  }

  /**
   * 测量同步操作性能
   */
  measureSync<T>(
    name: string,
    operation: () => T,
    metadata?: Record<string, unknown>
  ): T {
    const start = performance.now()
    let success = true

    try {
      const result = operation()
      return result
    } catch (error) {
      success = false
      throw error
    } finally {
      const duration = performance.now() - start
      this.record({ name, duration, success, metadata })
    }
  }

  /**
   * 创建性能计时器
   */
  startTimer(name: string, metadata?: Record<string, unknown>): () => void {
    const start = performance.now()
    let stopped = false

    return () => {
      if (stopped) return
      stopped = true

      const duration = performance.now() - start
      this.record({ name, duration, success: true, metadata })
    }
  }

  /**
   * 捕获内存快照
   */
  captureMemory(): MemorySnapshot {
    const memUsage = process.memoryUsage()
    const snapshot: MemorySnapshot = {
      timestamp: new Date().toISOString(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
    }

    this.memorySnapshots.push(snapshot)

    // 保持最大数量限制
    if (this.memorySnapshots.length > this.maxSnapshots) {
      this.memorySnapshots = this.memorySnapshots.slice(-this.maxSnapshots)
    }

    return snapshot
  }

  /**
   * 获取性能统计
   */
  getStats(name?: string): PerformanceStats[] {
    const grouped = new Map<string, PerformanceMetric[]>()

    for (const metric of this.metrics) {
      if (name && metric.name !== name) continue

      const group = grouped.get(metric.name) ?? []
      group.push(metric)
      grouped.set(metric.name, group)
    }

    return Array.from(grouped.entries()).map(([metricName, metrics]) => {
      const durations = metrics.map(m => m.duration).sort((a, b) => a - b)
      const successCount = metrics.filter(m => m.success).length

      return {
        name: metricName,
        count: metrics.length,
        totalDuration: durations.reduce((a, b) => a + b, 0),
        avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
        minDuration: durations[0] ?? 0,
        maxDuration: durations[durations.length - 1] ?? 0,
        successRate: successCount / metrics.length,
        p50: this.percentile(durations, 0.5),
        p95: this.percentile(durations, 0.95),
        p99: this.percentile(durations, 0.99),
      }
    })
  }

  /**
   * 获取最近的指标
   */
  getRecentMetrics(count: number = 10, name?: string): PerformanceMetric[] {
    const filtered = name
      ? this.metrics.filter(m => m.name === name)
      : this.metrics
    return filtered.slice(-count)
  }

  /**
   * 获取内存快照历史
   */
  getMemoryHistory(count?: number): MemorySnapshot[] {
    return count
      ? this.memorySnapshots.slice(-count)
      : this.memorySnapshots
  }

  /**
   * 获取内存增长趋势
   */
  getMemoryTrend(): { growing: boolean; ratePerMinute: number } {
    if (this.memorySnapshots.length < 2) {
      return { growing: false, ratePerMinute: 0 }
    }

    const recent = this.memorySnapshots.slice(-10)
    const first = recent[0]
    const last = recent[recent.length - 1]

    const timeDiff = new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()
    const memDiff = last.heapUsed - first.heapUsed

    if (timeDiff === 0) {
      return { growing: false, ratePerMinute: 0 }
    }

    const ratePerMinute = (memDiff / timeDiff) * 60000

    return {
      growing: ratePerMinute > 1024 * 1024, // 超过 1MB/分钟认为是增长
      ratePerMinute,
    }
  }

  /**
   * 清除所有指标
   */
  clear(): void {
    this.metrics = []
    this.memorySnapshots = []
  }

  /**
   * 清除指定名称的指标
   */
  clearByName(name: string): void {
    this.metrics = this.metrics.filter(m => m.name !== name)
  }

  /**
   * 导出指标为 JSON
   */
  export(): {
    metrics: PerformanceMetric[]
    memorySnapshots: MemorySnapshot[]
    stats: PerformanceStats[]
  } {
    return {
      metrics: this.metrics,
      memorySnapshots: this.memorySnapshots,
      stats: this.getStats(),
    }
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const index = Math.ceil(sorted.length * p) - 1
    return sorted[Math.max(0, index)] ?? 0
  }
}

/**
 * 全局性能监控器实例
 */
let globalMonitor: PerformanceMonitor | null = null

/**
 * 获取全局性能监控器
 */
export function getGlobalMonitor(): PerformanceMonitor {
  if (!globalMonitor) {
    globalMonitor = new PerformanceMonitor()
  }
  return globalMonitor
}

/**
 * 设置全局性能监控器
 */
export function setGlobalMonitor(monitor: PerformanceMonitor): void {
  globalMonitor = monitor
}

/**
 * 性能装饰器
 */
export function measured(
  name?: string,
  metadata?: Record<string, unknown>
) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>
    const metricName = name ?? `${(target as Record<string, unknown>).constructor?.name}.${propertyKey}`

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const monitor = getGlobalMonitor()
      return monitor.measure(
        metricName,
        () => originalMethod.apply(this, args),
        metadata
      )
    }

    return descriptor
  }
}

/**
 * 格式化内存大小
 */
export function formatMemorySize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"]
  let unitIndex = 0
  let size = bytes

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`
}

/**
 * 格式化持续时间
 */
export function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`
  if (ms < 1000) return `${ms.toFixed(2)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(2)}m`
  return `${(ms / 3600000).toFixed(2)}h`
}

/**
 * 生成性能报告
 */
export function generateReport(monitor?: PerformanceMonitor): string {
  const m = monitor ?? getGlobalMonitor()
  const stats = m.getStats()
  const memory = m.captureMemory()
  const trend = m.getMemoryTrend()

  const lines: string[] = [
    "=== Performance Report ===",
    "",
    "Memory Status:",
    `  Heap Used: ${formatMemorySize(memory.heapUsed)}`,
    `  Heap Total: ${formatMemorySize(memory.heapTotal)}`,
    `  RSS: ${formatMemorySize(memory.rss)}`,
    `  Trend: ${trend.growing ? `Growing (${formatMemorySize(trend.ratePerMinute)}/min)` : "Stable"}`,
    "",
    "Operation Stats:",
  ]

  for (const stat of stats.sort((a, b) => b.totalDuration - a.totalDuration)) {
    lines.push(`  ${stat.name}:`)
    lines.push(`    Count: ${stat.count}`)
    lines.push(`    Avg: ${formatDuration(stat.avgDuration)}`)
    lines.push(`    P95: ${formatDuration(stat.p95)}`)
    lines.push(`    P99: ${formatDuration(stat.p99)}`)
    lines.push(`    Success: ${(stat.successRate * 100).toFixed(1)}%`)
  }

  return lines.join("\n")
}
