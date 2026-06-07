/**
 * 性能监控模块
 * 提供操作计时、内存监控和性能指标收集
 *
 * 支持 TraceContext 集成，所有性能指标可关联到链路追踪。
 */

import { promises as fs } from "node:fs"
import * as path from "node:path"
import type { TraceContext } from "./trace-context.js"

/**
 * 性能指标
 */
export interface PerformanceMetric {
  name: string
  duration: number
  timestamp: string
  success: boolean
  metadata?: Record<string, unknown>
  traceId?: string
  spanId?: string
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
 * 持久化配置
 */
export interface PersistenceConfig {
  /** 是否启用自动保存 */
  enabled: boolean
  /** 保存目录路径 */
  directory: string
  /** 自动保存间隔（毫秒），0 表示立即保存 */
  intervalMs?: number
}

/**
 * 性能监控器
 */
export class PerformanceMonitor {
  private metrics: PerformanceMetric[] = []
  private memorySnapshots: MemorySnapshot[] = []
  private readonly maxMetrics: number
  private readonly maxSnapshots: number
  private readonly persistence: PersistenceConfig | undefined
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private pendingSave = false

  constructor(options?: {
    maxMetrics?: number
    maxSnapshots?: number
    persistence?: PersistenceConfig
  }) {
    this.maxMetrics = options?.maxMetrics ?? 1000
    this.maxSnapshots = options?.maxSnapshots ?? 100
    this.persistence = options?.persistence
  }

  /**
   * 记录性能指标
   */
  record(metric: Omit<PerformanceMetric, "timestamp"> & { traceId?: string; spanId?: string }): void {
    this.metrics.push({
      ...metric,
      timestamp: new Date().toISOString(),
    })

    // 保持最大数量限制
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics)
    }

    this.scheduleSave()
  }

  /**
   * 测量异步操作性能
   *
   * @param traceContext 可选的 TraceContext，注入后指标自动携带 traceId/spanId
   */
  async measure<T>(
    name: string,
    operation: () => Promise<T>,
    metadata?: Record<string, unknown>,
    traceContext?: TraceContext,
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
      this.record({
        name,
        duration,
        success,
        metadata,
        traceId: traceContext?.traceId,
        spanId: traceContext?.spanId,
      })
    }
  }

  /**
   * 测量同步操作性能
   *
   * @param traceContext 可选的 TraceContext，注入后指标自动携带 traceId/spanId
   */
  measureSync<T>(
    name: string,
    operation: () => T,
    metadata?: Record<string, unknown>,
    traceContext?: TraceContext,
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
      this.record({
        name,
        duration,
        success,
        metadata,
        traceId: traceContext?.traceId,
        spanId: traceContext?.spanId,
      })
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

    this.scheduleSave()
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
   * 调度自动保存
   */
  private scheduleSave(): void {
    if (!this.persistence?.enabled) return

    const intervalMs = this.persistence.intervalMs ?? 0

    if (intervalMs === 0) {
      // 立即保存（异步）
      this.performSave()
      return
    }

    // 防抖保存
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }

    this.pendingSave = true
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.pendingSave = false
      this.performSave()
    }, intervalMs)
  }

  /**
   * 执行保存操作
   */
  private async performSave(): Promise<void> {
    if (!this.persistence?.enabled) return

    try {
      await this.saveToDirectory(this.persistence.directory)
    } catch (error) {
      // 保存失败不应影响主流程
      console.error("[PerformanceMonitor] Failed to save metrics:", error)
    }
  }

  /**
   * 保存指标到指定目录
   */
  async saveToDirectory(directory: string): Promise<void> {
    await fs.mkdir(directory, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")

    // 保存性能指标
    if (this.metrics.length > 0) {
      const metricsFile = path.join(directory, `metrics-${timestamp}.jsonl`)
      await this.writeJSONL(metricsFile, this.metrics)
    }

    // 保存内存快照
    if (this.memorySnapshots.length > 0) {
      const memoryFile = path.join(directory, `memory-${timestamp}.jsonl`)
      await this.writeJSONL(memoryFile, this.memorySnapshots)
    }
  }

  /**
   * 导出为 JSONL 格式
   */
  async exportJSONL(filePath: string): Promise<void> {
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const data = {
      exportedAt: new Date().toISOString(),
      metrics: this.metrics,
      memorySnapshots: this.memorySnapshots,
      stats: this.getStats(),
    }

    await fs.writeFile(filePath, JSON.stringify(data) + "\n", "utf-8")
  }

  /**
   * 写入 JSONL 文件
   */
  private async writeJSONL(filePath: string, records: unknown[]): Promise<void> {
    const lines = records.map(record => JSON.stringify(record)).join("\n") + "\n"
    await fs.writeFile(filePath, lines, "utf-8")
  }

  /**
   * 立即刷新待保存的数据
   */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }

    if (this.pendingSave) {
      this.pendingSave = false
      await this.performSave()
    }
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
 * 初始化全局性能监控器（带配置）
 */
export function initGlobalMonitor(options?: {
  maxMetrics?: number
  maxSnapshots?: number
  persistence?: PersistenceConfig
}): PerformanceMonitor {
  globalMonitor = new PerformanceMonitor(options)
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
