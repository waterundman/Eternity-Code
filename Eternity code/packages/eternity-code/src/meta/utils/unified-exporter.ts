/**
 * UnifiedExporter - 统一数据导出器
 *
 * 关联 Logger、PerformanceMonitor、HandoffTrace、ProvenanceTracker 的数据，
 * 提供基于 traceId 的统一查询和 JSONL 格式导出。
 *
 * 设计目标：
 * - 通过 traceId 关联一次执行的完整上下文
 * - 支持跨模块数据溯源
 * - 提供高效的查询和导出能力
 *
 * @see arXiv:2606.04799 - 统一可观测性框架
 */

import { promises as fs } from "node:fs"
import * as path from "node:path"
import type { TraceContext } from "./trace-context.js"
import type { PerformanceMetric } from "./performance.js"
import type { HandoffTraceEntry } from "../agents/handoff.js"
import type { ProvenanceEntry } from "../types.js"

// ─── 统一记录类型 ───

/**
 * 统一记录类型枚举
 */
export type UnifiedRecordType =
  | "log"
  | "performance"
  | "handoff"
  | "provenance"
  | "system"

/**
 * 统一记录基础接口
 */
export interface UnifiedRecordBase {
  /** 统一追踪 ID */
  readonly traceId: string
  /** 记录类型 */
  readonly type: UnifiedRecordType
  /** 记录时间戳 */
  readonly timestamp: string
  /** 记录 ID */
  readonly recordId: string
}

/**
 * 日志记录
 */
export interface LogRecord extends UnifiedRecordBase {
  readonly type: "log"
  readonly level: "debug" | "info" | "warn" | "error"
  readonly module: string
  readonly message: string
  readonly data?: unknown
  readonly spanId?: string
}

/**
 * 性能记录
 */
export interface PerformanceRecord extends UnifiedRecordBase {
  readonly type: "performance"
  readonly metric: PerformanceMetric
  readonly spanId?: string
}

/**
 * Handoff 记录
 */
export interface HandoffRecord extends UnifiedRecordBase {
  readonly type: "handoff"
  readonly entry: HandoffTraceEntry
}

/**
 * Provenance 记录
 */
export interface ProvenanceRecord extends UnifiedRecordBase {
  readonly type: "provenance"
  readonly entry: ProvenanceEntry
}

/**
 * 系统记录
 */
export interface SystemRecord extends UnifiedRecordBase {
  readonly type: "system"
  readonly event: string
  readonly details: Record<string, unknown>
}

/**
 * 统一记录联合类型
 */
export type UnifiedRecord =
  | LogRecord
  | PerformanceRecord
  | HandoffRecord
  | ProvenanceRecord
  | SystemRecord

/**
 * 创建记录的输入类型（不含 recordId）
 */
export type CreateUnifiedRecord =
  | Omit<LogRecord, "recordId">
  | Omit<PerformanceRecord, "recordId">
  | Omit<HandoffRecord, "recordId">
  | Omit<ProvenanceRecord, "recordId">
  | Omit<SystemRecord, "recordId">

// ─── 查询接口 ───

/**
 * 查询过滤器
 */
export interface UnifiedQueryFilter {
  /** 按 traceId 过滤 */
  traceId?: string
  /** 按记录类型过滤 */
  type?: UnifiedRecordType | UnifiedRecordType[]
  /** 按时间范围过滤 */
  timeRange?: {
    start?: string
    end?: string
  }
  /** 按模块过滤（仅对日志有效） */
  module?: string
  /** 按代理 ID 过滤（仅对 provenance 有效） */
  agentId?: string
  /** 按任务 ID 过滤（仅对 provenance 有效） */
  taskId?: string
}

/**
 * 查询结果
 */
export interface UnifiedQueryResult {
  /** 匹配的记录 */
  records: UnifiedRecord[]
  /** 总记录数 */
  total: number
  /** 查询耗时（毫秒） */
  duration: number
}

// ─── 导出配置 ───

/**
 * 导出配置
 */
export interface UnifiedExporterConfig {
  /** 最大记录数（内存中保留） */
  maxRecords?: number
  /** 是否启用自动持久化 */
  enablePersistence?: boolean
  /** 持久化目录 */
  persistenceDirectory?: string
  /** 持久化间隔（毫秒），0 表示立即 */
  persistenceIntervalMs?: number
}

