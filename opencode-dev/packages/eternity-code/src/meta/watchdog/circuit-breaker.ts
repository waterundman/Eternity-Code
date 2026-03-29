/**
 * 熔断器
 * 防止一个 agent role 连续失败后仍然被不断调用
 */

import type { WatchdogConfig } from "./types.js"

type CircuitState = "closed" | "open" | "half-open"

export class CircuitBreaker {
  private state: CircuitState = "closed"
  private failureCount = 0
  private lastFailureAt = 0
  private readonly roleId: string
  private readonly config: WatchdogConfig

  constructor(roleId: string, config: WatchdogConfig) {
    this.roleId = roleId
    this.config = config
  }

  /**
   * 调用前检查是否允许调用
   */
  canCall(): boolean {
    if (this.state === "closed") return true
    if (this.state === "open") {
      // 超过重置时间，进入半开状态，允许一次试探
      if (Date.now() - this.lastFailureAt > this.config.circuit_reset_ms) {
        this.state = "half-open"
        return true
      }
      return false
    }
    // half-open: 允许一次调用
    return true
  }

  /**
   * 记录成功调用
   */
  recordSuccess(): void {
    this.failureCount = 0
    this.state = "closed"
  }

  /**
   * 记录失败调用
   */
  recordFailure(): void {
    this.failureCount++
    this.lastFailureAt = Date.now()
    if (this.failureCount >= this.config.circuit_breaker_threshold) {
      this.state = "open"
    }
  }

  getState(): CircuitState {
    return this.state
  }

  getFailureCount(): number {
    return this.failureCount
  }

  getRoleId(): string {
    return this.roleId
  }

  /**
   * 格式化状态给 TUI 显示
   */
  describe(): string {
    if (this.state === "closed") return `✓ ${this.roleId}`
    if (this.state === "open") {
      const remainMs = this.config.circuit_reset_ms - (Date.now() - this.lastFailureAt)
      const remainSec = Math.ceil(remainMs / 1000)
      return `✗ ${this.roleId} — 熔断中，${remainSec}s 后重置`
    }
    return `~ ${this.roleId} — 半开，试探中`
  }

  /**
   * 重置熔断器状态
   */
  reset(): void {
    this.state = "closed"
    this.failureCount = 0
    this.lastFailureAt = 0
  }
}
