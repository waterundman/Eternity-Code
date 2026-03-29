import * as fs from "fs"
import yaml from "js-yaml"
import type { MetaDesign } from "./types.js"
import { resolveMetaDesignPath } from "./paths.js"
import { buildInsightsContext } from "./insights.js"
import { buildBlueprintContext } from "./blueprints.js"

export type { MetaDesign } from "./types.js"

/**
 * Load .meta/design/design.yaml from the given working directory.
 * Returns null silently if the file doesn't exist so non-MetaDesign projects
 * continue to work normally.
 */
export async function loadMetaDesign(cwd: string): Promise<MetaDesign | null> {
  const designPath = resolveMetaDesignPath(cwd)
  if (!fs.existsSync(designPath)) return null

  try {
    const raw = fs.readFileSync(designPath, "utf8")
    return yaml.load(raw) as MetaDesign
  } catch (e) {
    console.warn("[MetaDesign] Failed to parse design.yaml:", e)
    return null
  }
}

/**
 * Build a structured context block from the MetaDesign object.
 * This string is appended to the system prompt of every LLM call.
 */
export function buildSystemContext(design: MetaDesign, cwd?: string): string {
  const lines: string[] = []

  lines.push("=== MetaDesign Context ===")
  lines.push(`Project: ${design.project.name}  [stage: ${design.project.stage}]`)
  lines.push(`Core value:  ${design.project.core_value}`)
  lines.push(`Anti value:  ${design.project.anti_value}`)

  if (design.requirements?.length) {
    lines.push("")
    lines.push("Requirements:")
    for (const req of design.requirements) {
      const bar = coverageBar(req.coverage ?? 0)
      lines.push(`  [${req.id}] ${bar} (${((req.coverage ?? 0) * 100).toFixed(0)}%)  ${req.text}`)
      if (req.coverage_note) lines.push(`         -> ${req.coverage_note}`)
    }
  }

  const compliance = design.constraints?.compliance ?? []
  if (compliance.length) {
    lines.push("")
    lines.push("Compliance constraints (hard rules, never violate):")
    for (const item of compliance) lines.push(`  - ${item}`)
  }

  const immutable = design.constraints?.immutable_modules ?? []
  if (immutable.length) {
    lines.push("")
    lines.push("Immutable modules (never modify these files):")
    for (const item of immutable) lines.push(`  - ${item.path} - ${item.reason}`)
  }

  const activeNegs = (design.rejected_directions ?? []).filter((item) => item.status === "active")
  if (activeNegs.length) {
    lines.push("")
    lines.push("Rejected directions (DO NOT propose anything in these directions):")
    for (const item of activeNegs) {
      lines.push(`  [${item.id}] ${item.text}`)
      lines.push(`         reason: ${item.reason}`)
      if (item.scope?.condition) lines.push(`         unlocks when: ${item.scope.condition}`)
    }
  }

  const objectives = (design.eval_factors ?? []).filter(
    (factor) => factor.role.type === "objective" || factor.role.type === "guardrail",
  )
  if (objectives.length) {
    lines.push("")
    lines.push("Eval factor baselines:")
    for (const factor of objectives) {
      const role = factor.role.type === "guardrail" ? "[guardrail]" : "[objective]"
      lines.push(
        `  ${role} ${factor.name}: ${factor.threshold.baseline} (target: ${factor.threshold.target}, floor: ${factor.threshold.floor})`,
      )
    }
  }

  if (design.search_policy) {
    lines.push("")
    lines.push(
      `Search policy: ${design.search_policy.mode}  max cards/loop: ${design.search_policy.max_cards_per_loop}`,
    )
  }

  // 注入 blueprint 上下文
  if (cwd) {
    const blueprintContext = buildBlueprintContext(cwd)
    if (blueprintContext) {
      lines.push(blueprintContext)
    }

    // 注入 insights 上下文
    const insightsContext = buildInsightsContext(cwd)
    if (insightsContext) {
      lines.push(insightsContext)
    }
  }

  lines.push("=== End MetaDesign Context ===")
  return lines.join("\n")
}

function coverageBar(coverage: number): string {
  const filled = Math.round(coverage * 8)
  return "#".repeat(filled) + "-".repeat(8 - filled)
}