// ─── 核心实现 ───

/**
 * 统一数据导出器
 *
 * 关联 Logger、PerformanceMonitor、HandoffTrace、ProvenanceTracker 的数据，
 * 提供基于 traceId 的统一查询和 JSONL 格式导出。
 */
export class UnifiedExporter {
  private records: UnifiedRecord[] = []
  private readonly maxRecords: number
  private readonly enablePersistence: boolean
  private readonly persistenceDirectory: string | undefined
  private readonly persistenceIntervalMs: number
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private pendingSave = false
  private recordCounter = 0

  constructor(config?: UnifiedExporterConfig) {
    this.maxRecords = config?.maxRecords ?? 10000
    this.enablePersistence = config?.enablePersistence ?? false
    this.persistenceDirectory = config?.persistenceDirectory
    this.persistenceIntervalMs = config?.persistenceIntervalMs ?? 0
  }

  /**
   * 生成记录 ID
   */
  private generateRecordId(): string {
    this.recordCounter++
    return `ur-${Date.now()}-${this.recordCounter.toString(36)}`
  }

  /**
   * 添加统一记录
   */
  addRecord(record: CreateUnifiedRecord): UnifiedRecord {
    const fullRecord: UnifiedRecord = {
      ...record,
      recordId: this.generateRecordId(),
    } as UnifiedRecord

    this.records.push(fullRecord)

    // 保持最大数量限制
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords)
    }

    this.scheduleSave()

    return fullRecord
  }

  /**
   * 记录日志
   */
  addLog(
    traceId: string,
    level: "debug" | "info" | "warn" | "error",
    module: string,
    message: string,
    data?: unknown,
    spanId?: string,
  ): LogRecord {
    return this.addRecord({
      traceId,
      type: "log",
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      data,
      spanId,
    }) as LogRecord
  }

  /**
   * 记录性能指标
   */
  addPerformanceMetric(
    traceId: string,
    metric: PerformanceMetric,
    spanId?: string,
  ): PerformanceRecord {
    return this.addRecord({
      traceId,
      type: "performance",
      timestamp: metric.timestamp,
      metric,
      spanId,
    }) as PerformanceRecord
  }

  /**
   * 记录 Handoff 事件
   */
  addHandoffEntry(
    traceId: string,
    entry: HandoffTraceEntry,
  ): HandoffRecord {
    return this.addRecord({
      traceId,
      type: "handoff",
      timestamp: entry.timestamp,
      entry,
    }) as HandoffRecord
  }

  /**
   * 记录 Provenance 条目
   */
  addProvenanceEntry(
    traceId: string,
    entry: ProvenanceEntry,
  ): ProvenanceRecord {
    return this.addRecord({
      traceId,
      type: "provenance",
      timestamp: entry.createdAt,
      entry,
    }) as ProvenanceRecord
  }

  /**
   * 记录系统事件
   */
  addSystemEvent(
    traceId: string,
    event: string,
    details: Record<string, unknown>,
  ): SystemRecord {
    return this.addRecord({
      traceId,
      type: "system",
      timestamp: new Date().toISOString(),
      event,
      details,
    }) as SystemRecord
  }

  /**
   * 查询记录
   */
  query(filter: UnifiedQueryFilter): UnifiedQueryResult {
    const startTime = performance.now()
    let filtered = [...this.records]

    // 按 traceId 过滤
    if (filter.traceId) {
      filtered = filtered.filter(record => record.traceId === filter.traceId)
    }

    // 按类型过滤
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type]
      filtered = filtered.filter(record => types.includes(record.type))
    }

    // 按时间范围过滤
    if (filter.timeRange) {
      const start = filter.timeRange.start ? new Date(filter.timeRange.start).getTime() : 0
      const end = filter.timeRange.end ? new Date(filter.timeRange.end).getTime() : Infinity

      filtered = filtered.filter(record => {
        const recordTime = new Date(record.timestamp).getTime()
        return recordTime >= start && recordTime <= end
      })
    }

    // 按模块过滤（仅对日志有效）
    if (filter.module) {
      filtered = filtered.filter(record => {
        if (record.type === "log") {
          return (record as LogRecord).module === filter.module
        }
        return false
      })
    }

    // 按代理 ID 过滤（仅对 provenance 有效）
    if (filter.agentId) {
      filtered = filtered.filter(record => {
        if (record.type === "provenance") {
          return (record as ProvenanceRecord).entry.agentId === filter.agentId
        }
        return false
      })
    }

    // 按任务 ID 过滤（仅对 provenance 有效）
    if (filter.taskId) {
      filtered = filtered.filter(record => {
        if (record.type === "provenance") {
          return (record as ProvenanceRecord).entry.taskId === filter.taskId
        }
        return false
      })
    }

    const duration = performance.now() - startTime

    return {
      records: filtered,
      total: filtered.length,
      duration,
    }
  }

  /**
   * 通过 traceId 查询完整上下文
   */
  queryByTraceId(traceId: string): UnifiedQueryResult {
    return this.query({ traceId })
  }

  /**
   * 获取所有记录
   */
  getAllRecords(): UnifiedRecord[] {
    return [...this.records]
  }

  /**
   * 获取记录统计
   */
  getStats(): {
    total: number
    byType: Record<UnifiedRecordType, number>
    traceIds: string[]
  } {
    const byType: Record<UnifiedRecordType, number> = {
      log: 0,
      performance: 0,
      handoff: 0,
      provenance: 0,
      system: 0,
    }

    const traceIdSet = new Set<string>()

    for (const record of this.records) {
      byType[record.type]++
      traceIdSet.add(record.traceId)
    }

    return {
      total: this.records.length,
      byType,
      traceIds: Array.from(traceIdSet),
    }
  }

  /**
   * 清除所有记录
   */
  clear(): void {
    this.records = []
    this.recordCounter = 0
  }

  /**
   * 导出为 JSONL 格式
   */
  async exportJSONL(filePath: string): Promise<void> {
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const lines = this.records.map(record => JSON.stringify(record)).join("\n") + "\n"
    await fs.writeFile(filePath, lines, "utf-8")
  }

  /**
   * 导出指定 traceId 的记录为 JSONL
   */
  async exportTraceJSONL(traceId: string, filePath: string): Promise<void> {
    const result = this.queryByTraceId(traceId)
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const lines = result.records.map(record => JSON.stringify(record)).join("\n") + "\n"
    await fs.writeFile(filePath, lines, "utf-8")
  }

  /**
   * 持久化到配置目录
   */
  async persist(): Promise<void> {
    if (!this.enablePersistence || !this.persistenceDirectory) return

    try {
      await fs.mkdir(this.persistenceDirectory, { recursive: true })

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      const filePath = path.join(this.persistenceDirectory, `unified-${timestamp}.jsonl`)

      await this.exportJSONL(filePath)
    } catch (error) {
      console.error("[UnifiedExporter] Failed to persist records:", error)
    }
  }

  /**
   * 调度自动保存
   */
  private scheduleSave(): void {
    if (!this.enablePersistence) return

    const intervalMs = this.persistenceIntervalMs

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
    if (!this.enablePersistence) return

    try {
      await this.persist()
    } catch (error) {
      console.error("[UnifiedExporter] Failed to save records:", error)
    }
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
}

