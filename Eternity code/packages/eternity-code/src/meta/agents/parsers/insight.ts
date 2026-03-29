/**
 * Insight Parser
 *
 * 解析 meta-insight 命令的输出，提取结构化的 Insight 数据。
 */

import yaml from "js-yaml"

export interface ParsedInsight {
  title: string
  source: string
  category: "architecture" | "product" | "process" | "technical"
  insight: string
  implications: string[]
  related?: string[]
}

export function parseInsight(text: string): ParsedInsight | null {
  const startMarker = "---INSIGHT START---"
  const endMarker = "---INSIGHT END---"

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

    return {
      title: String(parsed.title ?? ""),
      source: String(parsed.source ?? ""),
      category: (parsed.category as ParsedInsight["category"]) ?? "architecture",
      insight: String(parsed.insight ?? ""),
      implications: parseStringList(parsed.implications),
      related: parseStringList(parsed.related),
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
