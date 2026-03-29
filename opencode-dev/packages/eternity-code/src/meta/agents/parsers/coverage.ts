/**
 * Coverage Parser
 *
 * 解析coverage-assessor角色的输出
 */

import yaml from "js-yaml"

export interface CoverageOutput {
  req_id: string
  score: number
  note: string
}

export function parseCoverage(text: string): CoverageOutput[] {
  const blocks = text.split("---COVERAGE START---").slice(1)
  const results: CoverageOutput[] = []

  for (const block of blocks) {
    const end = block.indexOf("---COVERAGE END---")
    if (end === -1) continue

    try {
      const parsed = yaml.load(block.slice(0, end).trim()) as any
      if (!parsed?.req_id) continue

      results.push({
        req_id: String(parsed.req_id),
        score: Number(parsed.score ?? 0),
        note: String(parsed.note ?? ""),
      })
    } catch {
      // Ignore malformed blocks
    }
  }

  return results
}
