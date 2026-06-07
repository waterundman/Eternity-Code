/**
 * Handoff 机制
 *
 * 参考 OpenAI Agents SDK 的设计，实现 Agent 之间的控制权转移。
 * Agent 可以通过返回 HandoffResult 将控制权交给另一个 Agent，
 * 也可以通过 AgentTool 将另一个 Agent 作为工具调用。
 */

import { randomUUID } from "crypto"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import type { AgentRole } from "./types.js"
import { getRole } from "./registry.js"

// ─── Handoff 类型 ───

export interface HandoffResult {
  readonly type: "handoff"
  readonly target_role_id: string
  readonly context_variables: Record<string, unknown>
  readonly reason: string
  readonly handoff_id: string
}

export interface HandoffSpec {
  readonly target_role_id: string
  readonly description: string
  readonly context_variables?: Record<string, unknown>
}

// ─── Agent-as-Tool 类型 ───

export interface AgentToolSpec {
  readonly tool_name: string
  readonly tool_description: string
  readonly target_role_id: string
  readonly context_variables?: Record<string, unknown>
}

export interface AgentToolResult<T = unknown> {
  readonly type: "agent_tool"
  readonly tool_name: string
  readonly target_role_id: string
  readonly output: T
  readonly handoff_id: string
}

// ─── Handoff 构建函数 ───

/**
 * 创建 HandoffResult，用于 Agent 返回时转移控制权
 *
 * @example
 * ```ts
 * function transfer_to_reviewer() {
 *   return handoff_to("card-reviewer", { cardId: "card-001" }, "card needs review")
 * }
 * ```
 */
export function handoff_to(
  targetRoleId: string,
  contextVariables: Record<string, unknown> = {},
  reason: string = "",
): HandoffResult {
  const role = getRole(targetRoleId)
  if (!role) {
    throw new Error(`Cannot handoff to unknown role: ${targetRoleId}`)
  }

  return {
    type: "handoff",
    target_role_id: targetRoleId,
    context_variables: contextVariables,
    reason,
    handoff_id: `ho-${randomUUID().slice(0, 8)}`,
  }
}

/**
 * 检查一个值是否为 HandoffResult
 */
export function isHandoffResult(value: unknown): value is HandoffResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as HandoffResult).type === "handoff"
  )
}

/**
 * 创建 HandoffSpec，用于在 AgentRole 上声明可用的 handoff 目标
 */
export function defineHandoff(
  targetRoleId: string,
  description: string,
  contextVariables?: Record<string, unknown>,
): HandoffSpec {
  return {
    target_role_id: targetRoleId,
    description,
    context_variables: contextVariables,
  }
}

/**
 * 创建 AgentToolSpec，用于将一个 Agent 注册为可调用的工具
 */
export function defineAgentTool(
  toolName: string,
  toolDescription: string,
  targetRoleId: string,
  contextVariables?: Record<string, unknown>,
): AgentToolSpec {
  return {
    tool_name: toolName,
    tool_description: toolDescription,
    target_role_id: targetRoleId,
    context_variables: contextVariables,
  }
}

/**
 * 检查一个值是否为 AgentToolResult
 */
export function isAgentToolResult(value: unknown): value is AgentToolResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as AgentToolResult).type === "agent_tool"
  )
}

// ─── Handoff 链路追踪 ───

export interface HandoffTraceEntry {
  readonly handoff_id: string
  readonly from_role_id: string
  readonly to_role_id: string
  readonly context_variables: Record<string, unknown>
  readonly reason: string
  readonly timestamp: string
  readonly traceId?: string
}

export interface HandoffTraceOptions {
  /** 自动持久化目录，设置后每次 record 自动写入文件 */
  persistDirectory?: string
}

export class HandoffTrace {
  private entries: HandoffTraceEntry[] = []
  private readonly persistDirectory: string | undefined
  private readonly traceId: string | undefined

  constructor(options?: HandoffTraceOptions, traceId?: string) {
    this.persistDirectory = options?.persistDirectory
    this.traceId = traceId
  }

  record(entry: Omit<HandoffTraceEntry, "timestamp" | "traceId">): void {
    const fullEntry: HandoffTraceEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      traceId: this.traceId,
    }
    this.entries.push(fullEntry)

    if (this.persistDirectory) {
      this.persistEntry(fullEntry).catch(() => {
        // 持久化失败不影响主流程
      })
    }
  }

  getEntries(): readonly HandoffTraceEntry[] {
    return this.entries
  }

  getChain(): string[] {
    if (this.entries.length === 0) return []
    const chain = [this.entries[0]!.from_role_id]
    for (const entry of this.entries) {
      chain.push(entry.to_role_id)
    }
    return chain
  }

  toJSON(): HandoffTraceEntry[] {
    return [...this.entries]
  }

  private async persistEntry(entry: HandoffTraceEntry): Promise<void> {
    if (!this.persistDirectory) return

    try {
      await fs.mkdir(this.persistDirectory, { recursive: true })
      const filePath = path.join(this.persistDirectory, `handoff-trace-${this.traceId ?? "unknown"}.jsonl`)
      await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8")
    } catch {
      // 静默失败
    }
  }
}
