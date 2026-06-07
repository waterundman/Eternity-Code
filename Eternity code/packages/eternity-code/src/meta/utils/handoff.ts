/**
 * 统一 Handoff 实现
 *
 * 结合 Orchestrator 和 Dispatcher 的 Handoff 逻辑，提供：
 * - 循环检测（MAX_VISITS_PER_ROLE）
 * - 深度限制（MAX_HANDOFF_DEPTH）
 * - 路由验证（canHandoffTo）
 * - 链路追踪（HandoffTrace）
 *
 * 供 Orchestrator 和 Dispatcher 共同使用，确保 Handoff 行为一致。
 */

import { getRole, canHandoffTo } from "../agents/registry.js"
import { isHandoffResult, HandoffTrace } from "../agents/handoff.js"
import type { HandoffResult } from "../agents/handoff.js"

// ─── 常量 ───

export const MAX_HANDOFF_DEPTH = 10
export const MAX_VISITS_PER_ROLE = 2

// ─── 类型 ───

export interface HandoffExecutionResult<T = unknown> {
  readonly handoff_id: string
  readonly from_role_id: string
  readonly to_role_id: string
  readonly output: T
  readonly depth: number
  readonly trace: HandoffTrace
}

export interface HandoffExecutorOptions {
  cwd: string
  session: import("../types.js").Session
  maxHandoffDepth?: number
  maxVisitsPerRole?: number
  onHandoff?: (from: string, to: string, reason: string) => void
}

export interface HandoffExecutor {
  executeHandoff<T = unknown>(
    handoff: HandoffResult,
    currentRoleId: string,
    depth?: number,
    trace?: HandoffTrace,
    visited?: Map<string, number>,
  ): Promise<HandoffExecutionResult<T>>
}

// ─── 实现 ───

/**
 * 创建 Handoff 执行器
 *
 * 返回一个 executeHandoff 函数，用于执行 Agent 之间的控制权转移。
 * 支持链式 handoff（目标 Agent 也可以 handoff），通过 depth 和 visited 限制防止无限递归。
 */
export function createHandoffExecutor(options: HandoffExecutorOptions): HandoffExecutor {
  const maxHandoffDepth = options.maxHandoffDepth ?? MAX_HANDOFF_DEPTH
  const maxVisitsPerRole = options.maxVisitsPerRole ?? MAX_VISITS_PER_ROLE

  async function executeHandoff<T = unknown>(
    handoff: HandoffResult,
    currentRoleId: string,
    depth: number = 0,
    trace?: HandoffTrace,
    visited?: Map<string, number>,
  ): Promise<HandoffExecutionResult<T>> {
    // 初始化追踪和访问记录
    const effectiveTrace = trace ?? new HandoffTrace()
    const effectiveVisited = visited ?? new Map<string, number>()

    // 深度限制检查
    if (depth >= maxHandoffDepth) {
      throw new Error(
        `Handoff depth limit (${maxHandoffDepth}) exceeded. ` +
          `Chain: ${effectiveTrace.getChain().join(" → ")}`
      )
    }

    // 循环检测
    const visitCount = effectiveVisited.get(handoff.target_role_id) ?? 0
    if (visitCount >= maxVisitsPerRole) {
      throw new Error(
        `Handoff cycle detected: ${handoff.target_role_id} visited ${visitCount} times. ` +
          `Chain: ${effectiveTrace.getChain().join(" → ")}`
      )
    }
    effectiveVisited.set(handoff.target_role_id, visitCount + 1)

    // 路由验证
    if (!canHandoffTo(currentRoleId, handoff.target_role_id)) {
      throw new Error(`Role ${currentRoleId} is not allowed to handoff to ${handoff.target_role_id}`)
    }

    // 记录 handoff 链路
    effectiveTrace.record({
      handoff_id: handoff.handoff_id,
      from_role_id: currentRoleId,
      to_role_id: handoff.target_role_id,
      context_variables: handoff.context_variables,
      reason: handoff.reason,
    })

    // 触发回调
    options.onHandoff?.(currentRoleId, handoff.target_role_id, handoff.reason)

    // 获取目标角色
    const targetRole = getRole(handoff.target_role_id)
    if (!targetRole) {
      throw new Error(`Handoff target role not found: ${handoff.target_role_id}`)
    }

    // 构建包含 context_variables 的输入
    const input: Record<string, unknown> = {
      ...handoff.context_variables,
      handoff_reason: handoff.reason,
      handoff_from: currentRoleId,
    }

    // 通过 Dispatcher 调度目标 Agent
    const { Dispatcher } = await import("../agents/dispatcher.js")
    const dispatcher = new Dispatcher({
      cwd: options.cwd,
      session: options.session,
      enableWatchdog: true,
    })

    const output = await dispatcher.dispatch<T>(
      handoff.target_role_id,
      input,
      `handoff:${currentRoleId}`,
    )

    // 检查目标 Agent 是否又返回了 handoff（链式转移）
    if (isHandoffResult(output)) {
      const nextHandoff = output as unknown as HandoffResult
      const nextResult = await executeHandoff<T>(
        nextHandoff,
        handoff.target_role_id,
        depth + 1,
        effectiveTrace,
        effectiveVisited,
      )
      return nextResult
    }

    return {
      handoff_id: handoff.handoff_id,
      from_role_id: currentRoleId,
      to_role_id: handoff.target_role_id,
      output,
      depth,
      trace: effectiveTrace,
    }
  }

  return { executeHandoff }
}

/**
 * 验证 Handoff 路由是否合法
 *
 * 检查 fromRoleId 是否可以 handoff 到 toRoleId。
 * 用于在执行 handoff 前进行预验证。
 */
export function validateHandoffRoute(fromRoleId: string, toRoleId: string): boolean {
  return canHandoffTo(fromRoleId, toRoleId)
}

/**
 * 检查 Handoff 循环
 *
 * 检查目标角色是否已经被访问过多次，用于防止无限循环。
 */
export function isHandoffCycle(
  targetRoleId: string,
  visited: Map<string, number>,
  maxVisits: number = MAX_VISITS_PER_ROLE,
): boolean {
  const visitCount = visited.get(targetRoleId) ?? 0
  return visitCount >= maxVisits
}

/**
 * 检查 Handoff 深度是否超限
 */
export function isHandoffDepthExceeded(
  depth: number,
  maxDepth: number = MAX_HANDOFF_DEPTH,
): boolean {
  return depth >= maxDepth
}