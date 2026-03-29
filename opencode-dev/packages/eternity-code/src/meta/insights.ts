/**
 * Insights Module
 *
 * 从对话或实践中提炼的设计决策，不是需求，不是任务，
 * 是"为什么这样设计"的推理链。
 * 弱模型无权修改，只能引用。
 */

import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import { MetaPaths } from "./paths.js"

export interface Insight {
  id: string
  title: string
  source: string
  category: "architecture" | "product" | "process" | "technical"
  insight: string
  implications: string[]
  related?: string[]
  status: "adopted" | "pending" | "rejected"
  adopted_in?: string
  created_at: string
}

export function loadInsights(cwd: string): Insight[] {
  const dir = MetaPaths.insights(cwd)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yaml"))
    .sort()
    .map(f => {
      try {
        return yaml.load(fs.readFileSync(path.join(dir, f), "utf8")) as Insight
      } catch {
        return null
      }
    })
    .filter((i): i is Insight => i !== null)
}

export function loadAdoptedInsights(cwd: string): Insight[] {
  return loadInsights(cwd).filter(i => i.status === "adopted")
}

export function loadPendingInsights(cwd: string): Insight[] {
  return loadInsights(cwd).filter(i => i.status === "pending")
}

export function writeInsight(cwd: string, insight: Omit<Insight, "id">): string {
  const dir = MetaPaths.insights(cwd)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const existing = fs.readdirSync(dir).filter(f => f.endsWith(".yaml")).length
  const id = `INS-${String(existing + 1).padStart(3, "0")}`
  const full: Insight = { id, ...insight }
  fs.writeFileSync(path.join(dir, `${id}.yaml`), yaml.dump(full, { lineWidth: 100 }))
  return id
}

export function updateInsightStatus(
  cwd: string,
  insightId: string,
  status: Insight["status"],
  adopted_in?: string
): void {
  const dir = MetaPaths.insights(cwd)
  const filePath = path.join(dir, `${insightId}.yaml`)

  if (!fs.existsSync(filePath)) {
    throw new Error(`Insight not found: ${insightId}`)
  }

  const insight = yaml.load(fs.readFileSync(filePath, "utf8")) as Insight
  insight.status = status
  if (adopted_in) {
    insight.adopted_in = adopted_in
  }

  fs.writeFileSync(filePath, yaml.dump(insight, { lineWidth: 100 }))
}

export function buildInsightsContext(cwd: string): string {
  const insights = loadAdoptedInsights(cwd)
  if (!insights.length) return ""

  const lines: string[] = []
  lines.push("\n[来自 cognition/insights/ — adopted only]")
  lines.push("Architecture decisions:")
  insights.flatMap(i => i.implications).forEach(imp => {
    lines.push(`  • ${imp}`)
  })

  return lines.join("\n")
}
