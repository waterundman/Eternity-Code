/**
 * Plan Parser
 *
 * 解析planner角色的输出
 */

import yaml from "js-yaml"

export interface PlanTask {
  title: string
  description: string
  files_to_modify: string[]
  definition_of_done: string
  must_not: string[]
  depends_on: string[]
}

export interface PlanOutput {
  interpretation: string
  tasks: PlanTask[]
}

export function parsePlan(text: string): PlanOutput {
  const planBlock = text.match(/---PLAN START---([\s\S]*?)---PLAN END---/)
  const interpretation = planBlock?.[1]?.match(/interpretation:\s*(.+)/)?.[1]?.trim() ?? ""

  const taskBlocks = text.split("---TASK START---").slice(1)
  const tasks: PlanTask[] = []

  for (const block of taskBlocks) {
    const end = block.indexOf("---TASK END---")
    if (end === -1) continue

    try {
      const parsed = yaml.load(block.slice(0, end).trim()) as any
      if (!parsed?.title) continue

      tasks.push({
        title: parsed.title,
        description: parsed.description ?? "",
        files_to_modify: parsed.files_to_modify ?? [],
        definition_of_done: parsed.definition_of_done ?? "",
        must_not: parsed.must_not ?? [],
        depends_on: parsed.depends_on ?? [],
      })
    } catch {
      // Ignore malformed task blocks
    }
  }

  return { interpretation, tasks }
}
