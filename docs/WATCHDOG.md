# Eternity Code — Agent 异常监控与自动熔断

本文件描述 Eternity Code 的 Watchdog 系统。
所有 agent 调用（主 loop、sub-agent、task-executor）都必须通过 Watchdog 包裹。

---

## 需要监控的异常类型

```
类型                  表现                          处理策略
──────────────────────────────────────────────────────────────
无限搜索循环          工具调用次数超过阈值            强制中断，写入断点
Token 超限            API 返回 context_length_exceeded  截断上下文，降级重试
网络错误              fetch 超时 / 连接拒绝           指数退避重试，3次后放弃
模型幻觉循环          重复调用相同工具+相同参数        检测到重复后中断
空响应                模型输出空字符串或纯空白         标记异常，跳过本轮
速率限制              API 返回 429                    等待 retry-after，最多等 60s
```

---

## 文件结构

```
packages/opencode/src/meta/
  watchdog/
    index.ts          ← Watchdog 主类，包裹所有 agent 调用
    detectors.ts      ← 各类异常的检测逻辑
    circuit-breaker.ts← 熔断器（防止连续失败）
    types.ts          ← 异常类型定义
```

---

## 实现：types.ts

```typescript
export type AnomalyType =
  | "infinite_loop"          // 工具调用次数超限
  | "token_overflow"         // context 超出模型上限
  | "network_error"          // 网络连接失败
  | "hallucination_loop"     // 重复调用同一工具+参数
  | "empty_response"         // 模型返回空内容
  | "rate_limit"             // API 429
  | "timeout"                // 单次调用超时
  | "circuit_open"           // 熔断器打开

export interface AnomalyEvent {
  type: AnomalyType
  detected_at: string
  agent_role: string          // 哪个 agent 触发的
  loop_id?: string
  task_id?: string
  detail: string              // 人类可读的描述
  tool_call_count?: number    // 当前工具调用次数
  repeated_call?: {           // 重复调用信息
    tool: string
    params_hash: string
    count: number
  }
  action_taken:               // 系统采取的动作
    | "interrupted"           // 强制中断
    | "retried"               // 自动重试
    | "degraded"              // 降级处理
    | "skipped"               // 跳过本轮
    | "waiting"               // 等待后重试
}

export interface WatchdogConfig {
  max_tool_calls: number       // 默认 30，超过则强制中断
  max_repeated_calls: number   // 默认 3，同工具同参数重复 N 次中断
  call_timeout_ms: number      // 默认 120000
  max_retries: number          // 网络错误最大重试次数，默认 3
  retry_base_delay_ms: number  // 指数退避基础延迟，默认 1000
  circuit_breaker_threshold: number  // 连续失败 N 次后打开熔断器，默认 5
  circuit_reset_ms: number     // 熔断器自动重置时间，默认 300000 (5min)
}

export const DEFAULT_CONFIG: WatchdogConfig = {
  max_tool_calls: 30,
  max_repeated_calls: 3,
  call_timeout_ms: 120000,
  max_retries: 3,
  retry_base_delay_ms: 1000,
  circuit_breaker_threshold: 5,
  circuit_reset_ms: 300000,
}
```

---

## 实现：detectors.ts

```typescript
import type { AnomalyType } from "./types.js"

// 检测无限工具调用循环
export function detectInfiniteLoop(
  toolCallCount: number,
  max: number
): boolean {
  return toolCallCount >= max
}

// 检测重复调用（同工具+同参数 = 幻觉循环）
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
}

// 检测 API 错误类型
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

// 检测空响应
export function isEmptyResponse(text: string): boolean {
  return !text || text.trim().length === 0
}

// 稳定哈希（用于参数去重，不需要密码学强度）
function stableHash(obj: unknown): string {
  try {
    return JSON.stringify(obj, Object.keys(obj as object ?? {}).sort())
  } catch {
    return String(obj)
  }
}
```

---

## 实现：circuit-breaker.ts

```typescript
import type { WatchdogConfig } from "./types.js"

type CircuitState = "closed" | "open" | "half-open"

// 每个 agent role 独立的熔断器
// 防止一个 role 连续失败后仍然被不断调用
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

  // 调用前检查
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

  getState(): CircuitState { return this.state }
  getFailureCount(): number { return this.failureCount }

  // 格式化状态给 TUI 显示
  describe(): string {
    if (this.state === "closed") return `✓ ${this.roleId}`
    if (this.state === "open") {
      const remainMs = this.config.circuit_reset_ms - (Date.now() - this.lastFailureAt)
      const remainSec = Math.ceil(remainMs / 1000)
      return `✗ ${this.roleId} — 熔断中，${remainSec}s 后重置`
    }
    return `~ ${this.roleId} — 半开，试探中`
  }
}
```

---

## 实现：index.ts（Watchdog 主类）

