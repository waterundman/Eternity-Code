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

// 类型定义
export type { ValidationResult, Validator } from "./validation.js"
export type { Disposable } from "./resource-manager.js"
export type { PerformanceMetric, MemorySnapshot, PerformanceStats } from "./performance.js"

/**
 * 提取文本内容（从各种响应格式中）
 */
export function extractText(response: unknown): string {
  if (typeof response === "string") return response
  const result = response as any
  if (typeof result?.text === "string") return result.text
  if (Array.isArray(result?.content)) {
    return result.content.map((item: any) => item?.text ?? "").join("\n")
  }
  return String(response)
}

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
