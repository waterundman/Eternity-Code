import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"

// 从 watchdog/detectors.ts 提取的纯函数

type AnomalyType =
  | "infinite_loop"
  | "token_overflow"
  | "network_error"
  | "hallucination_loop"
  | "empty_response"
  | "rate_limit"
  | "timeout"
  | "circuit_open"

/**
 * 检测无限工具调用循环 - 从 detectors.ts 提取
 */
function detectInfiniteLoop(toolCallCount: number, max: number): boolean {
  return toolCallCount >= max
}

/**
 * 分类 API 错误类型 - 从 detectors.ts 提取
 */
function classifyApiError(error: unknown): AnomalyType | null {
  if (!error || typeof error !== "object") return null
  const e = error as Record<string, unknown>

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
 * 检测空响应 - 从 detectors.ts 提取
 */
function isEmptyResponse(text: string | null | undefined): boolean {
  return !text || text.trim().length === 0
}

/**
 * 检测是否是超时错误 - 从 detectors.ts 提取
 */
function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as Record<string, unknown>
  const message = String(e.message ?? "").toLowerCase()
  return message.includes("timeout") || message.includes("timed out")
}

/**
 * 重复调用检测器 - 从 detectors.ts 提取
 */
class RepetitionDetector {
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
 * 稳定哈希 - 从 detectors.ts 提取
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

/**
 * 熔断器 - 从 circuit-breaker.ts 提取
 */
type CircuitState = "closed" | "open" | "half-open"

interface WatchdogConfig {
  max_tool_calls: number
  max_repeated_calls: number
  call_timeout_ms: number
  max_retries: number
  retry_base_delay_ms: number
  circuit_breaker_threshold: number
  circuit_reset_ms: number
}

class CircuitBreaker {
  private state: CircuitState = "closed"
  private failureCount = 0
  private lastFailureAt = 0
  private readonly roleId: string
  private readonly config: WatchdogConfig

  constructor(roleId: string, config: WatchdogConfig) {
    this.roleId = roleId
    this.config = config
  }

  canCall(): boolean {
    if (this.state === "closed") return true
    if (this.state === "open") {
      if (Date.now() - this.lastFailureAt > this.config.circuit_reset_ms) {
        this.state = "half-open"
        return true
      }
      return false
    }
    return true
  }

  recordSuccess(): void {
    this.failureCount = 0
    this.state = "closed"
  }

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

  describe(): string {
    if (this.state === "closed") return `✓ ${this.roleId}`
    if (this.state === "open") {
      const remainMs = this.config.circuit_reset_ms - (Date.now() - this.lastFailureAt)
      const remainSec = Math.ceil(remainMs / 1000)
      return `✗ ${this.roleId} — 熔断中，${remainSec}s 后重置`
    }
    return `~ ${this.roleId} — 半开，试探中`
  }

