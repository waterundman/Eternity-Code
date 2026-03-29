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
