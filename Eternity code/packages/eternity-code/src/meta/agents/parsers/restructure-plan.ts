/**
 * Restructure Plan Parser
 *
 * 解析 meta-restructure 命令的输出，提取结构化的重构方案。
 */

import yaml from "js-yaml"

export interface ParsedRestructurePlan {
  diagnosis: {
    overall_health: number
    primary_issues: string[]
    path_dependencies: string[]
  }
  restructure_plan: {
    approach: "full_rewrite" | "targeted_refactor"
    scope: string[]
    preserve: string[]
    new_architecture: string
  }
  docs_to_update: string[]
  acceptance: string[]
}

export function parseRestructurePlan(text: string): ParsedRestructurePlan | null {
  const startMarker = "---RESTRUCTURE START---"
  const endMarker = "---RESTRUCTURE END---"

  const startIndex = text.indexOf(startMarker)
  const endIndex = text.indexOf(endMarker)

  if (startIndex === -1 || endIndex === -1) {
    return null
  }

  const content = text.slice(startIndex + startMarker.length, endIndex).trim()

  try {
    const parsed = yaml.load(content) as Record<string, unknown>
    if (!parsed || typeof parsed !== "object") {
      return null
    }

    const diagnosis = parsed.diagnosis as Record<string, unknown> | undefined
    const plan = parsed.restructure_plan as Record<string, unknown> | undefined

    return {
      diagnosis: {
        overall_health: Number(diagnosis?.overall_health ?? 0.5),
        primary_issues: parseStringList(diagnosis?.primary_issues),
        path_dependencies: parseStringList(diagnosis?.path_dependencies),
      },
      restructure_plan: {
        approach: (plan?.approach as ParsedRestructurePlan["restructure_plan"]["approach"]) ?? "targeted_refactor",
        scope: parseStringList(plan?.scope),
        preserve: parseStringList(plan?.preserve),
        new_architecture: String(plan?.new_architecture ?? ""),
      },
      docs_to_update: parseStringList(parsed.docs_to_update),
      acceptance: parseStringList(parsed.acceptance),
    }
  } catch {
    return null
  }
}

function parseStringList(val: unknown): string[] {
  if (!val || val === "none") return []
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === "string") return val.split("\n").map(s => s.trim()).filter(Boolean)
  return []
}
