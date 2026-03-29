/**
 * Quality monitor for the two-speed system.
 */

import * as fs from "fs"
import { listMetaEntryPaths } from "./paths.js"
import { loadLoopRecords } from "./loop.js"

export interface QualityReport {
  should_trigger_sota: boolean
  triggered_by: string[]
  tech_debt_density: number
  rollback_rate: number
  todo_count: number
  incomplete_count: number
  problems_count: number
  timestamp: string
}

export interface QualityThresholds {
  tech_debt_density: number
  todo_count: number
  rollback_rate: number
  incomplete_count: number
  problems_count: number
}

const DEFAULT_THRESHOLDS: QualityThresholds = {
  tech_debt_density: 3,
  todo_count: 10,
  rollback_rate: 0.3,
  incomplete_count: 5,
  problems_count: 3,
}

export function assessQuality(cwd: string, thresholds: Partial<QualityThresholds> = {}): QualityReport {
  const mergedThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds }
  const triggered: string[] = []
  const logFiles = listMetaEntryPaths(cwd, "logs", ".md").sort().reverse()

  const recentLogs = logFiles.slice(0, 3).map((filePath) => fs.readFileSync(filePath, "utf8"))
  const techDebtItems = recentLogs.map((log) => {
    const section = log.split("## 技术债记录")[1]?.split("##")[0] ?? ""
    return section.split("\n").filter((line) => line.startsWith("- ")).length
  })
  const avgDebt = techDebtItems.reduce((sum, value) => sum + value, 0) / (techDebtItems.length || 1)
  if (avgDebt > mergedThresholds.tech_debt_density) {
    triggered.push(`tech_debt_density: ${avgDebt.toFixed(1)} > ${mergedThresholds.tech_debt_density}`)
  }

  const loops = loadLoopRecords(cwd)
  const recent5 = loops.slice(0, 5)
  const rollbacks = recent5.filter((loop) => loop.status === "rolled_back").length
  const rollbackRate = rollbacks / (recent5.length || 1)
  if (rollbackRate > mergedThresholds.rollback_rate) {
    triggered.push(
      `rollback_rate: ${(rollbackRate * 100).toFixed(0)}% > ${(mergedThresholds.rollback_rate * 100).toFixed(0)}%`,
    )
  }

  const allLogsText = logFiles
    .slice(0, 5)
    .map((filePath) => fs.readFileSync(filePath, "utf8"))
    .join("\n")
  const logLines = allLogsText.split("\n").filter((line) => line.startsWith("- "))

  const todoCount = logLines.filter((line) => line.includes("技术债")).length
  if (todoCount > mergedThresholds.todo_count) {
    triggered.push(`todo_count: ${todoCount} > ${mergedThresholds.todo_count}`)
  }

  const incompleteCount = logLines.filter((line) => line.includes("未完成")).length
  if (incompleteCount > mergedThresholds.incomplete_count) {
    triggered.push(`incomplete_count: ${incompleteCount} > ${mergedThresholds.incomplete_count}`)
  }

  const problemsCount = logLines.filter((line) => line.includes("问题")).length
  if (problemsCount > mergedThresholds.problems_count) {
    triggered.push(`problems_count: ${problemsCount} > ${mergedThresholds.problems_count}`)
  }

  return {
    should_trigger_sota: triggered.length > 0,
    triggered_by: triggered,
    tech_debt_density: avgDebt,
    rollback_rate: rollbackRate,
    todo_count: todoCount,
    incomplete_count: incompleteCount,
    problems_count: problemsCount,
    timestamp: new Date().toISOString(),
  }
}

export function formatQualityReport(report: QualityReport): string {
  const lines: string[] = []

  lines.push("=== Quality Report ===")
  lines.push(`Timestamp: ${report.timestamp}`)
  lines.push("")

  if (report.should_trigger_sota) {
    lines.push("Quality thresholds triggered SOTA intervention:")
    for (const reason of report.triggered_by) {
      lines.push(`  - ${reason}`)
    }
    lines.push("")
    lines.push("Consider switching to restructure mode.")
    lines.push("Run /meta-restructure to generate a global restructuring plan.")
  } else {
    lines.push("Quality metrics are within expected thresholds.")
  }

  lines.push("")
  lines.push("Metrics:")
  lines.push(`  Tech debt density: ${report.tech_debt_density.toFixed(1)} items/loop`)
  lines.push(`  Rollback rate: ${(report.rollback_rate * 100).toFixed(0)}%`)
  lines.push(`  TODO count: ${report.todo_count}`)
  lines.push(`  Incomplete count: ${report.incomplete_count}`)
  lines.push(`  Problems count: ${report.problems_count}`)
  lines.push("=== End Quality Report ===")

  return lines.join("\n")
}
