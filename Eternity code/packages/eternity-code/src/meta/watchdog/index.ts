/**
 * Watchdog 主类
 * 包裹所有 agent 调用，提供异常监控与自动熔断
 */

import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import {
  detectInfiniteLoop,
  RepetitionDetector,
  classifyApiError,
  isEmptyResponse,
} from "./detectors.js"
import { CircuitBreaker } from "./circuit-breaker.js"
import { resolveMetaDirectory } from "../paths.js"
import type {
  WatchdogConfig,
  AnomalyEvent,
  AnomalyType,
  WatchdogStatus,
} from "./types.js"
import { DEFAULT_CONFIG } from "./types.js"
import type { TraceContext } from "../utils/trace-context.js"

export class Watchdog {
  private config: WatchdogConfig
  private breakers = new Map<string, CircuitBreaker>()
  private anomalyLog: AnomalyEvent[] = []
  private cwd: string

  constructor(cwd: string, config: Partial<WatchdogConfig> = {}) {
    this.cwd = cwd
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 包裹任意 agent 调用
   */
  async guard<T>(
    roleId: string,
    loopId: string,
    fn: (signal: AbortSignal, onToolCall?: (tool: string, params: unknown) => void) => Promise<T>,
    traceContext?: TraceContext
  ): Promise<T> {
    const traceId = traceContext?.traceId

    // 1. 检查熔断器
    const breaker = this.getBreaker(roleId)
    if (!breaker.canCall()) {
      this.recordAnomaly({
        type: "circuit_open",
        agent_role: roleId,
        loop_id: loopId,
        detail: breaker.describe(),
        action_taken: "skipped",
      }, traceId)
      throw new Error(`[Watchdog] ${breaker.describe()}`)
    }

    // 2. 准备重复检测与工具调用监控
    const detector = new RepetitionDetector()
    let toolCallCount = 0
    let currentController: AbortController | null = null

    // 3. 工具调用拦截回调
    const onToolCall = (tool: string, params: unknown) => {
      toolCallCount++

      // 无限循环检测
      if (detectInfiniteLoop(toolCallCount, this.config.max_tool_calls)) {
        this.recordAnomaly({
          type: "infinite_loop",
          agent_role: roleId,
          loop_id: loopId,
          detail: `工具调用次数达到上限 ${this.config.max_tool_calls}`,
          tool_call_count: toolCallCount,
          action_taken: "interrupted",
        }, traceId)
        currentController?.abort()
        return
      }

      // 重复调用检测
      const { repeated, count, key } = detector.record(tool, params)
      if (repeated && count >= this.config.max_repeated_calls) {
        const toolName = key.split("::")[0]
        this.recordAnomaly({
          type: "hallucination_loop",
          agent_role: roleId,
          loop_id: loopId,
          detail: `${toolName} 以相同参数重复调用 ${count} 次`,
          tool_call_count: toolCallCount,
          repeated_call: { tool: toolName, params_hash: key.split("::")[1], count },
          action_taken: "interrupted",
        }, traceId)
        currentController?.abort()
      }
    }

    try {
      const result = await this.withRetry(roleId, loopId, (signal) => fn(signal, onToolCall), (controller) => {
        currentController = controller
      }, traceId)
      breaker.recordSuccess()

      // 检查空响应
      if (typeof result === "string" && isEmptyResponse(result)) {
        this.recordAnomaly({
          type: "empty_response",
          agent_role: roleId,
          loop_id: loopId,
          detail: "模型返回了空响应",
          action_taken: "skipped",
        }, traceId)
      }

      return result

    } catch (err) {
      const controller = currentController as AbortController | null
      const aborted = controller !== null && controller.signal.aborted
      if (aborted) {
        const type = toolCallCount >= this.config.max_tool_calls
          ? "infinite_loop" : "timeout"
        this.recordAnomaly({
          type,
          agent_role: roleId,
          loop_id: loopId,
          detail: type === "timeout"
            ? `调用超时（${this.config.call_timeout_ms}ms）`
            : `工具调用超限后中断`,
          tool_call_count: toolCallCount,
          action_taken: "interrupted",
        }, traceId)
        breaker.recordFailure()
        throw new Error(`[Watchdog] ${roleId} interrupted: ${type}`)
      }

      breaker.recordFailure()
      throw err
    }
  }

  /**
   * 带指数退避的重试
   */
  private async withRetry<T>(
    roleId: string,
    loopId: string,
    fn: (signal: AbortSignal) => Promise<T>,
    onControllerCreated?: (controller: AbortController) => void,
    traceId?: string
  ): Promise<T> {
    const maxAttempts = Math.max(1, this.config.max_retries)

    let lastError: unknown
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.config.call_timeout_ms)
      onControllerCreated?.(controller)

      try {
        const result = await fn(controller.signal)
        clearTimeout(timeout)
        return result
      } catch (err) {
        clearTimeout(timeout)
        lastError = err

        if (controller.signal.aborted) {
          throw err
        }

        const anomalyType = classifyApiError(err)

        if (anomalyType === "rate_limit" && attempt < maxAttempts - 1) {
          const retryAfter = (err as any).headers?.["retry-after"]
          const waitMs = retryAfter
            ? parseInt(String(retryAfter)) * 1000
            : Math.min(60000, this.config.retry_base_delay_ms * Math.pow(2, attempt))

          this.recordAnomaly({
            type: "rate_limit",
            agent_role: roleId,
            loop_id: loopId,
            detail: `429 Rate limited，等待 ${waitMs}ms 后重试（第 ${attempt + 1} 次）`,
            action_taken: "waiting",
          }, traceId)
          await sleep(waitMs)
          continue
        }

        if (anomalyType === "network_error" && attempt < maxAttempts - 1) {
          const waitMs = this.config.retry_base_delay_ms * Math.pow(2, attempt)
          this.recordAnomaly({
            type: "network_error",
            agent_role: roleId,
            loop_id: loopId,
            detail: `网络错误，${waitMs}ms 后重试（第 ${attempt + 1} 次）：${(err as Error).message}`,
            action_taken: "retried",
          }, traceId)
          await sleep(waitMs)
          continue
        }

        if (anomalyType === "token_overflow") {
          this.recordAnomaly({
            type: "token_overflow",
            agent_role: roleId,
            loop_id: loopId,
            detail: "Context 超出模型上限，不重试",
            action_taken: "degraded",
          }, traceId)
          throw err
        }

        throw err
      }
    }