// ─── 全局实例 ───

let globalExporter: UnifiedExporter | null = null

/**
 * 获取全局 UnifiedExporter 实例
 */
export function getGlobalExporter(): UnifiedExporter {
  if (!globalExporter) {
    globalExporter = new UnifiedExporter()
  }
  return globalExporter
}

/**
 * 初始化全局 UnifiedExporter
 */
export function initGlobalExporter(config?: UnifiedExporterConfig): UnifiedExporter {
  globalExporter = new UnifiedExporter(config)
  return globalExporter
}

/**
 * 设置全局 UnifiedExporter
 */
export function setGlobalExporter(exporter: UnifiedExporter): void {
  globalExporter = exporter
}

// ─── 工具函数 ───

/**
 * 从 TraceContext 创建查询过滤器
 */
export function createFilterFromTraceContext(context: TraceContext): UnifiedQueryFilter {
  return {
    traceId: context.traceId,
  }
}

/**
 * 合并多个查询结果
 */
export function mergeQueryResults(...results: UnifiedQueryResult[]): UnifiedQueryResult {
  const allRecords: UnifiedRecord[] = []
  let totalDuration = 0

  for (const result of results) {
    allRecords.push(...result.records)
    totalDuration += result.duration
  }

  // 按时间戳排序
  allRecords.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  return {
    records: allRecords,
    total: allRecords.length,
    duration: totalDuration,
  }
}