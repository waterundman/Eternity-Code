/**
 * 统一错误处理框架
 * 提供结构化的错误类型和传播机制
 */

/**
 * 错误代码枚举
 */
export enum ErrorCode {
  // 文件系统错误
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  FILE_READ_ERROR = "FILE_READ_ERROR",
  FILE_WRITE_ERROR = "FILE_WRITE_ERROR",
  DIRECTORY_NOT_FOUND = "DIRECTORY_NOT_FOUND",
  DIRECTORY_CREATE_ERROR = "DIRECTORY_CREATE_ERROR",

  // 解析错误
  YAML_PARSE_ERROR = "YAML_PARSE_ERROR",
  JSON_PARSE_ERROR = "JSON_PARSE_ERROR",
  INVALID_FORMAT = "INVALID_FORMAT",

  // 验证错误
  VALIDATION_ERROR = "VALIDATION_ERROR",
  SCHEMA_ERROR = "SCHEMA_ERROR",

  // Git 错误
  GIT_COMMAND_FAILED = "GIT_COMMAND_FAILED",
  GIT_NOT_INITIALIZED = "GIT_NOT_INITIALIZED",
  GIT_BRANCH_NOT_FOUND = "GIT_BRANCH_NOT_FOUND",
  GIT_MERGE_CONFLICT = "GIT_MERGE_CONFLICT",

  // Agent 错误
  AGENT_DISPATCH_FAILED = "AGENT_DISPATCH_FAILED",
  AGENT_TIMEOUT = "AGENT_TIMEOUT",
  AGENT_ROLE_NOT_FOUND = "AGENT_ROLE_NOT_FOUND",
  AGENT_PARSE_ERROR = "AGENT_PARSE_ERROR",

  // 执行错误
  EXECUTION_FAILED = "EXECUTION_FAILED",
  EXECUTION_TIMEOUT = "EXECUTION_TIMEOUT",
  TASK_FAILED = "TASK_FAILED",
  ROLLBACK_FAILED = "ROLLBACK_FAILED",

  // 评估错误
  EVAL_SCRIPT_NOT_FOUND = "EVAL_SCRIPT_NOT_FOUND",
  EVAL_SCRIPT_FAILED = "EVAL_SCRIPT_FAILED",
  EVAL_TIMEOUT = "EVAL_TIMEOUT",

  // 配置错误
  CONFIG_NOT_FOUND = "CONFIG_NOT_FOUND",
  CONFIG_INVALID = "CONFIG_INVALID",

  // Watchdog 错误
  CIRCUIT_OPEN = "CIRCUIT_OPEN",
  ANOMALY_DETECTED = "ANOMALY_DETECTED",

  // 通用错误
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
}

/**
 * 错误严重程度
 */
export enum ErrorSeverity {
  LOW = "low",       // 可忽略，不影响功能
  MEDIUM = "medium", // 警告，功能降级
  HIGH = "high",     // 错误，功能失败
  CRITICAL = "critical", // 致命，系统不稳定
}

/**
 * 应用错误类
 */
export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly severity: ErrorSeverity
  public readonly context?: Record<string, unknown>
  public override readonly cause?: Error
  public readonly timestamp: string
  public readonly recoverable: boolean

  constructor(options: {
    code: ErrorCode
    message: string
    severity?: ErrorSeverity
    context?: Record<string, unknown>
    cause?: Error
    recoverable?: boolean
  }) {
    super(options.message, { cause: options.cause })
    this.name = "AppError"
    this.code = options.code
    this.severity = options.severity ?? ErrorSeverity.MEDIUM
    this.context = options.context
    this.cause = options.cause
    this.timestamp = new Date().toISOString()
    this.recoverable = options.recoverable ?? false

    // 保持原型链
    Object.setPrototypeOf(this, AppError.prototype)
  }

  /**
   * 转换为 JSON 对象
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      severity: this.severity,
      context: this.context,
      cause: this.cause?.message,
      timestamp: this.timestamp,
      recoverable: this.recoverable,
      stack: this.stack,
    }
  }

  /**
   * 转换为用户友好的消息
   */
  override toString(): string {
    return this.toUserMessage()
  }

  /**
   * 转换为用户友好的消息
   */
  toUserMessage(): string {
    const icon = this.severity === ErrorSeverity.CRITICAL ? "❌"
      : this.severity === ErrorSeverity.HIGH ? "⚠️"
      : this.severity === ErrorSeverity.MEDIUM ? "⚡"
      : "ℹ️"

    return `${icon} [${this.code}] ${this.message}`
  }

  /**
   * 检查是否可以恢复
   */
  isRecoverable(): boolean {
    return this.recoverable || this.severity === ErrorSeverity.LOW
  }

  /**
   * 创建包装错误
   */
  wrap(message: string, code?: ErrorCode): AppError {
    return new AppError({
      code: code ?? this.code,
      message: `${message}: ${this.message}`,
      severity: this.severity,
      context: this.context,
      cause: this,
      recoverable: this.recoverable,
    })
  }
}

