/**
 * MetaDesign Context Builder
 *
 * 按AgentRole声明的context_needs组装MetaDesign上下文
 * 不是所有agent都需要全量注入——按需声明减少token消耗
 */

import type { MetaDesign } from "../types.js"
import type { AgentRole } from "./types.js"

export function buildAgentContext(
  design: MetaDesign | null,
  needs: AgentRole["context_needs"]
): string {
  if (!design || needs.includes("none")) return ""

  const parts: string[] = ["=== MetaDesign Context ==="]

  if (needs.includes("core_value")) {
    parts.push(`Core value: ${design.project.core_value}`)
    parts.push(`Anti value: ${design.project.anti_value}`)
    parts.push(`Stage: ${design.project.stage}`)
  }

  if (needs.includes("requirements")) {
    parts.push("\nRequirements:")
    for (const r of design.requirements ?? []) {
      const pct = ((r.coverage ?? 0) * 100).toFixed(0)
      parts.push(`  [${r.id}] ${pct}% coverage — ${r.text}`)
      if (r.coverage_note) parts.push(`         ↳ ${r.coverage_note}`)
    }
  }

  if (needs.includes("constraints")) {
    const c = design.constraints
    if (c?.compliance?.length) {
      parts.push("\nCompliance (never violate):")
      c.compliance.forEach((rule) => parts.push(`  • ${rule}`))
    }
    if (c?.immutable_modules?.length) {
      parts.push("\nImmutable modules (never modify):")
      c.immutable_modules.forEach((m) => parts.push(`  • ${m.path}`))
    }
  }

  if (needs.includes("negatives")) {
    const active = (design.rejected_directions ?? []).filter((n) => n.status === "active")
    if (active.length) {
      parts.push("\nRejected directions (do NOT propose these):")
      active.forEach((n) => {
        parts.push(`  [${n.id}] ${n.text}`)
        parts.push(`         reason: ${n.reason}`)
      })
    }
  }

  if (needs.includes("eval_factors")) {
    const factors = (design.eval_factors ?? []).filter(
      (f) => f.role.type === "objective" || f.role.type === "guardrail"
    )
    if (factors.length) {
      parts.push("\nEval baselines:")
      factors.forEach((f) => {
        const role = f.role.type === "guardrail" ? "🔒" : "🎯"
        parts.push(
          `  ${role} ${f.name}: ${f.threshold.baseline} (target: ${f.threshold.target}, floor: ${f.threshold.floor})`
        )
      })
    }
  }

  if (needs.includes("loop_history")) {
    const last = design.loop_history?.loops?.slice(0, 3)
    if (last?.length) {
      parts.push("\nRecent loops:")
      last.forEach((l) => {
        const d =
          (l.composite_score_delta ?? 0) > 0
            ? `+${l.composite_score_delta}`
            : String(l.composite_score_delta)
        parts.push(`  ${l.loop_id} ${d} — ${l.summary ?? ""}`)
      })
    }
  }

  parts.push("=== End MetaDesign Context ===\n")
  return parts.join("\n")
}

/**
 * 构建 handoff 场景的上下文注入
 *
 * 当 Agent 被 handoff 唤醒时，注入来源 Agent 传递的 context_variables
 * 以及 handoff 原因，帮助目标 Agent 快速理解切换背景。
 */
export function buildHandoffContext(
  sourceRoleId: string,
  contextVariables: Record<string, unknown>,
  reason: string,
  handoffChain: string[],
): string {
  const parts: string[] = ["=== Handoff Context ==="]

  parts.push(`Source agent: ${sourceRoleId}`)

  if (reason) {
    parts.push(`Handoff reason: ${reason}`)
  }

  if (handoffChain.length > 1) {
    parts.push(`Handoff chain: ${handoffChain.join(" → ")}`)
  }

  if (Object.keys(contextVariables).length > 0) {
    parts.push("\nTransferred context variables:")
    for (const [key, value] of Object.entries(contextVariables)) {
      const formatted = typeof value === "string" ? value : JSON.stringify(value, null, 2)
      parts.push(`  ${key}: ${formatted}`)
    }
  }

  parts.push("=== End Handoff Context ===\n")
  return parts.join("\n")
}

/**
 * 将 handoff context 合并到 agent 的 system prompt 前部
 */
export function injectHandoffIntoPrompt(
  systemPrompt: string,
  sourceRoleId: string,
  contextVariables: Record<string, unknown>,
  reason: string,
  handoffChain: string[],
): string {
  const handoffCtx = buildHandoffContext(sourceRoleId, contextVariables, reason, handoffChain)
  return `${handoffCtx}\n\n${systemPrompt}`
}
