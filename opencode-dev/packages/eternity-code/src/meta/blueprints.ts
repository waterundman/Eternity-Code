/**
 * Blueprints Module
 *
 * 当前阶段的整体执行意图。不是 task 列表，是方向声明。
 * SOTA 模型写蓝图，弱模型读蓝图执行。
 * 蓝图是两个模型之间的接口合约。
 */

import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import { MetaPaths } from "./paths.js"

/**
 * 模型假设
 * 记录 harness 组件背后的模型能力假设
 */
export interface ModelAssumption {
  component: string
  assumption: string
  evidence: string
  test_command: string
  last_tested: string
  model_version: string
  status: "confirmed" | "assumed" | "invalidated"
}

export interface Blueprint {
  version: string
  created_at: string
  created_by: string
  supersedes?: string
  valid_until?: string
  current_state: string
  priorities: Array<{
    id: string
    goal: string
    rationale: string
    acceptance: string
  }>
  constraints: string[]
  known_debt: string[]
  model_assumptions?: ModelAssumption[]
}

export function loadCurrentBlueprint(cwd: string): Blueprint | null {
  const p = MetaPaths.current(cwd)
  if (!fs.existsSync(p)) return null
  try {
    return yaml.load(fs.readFileSync(p, "utf8")) as Blueprint
  } catch {
    return null
  }
}

export function loadAllBlueprints(cwd: string): Blueprint[] {
  const dir = MetaPaths.blueprints(cwd)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yaml") && f !== "BLUEPRINT-current.yaml")
    .sort()
    .reverse()
    .map(f => {
      try {
        return yaml.load(fs.readFileSync(path.join(dir, f), "utf8")) as Blueprint
      } catch {
        return null
      }
    })
    .filter((b): b is Blueprint => b !== null)
}

export function writeBlueprint(cwd: string, blueprint: Blueprint): void {
  const dir = MetaPaths.blueprints(cwd)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const date = blueprint.created_at.slice(0, 10).replace(/-/g, "")
  const archivePath = path.join(dir, `BLUEPRINT-${date}.yaml`)
  const currentPath = MetaPaths.current(cwd)

  const content = yaml.dump(blueprint, { lineWidth: 100 })
  fs.writeFileSync(archivePath, content)
  fs.writeFileSync(currentPath, content)
}

export function buildBlueprintContext(cwd: string): string {
  const blueprint = loadCurrentBlueprint(cwd)
  if (!blueprint) return ""

  const lines: string[] = []
  lines.push(`\n[来自 cognition/blueprints/]`)
  lines.push(`Current blueprint (${blueprint.version}, ${blueprint.created_at.slice(0, 10)}):`)
  lines.push(`  State: ${blueprint.current_state.split('\n')[0]}`)
  blueprint.priorities.forEach(p => {
    lines.push(`  ${p.id}: ${p.goal}`)
  })
  if (blueprint.constraints.length) {
    lines.push(`  Constraints:`)
    blueprint.constraints.forEach(c => lines.push(`    • ${c}`))
  }

  // 添加模型假设上下文
  if (blueprint.model_assumptions?.length) {
    const confirmed = blueprint.model_assumptions.filter(a => a.status === "confirmed")
    const assumed = blueprint.model_assumptions.filter(a => a.status === "assumed")
    const invalidated = blueprint.model_assumptions.filter(a => a.status === "invalidated")

    if (confirmed.length) {
      lines.push(`  Confirmed assumptions:`)
      confirmed.forEach(a => lines.push(`    ✓ ${a.component}: ${a.assumption.slice(0, 60)}...`))
    }
    if (assumed.length) {
      lines.push(`  Assumed (needs testing):`)
      assumed.forEach(a => lines.push(`    ? ${a.component}: ${a.assumption.slice(0, 60)}...`))
    }
    if (invalidated.length) {
      lines.push(`  Invalidated (can be simplified):`)
      invalidated.forEach(a => lines.push(`    ✗ ${a.component}: ${a.assumption.slice(0, 60)}...`))
    }
  }

  return lines.join("\n")
}

/**
 * 添加模型假设
 */
export function addModelAssumption(
  cwd: string,
  assumption: Omit<ModelAssumption, "last_tested">
): void {
  const blueprint = loadCurrentBlueprint(cwd)
  if (!blueprint) return

  const newAssumption: ModelAssumption = {
    ...assumption,
    last_tested: new Date().toISOString().slice(0, 10),
  }

  if (!blueprint.model_assumptions) {
    blueprint.model_assumptions = []
  }

  blueprint.model_assumptions.push(newAssumption)
  writeBlueprint(cwd, blueprint)
}

/**
 * 更新模型假设状态
 */
export function updateAssumptionStatus(
  cwd: string,
  component: string,
  status: "confirmed" | "assumed" | "invalidated"
): void {
  const blueprint = loadCurrentBlueprint(cwd)
  if (!blueprint?.model_assumptions) return

  blueprint.model_assumptions = blueprint.model_assumptions.map(a =>
    a.component === component
      ? { ...a, status, last_tested: new Date().toISOString().slice(0, 10) }
      : a
  )

  writeBlueprint(cwd, blueprint)
}

/**
 * 获取需要测试的假设
 */
export function getUntestedAssumptions(cwd: string): ModelAssumption[] {
  const blueprint = loadCurrentBlueprint(cwd)
  if (!blueprint?.model_assumptions) return []

  return blueprint.model_assumptions.filter(a => a.status === "assumed")
}

/**
 * 获取已失效的假设（可以简化的 harness 组件）
 */
export function getInvalidatedAssumptions(cwd: string): ModelAssumption[] {
  const blueprint = loadCurrentBlueprint(cwd)
  if (!blueprint?.model_assumptions) return []

  return blueprint.model_assumptions.filter(a => a.status === "invalidated")
}