/**
 * 文件系统错误工厂
 */
export const FileErrors = {
  notFound(path: string): AppError {
    return new AppError({
      code: ErrorCode.FILE_NOT_FOUND,
      message: `File not found: ${path}`,
      severity: ErrorSeverity.HIGH,
      context: { path },
      recoverable: false,
    })
  },

  readError(path: string, cause?: Error): AppError {
    return new AppError({
      code: ErrorCode.FILE_READ_ERROR,
      message: `Failed to read file: ${path}`,
      severity: ErrorSeverity.HIGH,
      context: { path },
      cause,
      recoverable: true,
    })
  },

  writeError(path: string, cause?: Error): AppError {
    return new AppError({
      code: ErrorCode.FILE_WRITE_ERROR,
      message: `Failed to write file: ${path}`,
      severity: ErrorSeverity.HIGH,
      context: { path },
      cause,
      recoverable: true,
    })
  },

  directoryNotFound(path: string): AppError {
    return new AppError({
      code: ErrorCode.DIRECTORY_NOT_FOUND,
      message: `Directory not found: ${path}`,
      severity: ErrorSeverity.HIGH,
      context: { path },
      recoverable: false,
    })
  },
}

/**
 * 解析错误工厂
 */
export const ParseErrors = {
  yamlParse(path: string, cause?: Error): AppError {
    return new AppError({
      code: ErrorCode.YAML_PARSE_ERROR,
      message: `Failed to parse YAML file: ${path}`,
      severity: ErrorSeverity.HIGH,
      context: { path },
      cause,
      recoverable: false,
    })
  },

  jsonParse(path: string, cause?: Error): AppError {
    return new AppError({
      code: ErrorCode.JSON_PARSE_ERROR,
      message: `Failed to parse JSON file: ${path}`,
      severity: ErrorSeverity.HIGH,
      context: { path },
      cause,
      recoverable: false,
    })
  },

  invalidFormat(path: string, expected: string): AppError {
    return new AppError({
      code: ErrorCode.INVALID_FORMAT,
      message: `Invalid format in ${path}, expected: ${expected}`,
      severity: ErrorSeverity.HIGH,
      context: { path, expected },
      recoverable: false,
    })
  },
}

/**
 * Git 错误工厂
 */
export const GitErrors = {
  commandFailed(command: string, stderr: string): AppError {
    return new AppError({
      code: ErrorCode.GIT_COMMAND_FAILED,
      message: `Git command failed: ${command}`,
      severity: ErrorSeverity.HIGH,
      context: { command, stderr },
      recoverable: true,
    })
  },

  notInitialized(path: string): AppError {
    return new AppError({
      code: ErrorCode.GIT_NOT_INITIALIZED,
      message: `Git not initialized in: ${path}`,
      severity: ErrorSeverity.HIGH,
      context: { path },
      recoverable: false,
    })
  },

  branchNotFound(branch: string): AppError {
    return new AppError({
      code: ErrorCode.GIT_BRANCH_NOT_FOUND,
      message: `Branch not found: ${branch}`,
      severity: ErrorSeverity.MEDIUM,
      context: { branch },
      recoverable: false,
    })
  },
}

/**
 * Agent 错误工厂
 */