```typescript
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
import { MetaPaths } from "../paths.js"
import type {
  WatchdogConfig, AnomalyEvent, AnomalyType
} from "./types.js"
import { DEFAULT_CONFIG } from "./types.js"

export class Watchdog {
  private config: WatchdogConfig
  private breakers = new Map<string, CircuitBreaker>()
  private anomalyLog: AnomalyEvent[] = []
  private cwd: string

  // 在 Dispatcher 里实例化一个 Watchdog，传给所有 agent 调用
  constructor(cwd: string, config: Partial<WatchdogConfig> = {}) {
    this.cwd = cwd
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // 包裹任意 agent 调用
  async guard<T>(
    roleId: string,
    loopId: string,
    fn: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {

    // 1. 检查熔断器
    const breaker = this.getBreaker(roleId)
    if (!breaker.canCall()) {
      this.recordAnomaly({
        type: "circuit_open",
        agent_role: roleId,
        loop_id: loopId,
        detail: breaker.describe(),
        action_taken: "skipped",
      })
      throw new Error(`[Watchdog] ${breaker.describe()}`)
    }

    // 2. 设置超时 AbortController
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, this.config.call_timeout_ms)

    const detector = new RepetitionDetector()
    let toolCallCount = 0

    // 3. 注入工具调用拦截（通过 signal 上挂载计数器）
    // opencode 的 session 在调用工具前会触发 onToolCall 事件
    // 在 Dispatcher 里把这个 hook 传给 Watchdog
    ;(controller.signal as any).__onToolCall = (tool: string, params: unknown) => {
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
        })
        controller.abort()
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
        })
        controller.abort()
      }
    }

    try {
      const result = await this.withRetry(roleId, loopId, () => fn(controller.signal))
      clearTimeout(timer)
      breaker.recordSuccess()

      // 检查空响应
      if (typeof result === "string" && isEmptyResponse(result)) {
        this.recordAnomaly({
          type: "empty_response",
          agent_role: roleId,
          loop_id: loopId,
          detail: "模型返回了空响应",
          action_taken: "skipped",
        })
      }

      return result

    } catch (err) {
      clearTimeout(timer)

      // 超时
      if (controller.signal.aborted) {
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
        })
        breaker.recordFailure()
        throw new Error(`[Watchdog] ${roleId} interrupted: ${type}`)
      }

      breaker.recordFailure()
      throw err
    }
  }

  // 带指数退避的重试
  private async withRetry<T>(
    roleId: string,
    loopId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt < this.config.max_retries; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
        const anomalyType = classifyApiError(err)

        if (anomalyType === "rate_limit") {
          // 尊重 retry-after header（如果有的话）
          const retryAfter = (err as any).headers?.["retry-after"]
          const waitMs = retryAfter
            ? parseInt(retryAfter) * 1000
            : Math.min(60000, this.config.retry_base_delay_ms * Math.pow(2, attempt))

          this.recordAnomaly({
            type: "rate_limit",
            agent_role: roleId,
            loop_id: loopId,
            detail: `429 Rate limited，等待 ${waitMs}ms 后重试（第 ${attempt + 1} 次）`,
            action_taken: "waiting",
          })
          await sleep(waitMs)
          continue
        }

        if (anomalyType === "network_error") {
          const waitMs = this.config.retry_base_delay_ms * Math.pow(2, attempt)
          this.recordAnomaly({
            type: "network_error",
            agent_role: roleId,
            loop_id: loopId,
            detail: `网络错误，${waitMs}ms 后重试（第 ${attempt + 1} 次）：${(err as Error).message}`,
            action_taken: "retried",
          })
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
          })
          // token 超限不重试，直接抛出让上层决策
          throw err
        }

        // 其他错误：不重试
        throw err
      }
    }
    throw lastError
  }

  // 记录异常事件，同时写入磁盘
  private recordAnomaly(event: Omit<AnomalyEvent, "detected_at">): void {
    const full: AnomalyEvent = {
      ...event,
      detected_at: new Date().toISOString(),
    }
    this.anomalyLog.push(full)
    this.writeAnomalyToDisk(full)
    this.notifyTUI(full)
  }

  private writeAnomalyToDisk(event: AnomalyEvent): void {
    try {
      const dir = path.join(this.cwd, ".meta/execution/anomalies")
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const date = event.detected_at.slice(0, 10).replace(/-/g, "")
      const filename = `ANOMALY-${date}-${event.type}.yaml`
      const existing = fs.existsSync(path.join(dir, filename))
        ? yaml.load(fs.readFileSync(path.join(dir, filename), "utf8")) as AnomalyEvent[]
        : []
      existing.push(event)
      fs.writeFileSync(path.join(dir, filename), yaml.dump(existing))
    } catch { /* 写磁盘失败不能影响主流程 */ }
  }

  // 通知 TUI 显示异常（通过 stderr，TUI 监听后展示）
  private notifyTUI(event: AnomalyEvent): void {
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

  getBreaker(roleId: string): CircuitBreaker {
    if (!this.breakers.has(roleId)) {
      this.breakers.set(roleId, new CircuitBreaker(roleId, this.config))
    }
    return this.breakers.get(roleId)!
  }

  getAnomalyLog(): AnomalyEvent[] { return [...this.anomalyLog] }

  // 汇总状态，给 TUI sidebar 和 dashboard 用
  getStatus(): {
    healthy: boolean
    open_breakers: string[]
    recent_anomalies: AnomalyEvent[]
  } {
    const openBreakers = Array.from(this.breakers.entries())
      .filter(([, b]) => b.getState() !== "closed")
      .map(([id, b]) => b.describe())

    return {
      healthy: openBreakers.length === 0 && this.anomalyLog.length === 0,
      open_breakers: openBreakers,
      recent_anomalies: this.anomalyLog.slice(-5),
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

---

## 接入 Dispatcher

修改 `packages/opencode/src/meta/agents/dispatcher.ts`，
在构造时创建 Watchdog，所有 `dispatch` 调用用 Watchdog 包裹：

```typescript
import { Watchdog } from "../watchdog/index.js"

