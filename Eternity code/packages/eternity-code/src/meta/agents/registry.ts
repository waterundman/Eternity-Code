/**
 * Agent Role Registry
 *
 * 管理所有AgentRole的注册和加载
 */

import type { AgentRole } from "./types.js"
import type { HandoffSpec, AgentToolSpec } from "./handoff.js"

const roles = new Map<string, AgentRole>()

export function registerRole(role: AgentRole): void {
  roles.set(role.id, role)
}

export function getRole(id: string): AgentRole | undefined {
  return roles.get(id)
}

export function listRoles(): AgentRole[] {
  return Array.from(roles.values())
}

/**
 * 查询指定 Agent 的 handoff 目标列表
 */
export function getHandoffs(roleId: string): HandoffSpec[] {
  const role = roles.get(roleId)
  return role?.handoffs ?? []
}

/**
 * 查询指定 Agent 的 agent_tools 列表
 */
export function getAgentTools(roleId: string): AgentToolSpec[] {
  const role = roles.get(roleId)
  return role?.agent_tools ?? []
}

/**
 * 查询指定 Agent 是否可以 handoff 到目标 Agent
 */
export function canHandoffTo(fromRoleId: string, toRoleId: string): boolean {
  const role = roles.get(fromRoleId)
  if (!role?.handoffs) return false
  return role.handoffs.some((h) => h.target_role_id === toRoleId)
}

/**
 * 查询指定 Agent 是否拥有某个 agent_tool
 */
export function hasAgentTool(roleId: string, toolName: string): boolean {
  const role = roles.get(roleId)
  if (!role?.agent_tools) return false
  return role.agent_tools.some((t) => t.tool_name === toolName)
}

/**
 * 列出所有支持 handoff 的 Agent
 */
export function listHandoffCapableRoles(): AgentRole[] {
  return Array.from(roles.values()).filter((r) => r.handoffs && r.handoffs.length > 0)
}

/**
 * 列出所有支持 agent_tools 的 Agent
 */
export function listAgentToolCapableRoles(): AgentRole[] {
  return Array.from(roles.values()).filter((r) => r.agent_tools && r.agent_tools.length > 0)
}

export function resetRegistry(): void {
  roles.clear()
  rolesLoaded = false
}

// 自动加载所有roles/目录下的角色定义
let rolesLoaded = false

export async function loadAllRoles(): Promise<void> {
  if (rolesLoaded) return

  const roleModules = [
    () => import("./roles/card-reviewer.js"),
    () => import("./roles/coverage-assessor.js"),
    () => import("./roles/planner.js"),
    () => import("./roles/task-executor.js"),
    () => import("./roles/eval-scorer.js"),
    () => import("./roles/prediction-auditor.js"),
    () => import("./roles/restructure-planner.js"),
    () => import("./roles/insight-writer.js"),
    () => import("./roles/contract-drafter.js"),
    () => import("./roles/contract-validator.js"),
  ]

  for (const load of roleModules) {
    try {
      const mod = await load()
      if (mod.default) registerRole(mod.default)
    } catch (err) {
      console.warn(`[Registry] Failed to load role module:`, err)
    }
  }

  rolesLoaded = true
}