    if (lastError) {
      throw lastError
    }
    throw new Error(`[Watchdog] ${roleId} failed after ${maxAttempts} retries`)
  }

  /**
   * 记录异常事件，同时写入磁盘
   */
  private recordAnomaly(event: Omit<AnomalyEvent, "detected_at">, traceId?: string): void {
    const full: AnomalyEvent = {
      ...event,
      detected_at: new Date().toISOString(),
      traceId: traceId ?? event.traceId,
    }
    this.anomalyLog.push(full)
    this.writeAnomalyToDisk(full)
    this.notifyConsole(full)
  }

  /**
   * 将异常写入磁盘
   */
  private writeAnomalyToDisk(event: AnomalyEvent): void {
    try {
      const dir = resolveMetaDirectory(this.cwd, "logs")
      const anomaliesDir = path.join(dir, "anomalies")
      if (!fs.existsSync(anomaliesDir)) fs.mkdirSync(anomaliesDir, { recursive: true })
      const date = event.detected_at.slice(0, 10).replace(/-/g, "")
      const filename = `ANOMALY-${date}-${event.type}.yaml`
      const filePath = path.join(anomaliesDir, filename)
      
      let existing: AnomalyEvent[] = []
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, "utf8")
          const parsed = yaml.load(content)
          if (Array.isArray(parsed)) {
            existing = parsed as AnomalyEvent[]
          }
        } catch (parseError) {
          // 解析失败，使用空数组
          console.warn(`[Watchdog] Failed to parse anomaly file ${filePath}, starting fresh`)
        }
      }
      
      existing.push(event)
      fs.writeFileSync(filePath, yaml.dump(existing, { lineWidth: 120 }))
    } catch (error) {
      // 写磁盘失败不能影响主流程，但记录警告
      console.warn(`[Watchdog] Failed to write anomaly to disk:`, error)
    }
  }

  /**
   * 通知控制台显示异常
   */
  private notifyConsole(event: AnomalyEvent): void {
    const icons: Record<AnomalyType, string> = {
      infinite_loop:      "∞",
      token_overflow:     "⬆",
      network_error:      "⚡",
      hallucination_loop: "↻",
      empty_response:     "∅",
      rate_limit:         "⏱",
      timeout:            "⌛",
      circuit_open:       "✗",
    }
    const icon = icons[event.type] ?? "!"
    console.error(`[Watchdog] ${icon} ${event.agent_role} — ${event.detail}`)
  }

  /**
   * 获取或创建熔断器
   */
  getBreaker(roleId: string): CircuitBreaker {
    if (!this.breakers.has(roleId)) {
      this.breakers.set(roleId, new CircuitBreaker(roleId, this.config))
    }
    return this.breakers.get(roleId)!
  }

  /**
   * 获取异常日志
   */
  getAnomalyLog(): AnomalyEvent[] {
    return [...this.anomalyLog]
  }

  /**
   * 获取汇总状态，给 TUI sidebar 和 dashboard 用
   */
  getStatus(): WatchdogStatus {
    const openBreakers = Array.from(this.breakers.entries())
      .filter(([, b]) => b.getState() !== "closed")
      .map(([id, b]) => b.describe())

    return {
      healthy: openBreakers.length === 0 && this.anomalyLog.length === 0,
      open_breakers: openBreakers,
      recent_anomalies: this.anomalyLog.slice(-5),
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<WatchdogConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 重置所有熔断器
   */
  resetAllBreakers(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset()
    }
  }

  /**
   * 清除异常日志
   */
  clearAnomalyLog(): void {
    this.anomalyLog = []
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export { CircuitBreaker } from "./circuit-breaker.js"
export { RepetitionDetector, detectInfiniteLoop, classifyApiError, isEmptyResponse } from "./detectors.js"
export type { AnomalyType, AnomalyEvent, WatchdogConfig, WatchdogStatus } from "./types.js"
export { DEFAULT_CONFIG } from "./types.js"