  reset(): void {
    this.state = "closed"
    this.failureCount = 0
    this.lastFailureAt = 0
  }
}

const DEFAULT_CONFIG: WatchdogConfig = {
  max_tool_calls: 30,
  max_repeated_calls: 3,
  call_timeout_ms: 120000,
  max_retries: 3,
  retry_base_delay_ms: 1000,
  circuit_breaker_threshold: 5,
  circuit_reset_ms: 300000,
}

describe("watchdog", () => {
  describe("detectInfiniteLoop", () => {
    test("should return true when count equals max", () => {
      expect(detectInfiniteLoop(10, 10)).toBe(true)
    })

    test("should return true when count exceeds max", () => {
      expect(detectInfiniteLoop(15, 10)).toBe(true)
    })

    test("should return false when count is below max", () => {
      expect(detectInfiniteLoop(5, 10)).toBe(false)
    })

    test("should handle zero count", () => {
      expect(detectInfiniteLoop(0, 10)).toBe(false)
    })

    test("should handle zero max", () => {
      expect(detectInfiniteLoop(0, 0)).toBe(true)
    })
  })

  describe("classifyApiError", () => {
    test("should classify rate limit error (429)", () => {
      const error = { status: 429, message: "Too many requests" }
      expect(classifyApiError(error)).toBe("rate_limit")
    })

    test("should classify token overflow with context_length message", () => {
      const error = { status: 400, message: "context_length_exceeded" }
      expect(classifyApiError(error)).toBe("token_overflow")
    })

    test("should classify token overflow with token message", () => {
      const error = { status: 400, message: "token limit exceeded" }
      expect(classifyApiError(error)).toBe("token_overflow")
    })

    test("should classify token overflow with error_type", () => {
      const error = { status: 400, message: "Error", error_type: "context_length_exceeded" }
      expect(classifyApiError(error)).toBe("token_overflow")
    })

    test("should classify network error with network keyword", () => {
      const error = { message: "Network error occurred" }
      expect(classifyApiError(error)).toBe("network_error")
    })

    test("should classify network error with econnrefused", () => {
      const error = { message: "connect ECONNREFUSED 127.0.0.1:3000" }
      expect(classifyApiError(error)).toBe("network_error")
    })

    test("should classify network error with fetch failed", () => {
      const error = { message: "fetch failed" }
      expect(classifyApiError(error)).toBe("network_error")
    })

    test("should classify network error with enotfound", () => {
      const error = { message: "getaddrinfo ENOTFOUND api.example.com" }
      expect(classifyApiError(error)).toBe("network_error")
    })

    test("should classify network error with timeout keyword", () => {
      const error = { message: "Request timeout" }
      expect(classifyApiError(error)).toBe("network_error")
    })

    test("should return null for unknown error", () => {
      const error = { status: 500, message: "Internal server error" }
      expect(classifyApiError(error)).toBeNull()
    })

    test("should return null for null input", () => {
      expect(classifyApiError(null)).toBeNull()
    })

    test("should return null for undefined input", () => {
      expect(classifyApiError(undefined)).toBeNull()
    })

    test("should return null for non-object input", () => {
      expect(classifyApiError("string error")).toBeNull()
      expect(classifyApiError(42)).toBeNull()
    })

    test("should handle case-insensitive messages", () => {
      const error = { message: "TIMEOUT occurred" }
      expect(classifyApiError(error)).toBe("network_error")
    })
  })

  describe("isEmptyResponse", () => {
    test("should return true for null", () => {
      expect(isEmptyResponse(null)).toBe(true)
    })

    test("should return true for undefined", () => {
      expect(isEmptyResponse(undefined)).toBe(true)
    })

    test("should return true for empty string", () => {
      expect(isEmptyResponse("")).toBe(true)
    })

    test("should return true for whitespace only", () => {
      expect(isEmptyResponse("   ")).toBe(true)
    })

    test("should return true for newline only", () => {
      expect(isEmptyResponse("\n")).toBe(true)
    })

    test("should return false for non-empty string", () => {
      expect(isEmptyResponse("hello")).toBe(false)
    })

    test("should return false for string with content and whitespace", () => {
      expect(isEmptyResponse("  hello  ")).toBe(false)
    })
  })

  describe("isTimeoutError", () => {
    test("should return true for timeout message", () => {
      const error = { message: "Request timeout" }
      expect(isTimeoutError(error)).toBe(true)
    })

    test("should return true for timed out message", () => {
      const error = { message: "Connection timed out" }
      expect(isTimeoutError(error)).toBe(true)
    })

    test("should return false for non-timeout error", () => {
      const error = { message: "Network error" }
      expect(isTimeoutError(error)).toBe(false)
    })

    test("should return false for null", () => {
      expect(isTimeoutError(null)).toBe(false)
    })

    test("should return false for undefined", () => {
      expect(isTimeoutError(undefined)).toBe(false)
    })

    test("should return false for non-object", () => {
      expect(isTimeoutError("timeout")).toBe(false)
    })

    test("should handle case-insensitive", () => {
      const error = { message: "TIMEOUT" }
      expect(isTimeoutError(error)).toBe(true)
    })
  })

  describe("RepetitionDetector", () => {
    let detector: RepetitionDetector

    beforeEach(() => {
      detector = new RepetitionDetector()
    })

    test("should not detect repetition on first call", () => {
      const result = detector.record("tool1", { param: "value" })
      expect(result.repeated).toBe(false)
      expect(result.count).toBe(1)
    })

    test("should detect repetition on second call with same params", () => {
      detector.record("tool1", { param: "value" })
      const result = detector.record("tool1", { param: "value" })
      expect(result.repeated).toBe(true)
      expect(result.count).toBe(2)
    })

    test("should not detect repetition with different params", () => {
      detector.record("tool1", { param: "value1" })
      const result = detector.record("tool1", { param: "value2" })
      expect(result.repeated).toBe(false)
      expect(result.count).toBe(1)
    })

    test("should not detect repetition with different tools", () => {
      detector.record("tool1", { param: "value" })
      const result = detector.record("tool2", { param: "value" })
      expect(result.repeated).toBe(false)
      expect(result.count).toBe(1)
    })

    test("should track multiple repetitions", () => {
      detector.record("tool1", { param: "value" })
      detector.record("tool1", { param: "value" })
      const result = detector.record("tool1", { param: "value" })
      expect(result.count).toBe(3)
    })

    test("should reset history", () => {
      detector.record("tool1", { param: "value" })
      detector.reset()
      const result = detector.record("tool1", { param: "value" })
      expect(result.repeated).toBe(false)
      expect(result.count).toBe(1)
    })

    test("should track history size", () => {
      detector.record("tool1", { param: "value1" })
      detector.record("tool1", { param: "value2" })
      detector.record("tool2", { param: "value1" })
      expect(detector.getHistorySize()).toBe(3)
    })

    test("should handle null params", () => {
      const result = detector.record("tool1", null)
      expect(result.repeated).toBe(false)
    })

    test("should handle undefined params", () => {
      const result = detector.record("tool1", undefined)
      expect(result.repeated).toBe(false)
    })

    test("should handle primitive params", () => {
      detector.record("tool1", "string")
      const result = detector.record("tool1", "string")
      expect(result.repeated).toBe(true)
    })

    test("should generate consistent keys for same input", () => {
      const result1 = detector.record("tool1", { a: 1, b: 2 })
      const result2 = detector.record("tool1", { b: 2, a: 1 })
      // Object key order shouldn't matter due to stableHash
      expect(result1.key).toBe(result2.key)
    })
  })

  describe("CircuitBreaker", () => {
    let breaker: CircuitBreaker
    let originalDateNow: typeof Date.now

    beforeEach(() => {
      originalDateNow = Date.now
      breaker = new CircuitBreaker("test-role", DEFAULT_CONFIG)
    })

    afterEach(() => {
      Date.now = originalDateNow
    })

    describe("state machine transitions", () => {
      test("should start in closed state", () => {
        expect(breaker.getState()).toBe("closed")
      })

      test("should allow calls in closed state", () => {
        expect(breaker.canCall()).toBe(true)
      })

      test("should transition to open after threshold failures", () => {
        for (let i = 0; i < DEFAULT_CONFIG.circuit_breaker_threshold; i++) {
          breaker.recordFailure()
        }
        expect(breaker.getState()).toBe("open")
      })

      test("should not allow calls in open state", () => {
        for (let i = 0; i < DEFAULT_CONFIG.circuit_breaker_threshold; i++) {
          breaker.recordFailure()
        }
        expect(breaker.canCall()).toBe(false)
      })

      test("should transition to half-open after reset time", () => {
        const now = 1000000
        Date.now = () => now

        for (let i = 0; i < DEFAULT_CONFIG.circuit_breaker_threshold; i++) {
          breaker.recordFailure()
        }
        expect(breaker.getState()).toBe("open")

        // Move time forward past reset period
        Date.now = () => now + DEFAULT_CONFIG.circuit_reset_ms + 1
        expect(breaker.canCall()).toBe(true)
        expect(breaker.getState()).toBe("half-open")
      })

      test("should transition from half-open to closed on success", () => {
        const now = 1000000
        Date.now = () => now

        for (let i = 0; i < DEFAULT_CONFIG.circuit_breaker_threshold; i++) {
          breaker.recordFailure()
        }

        Date.now = () => now + DEFAULT_CONFIG.circuit_reset_ms + 1
        breaker.canCall() // Transitions to half-open
        breaker.recordSuccess()

        expect(breaker.getState()).toBe("closed")
        expect(breaker.getFailureCount()).toBe(0)
      })

      test("should transition from half-open back to open on failure", () => {
        const now = 1000000
        Date.now = () => now

        for (let i = 0; i < DEFAULT_CONFIG.circuit_breaker_threshold; i++) {
          breaker.recordFailure()
        }

        Date.now = () => now + DEFAULT_CONFIG.circuit_reset_ms + 1
        breaker.canCall() // Transitions to half-open
        breaker.recordFailure()

        expect(breaker.getState()).toBe("open")
      })

      test("should reset to closed state", () => {
        for (let i = 0; i < DEFAULT_CONFIG.circuit_breaker_threshold; i++) {
          breaker.recordFailure()
        }
        expect(breaker.getState()).toBe("open")

        breaker.reset()
        expect(breaker.getState()).toBe("closed")
        expect(breaker.getFailureCount()).toBe(0)
      })
    })

    describe("failure counting", () => {
      test("should track failure count", () => {
        breaker.recordFailure()
        breaker.recordFailure()
        expect(breaker.getFailureCount()).toBe(2)
      })

      test("should reset failure count on success", () => {
        breaker.recordFailure()
        breaker.recordFailure()
        breaker.recordSuccess()
        expect(breaker.getFailureCount()).toBe(0)
      })

      test("should not open before threshold", () => {
        for (let i = 0; i < DEFAULT_CONFIG.circuit_breaker_threshold - 1; i++) {
          breaker.recordFailure()
        }
        expect(breaker.getState()).toBe("closed")
      })
    })

    describe("metadata", () => {
      test("should return role id", () => {
        expect(breaker.getRoleId()).toBe("test-role")
      })

      test("should describe closed state", () => {
        expect(breaker.describe()).toBe("✓ test-role")
      })

      test("should describe open state", () => {
        for (let i = 0; i < DEFAULT_CONFIG.circuit_breaker_threshold; i++) {
          breaker.recordFailure()
        }
        const description = breaker.describe()
        expect(description).toContain("✗ test-role")
        expect(description).toContain("熔断中")
      })

      test("should describe half-open state", () => {
        const now = 1000000
        Date.now = () => now

        for (let i = 0; i < DEFAULT_CONFIG.circuit_breaker_threshold; i++) {
          breaker.recordFailure()
        }

        Date.now = () => now + DEFAULT_CONFIG.circuit_reset_ms + 1
        breaker.canCall() // Transitions to half-open
        expect(breaker.describe()).toBe("~ test-role — 半开，试探中")
      })
    })
  })

  describe("stableHash", () => {
    test("should hash null", () => {
      expect(stableHash(null)).toBe("null")
    })

    test("should hash undefined", () => {
      expect(stableHash(undefined)).toBe("undefined")
    })

    test("should hash string", () => {
      expect(stableHash("test")).toBe("test")
    })

    test("should hash number", () => {
      expect(stableHash(42)).toBe("42")
    })

    test("should hash boolean", () => {
      expect(stableHash(true)).toBe("true")
    })

    test("should hash object with sorted keys", () => {
      const obj = { b: 2, a: 1 }
      expect(stableHash(obj)).toBe('{"a":1,"b":2}')
    })

    test("should produce same hash for same object regardless of key order", () => {
      const obj1 = { a: 1, b: 2, c: 3 }
      const obj2 = { c: 3, a: 1, b: 2 }
      expect(stableHash(obj1)).toBe(stableHash(obj2))
    })

    test("should handle nested objects", () => {
      const obj = { nested: { b: 2, a: 1 } }
      const result = stableHash(obj)
      // stableHash uses Object.keys() as replacer, which only includes top-level keys
      // The nested object is serialized as {} because its keys are not in the replacer array
      expect(result).toBe('{"nested":{}}')
    })
  })
})