export class Dispatcher {
  private watchdog: Watchdog

  constructor(cwd: string, session: any, watchdogConfig?: Partial<WatchdogConfig>) {
    this.cwd = cwd
    this.session = session
    this.watchdog = new Watchdog(cwd, watchdogConfig)
  }

  async dispatch<T>(roleId: string, input: Record<string, unknown>, triggeredBy = "manual"): Promise<T> {
    const role = getRole(roleId)
    if (!role) throw new Error(`Unknown agent role: ${roleId}`)

    // ... 原有的 systemPrompt / userMessage 构造 ...

    return this.watchdog.guard<T>(roleId, triggeredBy, async (signal) => {
      // 把 signal 传给 session，让 session 在 abort 时中断
      const response = await this.session.createSubtask({
        systemPrompt,
        userMessage,
        signal,                    // 接入 AbortController
        onToolCall: (tool: string, params: unknown) => {
          // 触发 Watchdog 的工具调用计数
          ;(signal as any).__onToolCall?.(tool, params)
        },
      })

      const rawOutput = extractText(response)
      const parser = getParser(role.output_parser)
      return parser(rawOutput) as T
    })
  }
}
```

---

## TUI 异常面板

在 `tui/components/meta/` 新增 `AnomalyPanel.tsx`：

当 Watchdog 触发异常时，在 TUI 底部弹出一个非阻塞通知条：

```
┌─ ⚠ Watchdog ────────────────────────────────────────────┐
│  ∞ task-executor — 工具调用达到上限 30 次，已强制中断     │
│  ↻ card-reviewer — read_file 重复调用 3 次，已中断       │
│                                          [dismiss: Esc] │
└─────────────────────────────────────────────────────────┘
```

显示规则：
- `interrupted` / `circuit_open`：红色，持续显示直到手动 dismiss
- `retried` / `waiting`：黄色，3 秒后自动消失
- `skipped`：灰色，1 秒后自动消失

---

## Dashboard 接入

在 `server.ts` 新增端点：

```typescript
// GET /api/anomalies
if (url.pathname === "/api/anomalies") {
  const dir = path.join(cwd, ".meta/execution/anomalies")
  if (!fs.existsSync(dir)) return Response.json([], { headers })

  const anomalies = fs.readdirSync(dir)
    .filter(f => f.endsWith(".yaml"))
    .sort().reverse().slice(0, 5)
    .flatMap(f => {
      try { return yaml.load(fs.readFileSync(path.join(dir, f), "utf8")) as AnomalyEvent[] }
      catch { return [] }
    })
  return Response.json(anomalies, { headers })
}
```

在 Dashboard 的 Execution tab 里，加一个 Watchdog 状态区块：

```
WATCHDOG STATUS
  card-reviewer    ✓ healthy
  task-executor    ✗ circuit open (resets in 240s)
  coverage-assessor ✓ healthy

RECENT ANOMALIES
  14:32  ∞  task-executor  工具调用超限 30 次
  14:28  ↻  card-reviewer  read_file 重复 3 次
```

---

## design.yaml 新增配置

在 `design.yaml` 里允许项目级别的 Watchdog 配置，
覆盖默认值：

```yaml
watchdog:
  max_tool_calls: 25           # 比默认的 30 更保守
  max_repeated_calls: 3
  call_timeout_ms: 90000
  max_retries: 3
  circuit_breaker_threshold: 5
  circuit_reset_ms: 300000
```

在 `context-loader.ts` 里读取这个配置，传给 Dispatcher 构造函数。

---

## `paths.ts` 新增路径

```typescript
anomalies: (cwd: string) => path.join(cwd, ".meta/execution/anomalies"),
```

---

## 执行顺序

```
step 1: 实现 watchdog/types.ts
step 2: 实现 watchdog/detectors.ts
step 3: 实现 watchdog/circuit-breaker.ts
step 4: 实现 watchdog/index.ts
step 5: 修改 dispatcher.ts，接入 Watchdog
step 6: 在 design.yaml schema 里增加 watchdog 配置字段
step 7: 在 context-loader.ts 里读取 watchdog 配置
step 8: 实现 TUI AnomalyPanel 组件
step 9: dashboard 新增 /api/anomalies 端点和 Watchdog 状态区块
```

打 tag：
```bash
git tag eternity-v1.6-watchdog
```
