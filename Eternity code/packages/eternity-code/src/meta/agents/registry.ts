/**
 * Agent Role Registry
 *
 * 管理所有AgentRole的注册和加载
 */

import type { AgentRole } from "./types.js"

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
