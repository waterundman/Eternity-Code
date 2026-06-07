/**
 * Unified Logger
 *
 * Provides a structured logging framework for the meta system.
 * Replaces direct console.log/warn/error calls with a configurable logger.
 *
 * Features:
 * - Module-scoped loggers via createLogger(module)
 * - Log levels: debug, info, warn, error
 * - JSON format output (configurable)
 * - Environment variable configuration
 * - TraceContext integration for distributed tracing
 *
 * Configuration:
 * - META_LOG_LEVEL: minimum log level (debug|info|warn|error), default: info
 * - META_LOG_FORMAT: output format (json|text), default: text
 */

import type { TraceContext } from "./trace-context.js"

export type LogLevel = "debug" | "info" | "warn" | "error"

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

interface LogEntry {
  timestamp: string
  level: Uppercase<LogLevel>
  module: string
  message: string
  data?: unknown
  traceId?: string
  spanId?: string
}

function getConfig(): { level: LogLevel; json: boolean } {
  const envLevel = (process.env.META_LOG_LEVEL ?? "info").toLowerCase()
  const envFormat = (process.env.META_LOG_FORMAT ?? "text").toLowerCase()

  const level: LogLevel =
    envLevel === "debug" || envLevel === "info" || envLevel === "warn" || envLevel === "error"
      ? envLevel
      : "info"

  return { level, json: envFormat === "json" }
}

function shouldLog(messageLevel: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[messageLevel] >= LOG_LEVEL_PRIORITY[minLevel]
}

function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry)
}

function formatText(entry: LogEntry): string {
  const prefix = `[${entry.level}]`
  const moduleTag = `[${entry.module}]`
  const traceTag = entry.traceId ? ` [trace:${entry.traceId}]` : ""
  const base = `${prefix} ${moduleTag}${traceTag} ${entry.message}`
  return entry.data !== undefined ? `${base} ${safeStringify(entry.data)}` : base
}

function safeStringify(data: unknown): string {
  if (typeof data === "string") return data
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

export interface Logger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
}

/**
 * 创建 Logger 实例
 *
 * @param module 模块名称
 * @param traceContext 可选的 TraceContext，注入后所有日志自动携带 traceId/spanId
 */
export function createLogger(module: string, traceContext?: TraceContext): Logger {
  const config = getConfig()

  function log(level: LogLevel, message: string, data?: unknown): void {
    if (!shouldLog(level, config.level)) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase() as Uppercase<LogLevel>,
      module,
      message,
      data,
      traceId: traceContext?.traceId,
      spanId: traceContext?.spanId,
    }

    const output = config.json ? formatJson(entry) : formatText(entry)

    switch (level) {
      case "debug":
      case "info":
        console.log(output)
        break
      case "warn":
        console.warn(output)
        break
      case "error":
        console.error(output)
        break
    }
  }

  return {
    debug: (message: string, data?: unknown) => log("debug", message, data),
    info: (message: string, data?: unknown) => log("info", message, data),
    warn: (message: string, data?: unknown) => log("warn", message, data),
    error: (message: string, data?: unknown) => log("error", message, data),
  }
}
