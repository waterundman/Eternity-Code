/**
 * Meta 工具模块
 */

// 文件 I/O 工具
export {
  ensureDirectory,
  ensureDirectorySync,
  readYamlFileAsync,
  readYamlFileSync,
  writeYamlFileAtomicAsync,
  writeYamlFileSync,
  readJsonFileAsync,
  writeJsonFileAtomicAsync,
  readYamlDirectoryAsync,
  fileExistsAsync,
  getFileMtime,
  LRUCache,
  createCachedYamlReader,
} from "./file-io.js"

// 类型验证
export {
  ValidationError,
  validators,
  optional,
  nullable,
  array,
  object,
  enumValue,
  union,
  safeValidate,
  strictValidate,
  MetaDesignValidator,
  AgentTaskValidator,
  validateYamlContent,
} from "./validation.js"

// Result 类型
export { Ok, Err, isOk, isErr } from "./result.js"
export type { Result } from "./result.js"

// Schema 验证
export {
  readYamlWithValidation,
  readYamlWithValidationAsync,
  readYamlStrict,
  SchemaValidationError,
} from "./schema-validator.js"

// 错误处理
export {
  ErrorCode,
  ErrorSeverity,
  AppError,
  FileErrors,
  ParseErrors,
  GitErrors,
  AgentErrors,
  ExecutionErrors,
  WatchdogErrors,
  safeExecute,
  safeExecuteSync,
  withFallback,
  withRetry,
} from "./errors.js"

// 资源管理
export {
  ResourceManager,
  withResources,
  createDisposableTimer,
  createDisposableInterval,
  createDisposableAbortController,
  createCancellablePromise,
  withTimeout,
  debounce,
  throttle,
} from "./resource-manager.js"

// 文件锁
export {
  acquireLock,
  releaseLock,
  withFileLock,
} from "./file-lock.js"
export type { LockOptions } from "./file-lock.js"

// ID 生成器
export {
  generateCardId,
  generatePlanId,
  generateNegId,
  generateLoopId,
} from "./id-generator.js"

// 性能监控
export {
  PerformanceMonitor,
  getGlobalMonitor,
  setGlobalMonitor,
  measured,
  formatMemorySize,
  formatDuration as formatDurationMs,
  generateReport,
} from "./performance.js"

// Handoff 工具
export {
  MAX_HANDOFF_DEPTH,
  MAX_VISITS_PER_ROLE,
  createHandoffExecutor,
  validateHandoffRoute,
  isHandoffCycle,
  isHandoffDepthExceeded,
} from "./handoff.js"
export type { HandoffExecutionResult, HandoffExecutorOptions, HandoffExecutor } from "./handoff.js"

// TraceContext 工具
export {
  createTraceContext,
  createChildTraceContext,
  propagateTraceContext,
  extractTraceContext,
  withBaggage,
  createTraceContextFromHandoff,
  hasTraceContext,
} from "./trace-context.js"
export type { TraceContext, TraceContextOptions, TraceContextFields } from "./trace-context.js"

// 类型定义
export type { ValidationResult, Validator } from "./validation.js"
export type { Disposable } from "./resource-manager.js"
export type { PerformanceMetric, MemorySnapshot, PerformanceStats } from "./performance.js"

export { extractText } from "./extract-text.js"

// 日志工具
export { createLogger } from "./logger.js"
export type { Logger, LogLevel } from "./logger.js"

// 统一可观测性上下文
export { ObservabilityContext } from "./observability-context.js"

/**
 * 稳定哈希（用于参数去重，不需要密码学强度）
 */
export function stableHash(obj: unknown): string {
  try {
    if (obj === null || obj === undefined) return String(obj)
    if (typeof obj !== "object") return String(obj)
    return JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort())
  } catch {
    return String(obj)
  }
}

/**
 * 安全的 JSON 解析
 */
export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/**
 * 延迟执行
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 带超时的 Promise
 */
export function promiseWithTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message ?? `Operation timed out after ${ms}ms`))
    }, ms)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  })
}

/**
 * 生成短 UUID
 */
export function generateShortId(length: number = 8): string {
  return Math.random().toString(36).substring(2, 2 + length)
}

/**
 * 安全的字符串截断
 */
export function truncateString(str: string, maxLength: number, suffix: string = "..."): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - suffix.length) + suffix
}

/**
 * 深度合并对象
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  ...sources: Partial<T>[]
): T {
  if (!sources.length) return target

  const result = { ...target }

  for (const source of sources) {
    if (!source) continue

    for (const key of Object.keys(source) as Array<keyof T>) {
      const sourceValue = source[key]
      const targetValue = result[key]

      if (
        typeof sourceValue === "object" &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === "object" &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        ) as T[keyof T]
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue as T[keyof T]
      }
    }
  }

  return result
}

/**
 * 格式化持续时间
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`
}

// 统一数据导出
export {
  UnifiedExporter,
  getGlobalExporter,
  initGlobalExporter,
  setGlobalExporter,
  createFilterFromTraceContext,
  mergeQueryResults,
} from "./unified-exporter.js"
export type {
  UnifiedRecordType,
  UnifiedRecordBase,
  LogRecord,
  PerformanceRecord,
  HandoffRecord,
  ProvenanceRecord,
  SystemRecord,
  UnifiedRecord,
  CreateUnifiedRecord,
  UnifiedQueryFilter,
  UnifiedQueryResult,
  UnifiedExporterConfig,
} from "./unified-exporter.js"

// 语义图
export {
  SemanticGraph,
  getGlobalGraph,
  initGlobalGraph,
  setGlobalGraph,
  createEntityTypeFilter,
  createRelationTypeFilter,
  createTraceIdFilter,
} from "./semantic-graph.js"
export type {
  EntityType,
  RelationType,
  Entity,
  Relation,
  GraphQueryFilter,
  GraphQueryResult,
  GraphStats,
} from "./semantic-graph.js"

// Provenance 工具
export {
  ProvenanceTracker,
  getGlobalTracker,
  initGlobalTracker,
  setGlobalTracker,
} from "./provenance.js"
export type { ProvenanceTrackerConfig } from "./provenance.js"

// 信任链验证
export {
  TrustChain,
  createTrustChain,
  validateTrustChain,
} from "./trust-chain.js"
export type {
  TrustChainConfig,
  ValidationSeverity,
  ValidationIssue,
  TrustChainValidationResult,
  AnomalyDetectionResult,
} from "./trust-chain.js"

// 审计报告
export {
  AuditReportGenerator,
  createAuditReportGenerator,
  generateAuditReport,
} from "./audit-report.js"
export type {
  AuditReportConfig,
  AuditReportFilter,
  AuditReportData,
  AuditReportStats,
  TimelineEntry,
} from "./audit-report.js"
