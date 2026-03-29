/**
 * Restructure Executor
 *
 * 执行重构方案，生成重构计划文件。
 */

import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import { MetaPaths } from "./paths.js"
import { loadCurrentBlueprint } from "./blueprints.js"
import { writeBlueprint } from "./blueprints.js"

export interface RestructureExecutionResult {
  success: boolean
  restructureId?: string
  blueprintUpdated?: boolean
  error?: string
}

export async function executeRestructure(
  cwd: string,
  restructureId: string,
  session: any
): Promise<RestructureExecutionResult> {
  const restructurePath = path.join(MetaPaths.restructures(cwd), `${restructureId}.yaml`)

  if (!fs.existsSync(restructurePath)) {
    return {
      success: false,
      error: `Restructure not found: ${restructureId}`,
    }
  }

  try {
    const restructure = yaml.load(fs.readFileSync(restructurePath, "utf8")) as any

    // 更新 restructure 状态
    restructure.status = "executing"
    restructure.executed_at = new Date().toISOString()
    fs.writeFileSync(restructurePath, yaml.dump(restructure, { lineWidth: 100 }))

    // 生成执行计划
    const executionPlan = generateExecutionPlan(restructure)

    // 更新蓝图
    const currentBlueprint = loadCurrentBlueprint(cwd)
    if (currentBlueprint) {
      const newBlueprint = {
        ...currentBlueprint,
        created_at: new Date().toISOString(),
        created_by: "sota_model",
        supersedes: currentBlueprint.version,
        current_state: `Restructure ${restructureId} executed. New architecture implemented.`,
        priorities: [
          ...currentBlueprint.priorities,
          ...restructure.acceptance.map((acc: string, i: number) => ({
            id: `P${currentBlueprint.priorities.length + i + 1}`,
            goal: acc,
            rationale: "Generated from restructure plan",
            acceptance: acc,
          })),
        ],
        known_debt: [
          ...currentBlueprint.known_debt,
          ...restructure.diagnosis.primary_issues,
        ],
      }

      writeBlueprint(cwd, newBlueprint)
    }

    // 更新 restructure 状态为完成
    restructure.status = "completed"
    restructure.completed_at = new Date().toISOString()
    restructure.execution_plan = executionPlan
    fs.writeFileSync(restructurePath, yaml.dump(restructure, { lineWidth: 100 }))

    return {
      success: true,
      restructureId,
      blueprintUpdated: true,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function generateExecutionPlan(restructure: any): any {
  const plan = {
    approach: restructure.restructure_plan?.approach ?? "targeted_refactor",
    scope: restructure.restructure_plan?.scope ?? [],
    preserve: restructure.restructure_plan?.preserve ?? [],
    tasks: [] as any[],
  }

  // 根据范围生成任务
  for (const scope of plan.scope) {
    plan.tasks.push({
      id: `task-${plan.tasks.length + 1}`,
      description: `Restructure ${scope}`,
      status: "pending",
      estimated_effort: "high",
    })
  }

  // 添加文档更新任务
  for (const doc of restructure.docs_to_update ?? []) {
    plan.tasks.push({
      id: `task-${plan.tasks.length + 1}`,
      description: `Update ${doc}`,
      status: "pending",
      estimated_effort: "medium",
    })
  }

  return plan
}

export function formatRestructureExecutionResult(result: RestructureExecutionResult): string {
  if (result.success) {
    let output = `✅ Restructure ${result.restructureId} executed successfully\n`
    if (result.blueprintUpdated) {
      output += `   Blueprint updated with new priorities`
    }
    return output
  } else {
    return `❌ Failed to execute restructure: ${result.error}`
  }
}
