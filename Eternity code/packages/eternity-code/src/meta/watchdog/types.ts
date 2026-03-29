/**
 * Watchdog 异常监控与自动熔断类型定义
 */

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
  agent_role: string
  loop_id?: string
  task_id?: string
  detail: string
  tool_call_count?: number
  repeated_call?: {
    tool: string
    params_hash: string
    count: number
  }
  action_taken:
    | "interrupted"
    | "retried"
    | "degraded"
    | "skipped"
    | "waiting"
}

export interface WatchdogConfig {
  max_tool_calls: number
  max_repeated_calls: number
  call_timeout_ms: number
  max_retries: number
  retry_base_delay_ms: number
  circuit_breaker_threshold: number
  circuit_reset_ms: number
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

export interface WatchdogStatus {
  healthy: boolean
  open_breakers: string[]
  recent_anomalies: AnomalyEvent[]
}

export interface ToolCallInterceptor {
  onToolCall: (tool: string, params: unknown) => void
}
