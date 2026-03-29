/**
 * Restructure Handler
 *
 * 处理 meta-restructure 命令的输出，解析并生成重构方案文件。
 */

import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import { parseRestructurePlan, type ParsedRestructurePlan } from "./agents/parsers/restructure-plan.js"
import { MetaPaths } from "./paths.js"

export interface RestructureWriteResult {
  success: boolean
  restructureId?: string
  filePath?: string
  error?: string
}

export function handleRestructureOutput(cwd: string, output: string | ParsedRestructurePlan): RestructureWriteResult {
  const parsed = typeof output === "string" ? parseRestructurePlan(output) : output
  if (!parsed) {
    return {
      success: false,
      error: "Failed to parse restructure plan from output",
    }
  }

  try {
    const restructureId = generateRestructureId(cwd)
    const restructure = {
      id: restructureId,
      triggered_by: "quality_threshold",
      created_by: "sota_model",
      created_at: new Date().toISOString(),
      diagnosis: parsed.diagnosis,
      restructure_plan: parsed.restructure_plan,
      docs_to_update: parsed.docs_to_update,
      acceptance: parsed.acceptance,
      status: "pending",
    }

    // 确保目录存在
    const restructuresDir = MetaPaths.restructures(cwd)
    if (!fs.existsSync(restructuresDir)) {
      fs.mkdirSync(restructuresDir, { recursive: true })
    }

    const filePath = path.join(restructuresDir, `${restructureId}.yaml`)
    fs.writeFileSync(filePath, yaml.dump(restructure, { lineWidth: 100 }))

    return {
      success: true,
      restructureId,
      filePath,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function generateRestructureId(cwd: string): string {
  const restructuresDir = MetaPaths.restructures(cwd)
  if (!fs.existsSync(restructuresDir)) {
    return "RESTRUCTURE-001"
  }

  const files = fs.readdirSync(restructuresDir)
    .filter(f => f.startsWith("RESTRUCTURE-") && f.endsWith(".yaml"))
    .map(f => parseInt(f.replace("RESTRUCTURE-", "").replace(".yaml", ""), 10))
    .filter(n => !isNaN(n))

  const next = files.length ? Math.max(...files) + 1 : 1
  return `RESTRUCTURE-${String(next).padStart(3, "0")}`
}

export function formatRestructureResult(result: RestructureWriteResult): string {
  if (result.success) {
    return `✅ Restructure plan written: ${result.restructureId}\n   File: ${result.filePath}`
  } else {
    return `❌ Failed to write restructure plan: ${result.error}`
  }
}