export const AgentErrors = {
  dispatchFailed(roleId: string, cause?: Error): AppError {
    return new AppError({
      code: ErrorCode.AGENT_DISPATCH_FAILED,
      message: `Agent dispatch failed for role: ${roleId}`,
      severity: ErrorSeverity.HIGH,
      context: { roleId },
      cause,
      recoverable: true,
    })
  },

  timeout(roleId: string, timeoutMs: number): AppError {
    return new AppError({
      code: ErrorCode.AGENT_TIMEOUT,
      message: `Agent timed out after ${timeoutMs}ms: ${roleId}`,
      severity: ErrorSeverity.HIGH,
      context: { roleId, timeoutMs },
      recoverable: true,
    })
  },

  roleNotFound(roleId: string): AppError {
    return new AppError({
      code: ErrorCode.AGENT_ROLE_NOT_FOUND,
      message: `Agent role not found: ${roleId}`,
      severity: ErrorSeverity.HIGH,
      context: { roleId },
      recoverable: false,
    })
  },

  parseError(roleId: string, parser: string, cause?: Error): AppError {
    return new AppError({
      code: ErrorCode.AGENT_PARSE_ERROR,
      message: `Failed to parse agent output for role: ${roleId}`,
      severity: ErrorSeverity.MEDIUM,
      context: { roleId, parser },
      cause,
      recoverable: true,
    })
  },
}

/**
 * 执行错误工厂
 */
export const ExecutionErrors = {
  failed(planId: string, taskId?: string, cause?: Error): AppError {
    return new AppError({
      code: ErrorCode.EXECUTION_FAILED,
      message: taskId
        ? `Task ${taskId} failed in plan ${planId}`
        : `Execution failed for plan: ${planId}`,
      severity: ErrorSeverity.HIGH,
      context: { planId, taskId },
      cause,
      recoverable: true,
    })
  },

  timeout(planId: string, timeoutMs: number): AppError {
    return new AppError({
      code: ErrorCode.EXECUTION_TIMEOUT,
      message: `Execution timed out after ${timeoutMs}ms: ${planId}`,
      severity: ErrorSeverity.HIGH,
      context: { planId, timeoutMs },
      recoverable: true,
    })
  },

  rollbackFailed(planId: string, cause?: Error): AppError {
    return new AppError({
      code: ErrorCode.ROLLBACK_FAILED,
      message: `Rollback failed for plan: ${planId}`,
      severity: ErrorSeverity.CRITICAL,
      context: { planId },
      cause,
      recoverable: false,
    })
  },
}

/**
 * Watchdog 错误工厂
 */
export const WatchdogErrors = {
  circuitOpen(roleId: string): AppError {
    return new AppError({
      code: ErrorCode.CIRCUIT_OPEN,
      message: `Circuit breaker open for role: ${roleId}`,
      severity: ErrorSeverity.MEDIUM,
      context: { roleId },
      recoverable: true,
    })
  },

  anomalyDetected(type: string, roleId: string): AppError {
    return new AppError({
      code: ErrorCode.ANOMALY_DETECTED,
      message: `Anomaly detected: ${type} in role ${roleId}`,
      severity: ErrorSeverity.HIGH,
      context: { type, roleId },
      recoverable: true,
    })
  },
}

/**
 * 安全执行包装器
 * 捕获异常并转换为 AppError
 */
export async function safeExecute<T>(
  operation: () => Promise<T>,
  errorFactory: (cause: Error) => AppError
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    throw errorFactory(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * 同步安全执行包装器
 */
export function safeExecuteSync<T>(
  operation: () => T,
  errorFactory: (cause: Error) => AppError
): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    throw errorFactory(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * 错误恢复包装器
 * 如果操作失败，尝试使用回退值
 */
export async function withFallback<T>(
  operation: () => Promise<T>,
  fallback: T,
  onError?: (error: AppError) => void
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError({
          code: ErrorCode.UNKNOWN_ERROR,
          message: String(error),
          severity: ErrorSeverity.MEDIUM,
          recoverable: true,
        })

    onError?.(appError)
    return fallback
  }
}

/**
 * 重试包装器
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries: number
    delayMs?: number
    backoff?: boolean
    shouldRetry?: (error: AppError) => boolean
  }
): Promise<T> {
  let lastError: AppError | undefined

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const appError = error instanceof AppError
        ? error
        : new AppError({
            code: ErrorCode.UNKNOWN_ERROR,
            message: String(error),
            severity: ErrorSeverity.MEDIUM,
            recoverable: true,
          })

      lastError = appError

      // 检查是否应该重试
      if (options.shouldRetry && !options.shouldRetry(appError)) {
        throw appError
      }

      // 如果不是最后一次尝试，等待后重试
      if (attempt < options.maxRetries) {
        const delay = options.backoff
          ? (options.delayMs ?? 1000) * Math.pow(2, attempt)
          : (options.delayMs ?? 1000)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError ?? new AppError({
    code: ErrorCode.UNKNOWN_ERROR,
    message: "Retry failed",
    severity: ErrorSeverity.HIGH,
  })
}
