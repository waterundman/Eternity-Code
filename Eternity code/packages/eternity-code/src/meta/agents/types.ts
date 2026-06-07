/**
 * Sub-agent调度层类型定义
 */

import type { Session } from "../types.js"
import type { HandoffSpec, AgentToolSpec } from "./handoff.js"

export interface AgentRole {
  id: string
  name: string
  description: string
  context_needs: Array<
    | "core_value"
    | "requirements"
    | "constraints"
    | "negatives"
    | "eval_factors"
    | "loop_history"
    | "none"
  >
  system_prompt: string
  output_format: string
  output_parser: string
  timeout_ms?: number
  tools?: string[]  // 允许使用的工具列表，如 ["bash", "read"]
  handoffs?: HandoffSpec[]  // 可转移的目标 Agent
  agent_tools?: AgentToolSpec[]  // 可作为工具调用的 Agent
}

export interface AgentTask {
  id: string
  role_id: string
  triggered_by: string
  input: Record<string, unknown>
  status: "pending" | "running" | "done" | "failed"
  output?: unknown
  raw_output?: string
  error?: string
  started_at?: string
  completed_at?: string
  duration_ms?: number
  trace_id?: string
  span_id?: string
}

export interface DispatcherOptions {
  cwd: string
  session: Session
  onTaskStart?: (task: AgentTask) => void
  onTaskComplete?: (task: AgentTask) => void
  onTaskFail?: (task: AgentTask, error: string) => void
}
