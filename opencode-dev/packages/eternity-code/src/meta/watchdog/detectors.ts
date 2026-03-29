/**
 * Watchdog 异常检测逻辑
 */

import type { AnomalyType } from "./types.js"

/**
 * 检测无限工具调用循环
 */
export function detectInfiniteLoop(
  toolCallCount: number,
  max: number
): boolean {
  return toolCallCount >= max
}

/**
 * 重复调用检测器
 * 检测同工具+同参数的重复调用（幻觉循环）
 */
export class RepetitionDetector {
  private history = new Map<string, number>()

  record(tool: string, params: unknown): { repeated: boolean; count: number; key: string } {
    const key = `${tool}::${stableHash(params)}`
    const count = (this.history.get(key) ?? 0) + 1
    this.history.set(key, count)
    return { repeated: count > 1, count, key }
  }

  reset(): void {
    this.history.clear()
  }

  getHistorySize(): number {
    return this.history.size
  }
}

/**
 * 分类 API 错误类型
 */
export function classifyApiError(error: unknown): AnomalyType | null {
  if (!error || typeof error !== "object") return null
  const e = error as Record<string, unknown>

  // Anthropic / OpenAI 错误格式
  const status = e.status as number | undefined
  const message = String(e.message ?? "").toLowerCase()
  const errorType = String(e.error_type ?? e.type ?? "").toLowerCase()

  if (status === 429) return "rate_limit"
  if (status === 400 && (
    message.includes("context_length") ||
    message.includes("token") ||
    errorType.includes("context_length_exceeded")
  )) return "token_overflow"
  if (
    message.includes("network") ||
    message.includes("econnrefused") ||
    message.includes("fetch failed") ||
    message.includes("enotfound") ||
    message.includes("timeout")
  ) return "network_error"

  return null
}

/**
 * 检测空响应
 */
export function isEmptyResponse(text: string | null | undefined): boolean {
  return !text || text.trim().length === 0
}

/**
 * 检测是否是超时错误
 */
export function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as Record<string, unknown>
  const message = String(e.message ?? "").toLowerCase()
  return message.includes("timeout") || message.includes("timed out")
}

/**
 * 稳定哈希（用于参数去重，不需要密码学强度）
 */
function stableHash(obj: unknown): string {
  try {
    if (obj === null || obj === undefined) return String(obj)
    if (typeof obj !== "object") return String(obj)
    return JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort())
  } catch {
    return String(obj)
  }
}
