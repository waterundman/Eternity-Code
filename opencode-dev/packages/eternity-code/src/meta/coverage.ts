/**
 * Coverage Assessment Module
 *
 * 管理覆盖度评估：
 * - 调用 coverage-assessor 角色评估每个 REQ 的覆盖度
 * - 更新 design.yaml 的 coverage 字段
 * - 支持手动触发和自动触发
 */

import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { MetaDesign, Session } from "./types.js"
import { loadMetaDesign } from "./design.js"
import { Dispatcher } from "./agents/dispatcher.js"
import type { CoverageOutput } from "./agents/parsers/coverage.js"
import { resolveMetaDesignPath } from "./paths.js"

export interface CoverageAssessmentResult {
  timestamp: string
  assessments: CoverageOutput[]
  updatedReqs: string[]
  errors: string[]
}

/**
 * 运行覆盖度评估
 */
export async function runCoverageAssessment(
  cwd: string,
  session?: Session
): Promise<CoverageAssessmentResult> {
  const design = await loadMetaDesign(cwd)
  if (!design) {
    throw new Error("MetaDesign not initialized")
  }

  const result: CoverageAssessmentResult = {
    timestamp: new Date().toISOString(),
    assessments: [],
    updatedReqs: [],
    errors: [],
  }

  // 如果没有 session，返回错误
  if (!session) {
    result.errors.push("Session required for coverage assessment")
    return result
  }

  // 获取需求列表
  const requirements = design.requirements ?? []
  if (requirements.length === 0) {
    result.errors.push("No requirements defined")
    return result
  }

  try {
    // 使用 dispatcher 调用 coverage-assessor
    const dispatcher = new Dispatcher({ cwd, session })

    const assessments = await dispatcher.dispatch<CoverageOutput[]>(
      "coverage-assessor",
      {
        requirements: requirements.map(r => ({
          id: r.id,
          text: r.text,
          current_coverage: r.coverage ?? 0,
        })),
      },
      "coverage-assessment"
    )

    result.assessments = assessments

    // 更新 design.yaml 中的 coverage 字段
    for (const assessment of assessments) {
      const req = requirements.find(r => r.id === assessment.req_id)
      if (req) {
        req.coverage = assessment.score
        req.coverage_note = assessment.note
        result.updatedReqs.push(assessment.req_id)
      }
    }

    // 保存更新后的 design
    design.updated_at = result.timestamp
    await saveMetaDesign(cwd, design)

    // 记录评估历史
    await saveAssessmentHistory(cwd, result)

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    result.errors.push(errorMsg)
  }

  return result
}

/**
 * 保存评估历史
 */
async function saveAssessmentHistory(
  cwd: string,
  result: CoverageAssessmentResult
): Promise<void> {
  const historyDir = path.join(cwd, ".meta", "coverage-history")
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true })
  }

  const filename = `coverage-${new Date().toISOString().replace(/[:.]/g, "-")}.yaml`
  const filepath = path.join(historyDir, filename)

  fs.writeFileSync(filepath, yaml.dump(result, { lineWidth: 120 }))
}

/**
 * 获取最近的覆盖度评估历史
 */
export function getRecentAssessments(
  cwd: string,
  limit: number = 10
): CoverageAssessmentResult[] {
  const historyDir = path.join(cwd, ".meta", "coverage-history")
  if (!fs.existsSync(historyDir)) {
    return []
  }

  return fs.readdirSync(historyDir)
    .filter(f => f.startsWith("coverage-") && f.endsWith(".yaml"))
    .sort()
    .reverse()
    .slice(0, limit)
    .map(f => {
      try {
        return yaml.load(fs.readFileSync(path.join(historyDir, f), "utf8")) as CoverageAssessmentResult
      } catch {
        return null
      }
    })
    .filter((r): r is CoverageAssessmentResult => r !== null)
}

/**
 * 获取覆盖度统计
 */
export function getCoverageStats(design: MetaDesign): {
  total: number
  avgCoverage: number
  byPriority: Record<string, { count: number; avgCoverage: number }>
  lowCoverage: Array<{ id: string; text: string; coverage: number }>
} {
  const requirements = design.requirements ?? []
  const total = requirements.length

  if (total === 0) {
    return { total: 0, avgCoverage: 0, byPriority: {}, lowCoverage: [] }
  }

  // 计算平均覆盖度
  const totalCoverage = requirements.reduce((sum, r) => sum + (r.coverage ?? 0), 0)
  const avgCoverage = totalCoverage / total

  // 按优先级统计
  const byPriority: Record<string, { count: number; totalCoverage: number }> = {}
  for (const req of requirements) {
    const priority = req.priority || "p1"
    if (!byPriority[priority]) {
      byPriority[priority] = { count: 0, totalCoverage: 0 }
    }
    byPriority[priority].count++
    byPriority[priority].totalCoverage += req.coverage ?? 0
  }

  // 转换为平均值
  const byPriorityAvg: Record<string, { count: number; avgCoverage: number }> = {}
  for (const [priority, stats] of Object.entries(byPriority)) {
    byPriorityAvg[priority] = {
      count: stats.count,
      avgCoverage: stats.count > 0 ? stats.totalCoverage / stats.count : 0,
    }
  }

  // 找出低覆盖度的需求 (低于 50%)
  const lowCoverage = requirements
    .filter(r => (r.coverage ?? 0) < 0.5)
    .sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0))
    .slice(0, 5)
    .map(r => ({
      id: r.id,
      text: r.text,
      coverage: r.coverage ?? 0,
    }))

  return {
    total,
    avgCoverage,
    byPriority: byPriorityAvg,
    lowCoverage,
  }
}

/**
 * 保存 design.yaml
 */
async function saveMetaDesign(cwd: string, design: MetaDesign): Promise<void> {
  const designPath = resolveMetaDesignPath(cwd)
  fs.writeFileSync(designPath, yaml.dump(design, { lineWidth: 100 }))
}
