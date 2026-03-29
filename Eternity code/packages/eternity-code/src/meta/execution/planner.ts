import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { ExecutionPlan, PlannerOutput } from "./types.js"
import type { Session } from "../types.js"
import { loadMetaDesign, buildSystemContext } from "../design.js"
import { Dispatcher } from "../agents/dispatcher.js"
import { parsePlan } from "../agents/parsers/plan.js"
import { getCurrentBranch, getGitHead } from "./git.js"
import { listMetaEntryNames, resolveMetaDirectory, resolveMetaEntryPath } from "../paths.js"

const PLANNER_SYSTEM_PROMPT = `You are an execution planner for MetaDesign cards.

Convert one accepted card into a small execution plan with 3 to 5 atomic tasks.

Rules:
- Each task should be independently executable.
- definition_of_done must be concrete and verifiable.
- must_not must define the boundaries of the task.
- Do not write code in the plan.
- Return only the requested plan format.`

export async function planCard(
  cwd: string,
  cardId: string,
  loopId: string,
  session?: Session,
): Promise<ExecutionPlan> {
  const design = await loadMetaDesign(cwd)
  const cardPath = resolveMetaEntryPath(cwd, "cards", `${cardId}.yaml`)
  const card = yaml.load(fs.readFileSync(cardPath, "utf8")) as any

  const planDir = resolveMetaDirectory(cwd, "plans")
  if (!fs.existsSync(planDir)) fs.mkdirSync(planDir, { recursive: true })
  const existingPlans = listMetaEntryNames(cwd, "plans", ".yaml").length
  const planId = `PLAN-${String(existingPlans + 1).padStart(3, "0")}`

  // 使用 dispatcher 调用 planner 角色
  let parsedPlan: PlannerOutput | undefined
  if (session) {
    try {
      const dispatcher = new Dispatcher({ cwd, session })
      const result = await dispatcher.dispatch<PlannerOutput>(
        "planner",
        { card: yaml.dump(card), planId },
        loopId
      )
      if (result && result.tasks && result.tasks.length > 0) {
        parsedPlan = result
      }
    } catch (err) {
      console.error("[Planner] Dispatcher call failed, falling back to direct call:", err)
    }
  }

  // 回退到直接调用
  if (!parsedPlan) {
    const metaContext = design ? buildSystemContext(design) : ""
    const plannerPrompt = buildPlannerPrompt(card, planId, metaContext)
    const response = await callPlannerAgent(session, PLANNER_SYSTEM_PROMPT, plannerPrompt)
    parsedPlan = response ? parsePlanFromText(extractText(response)) : undefined
  }

  const rawPlan = parsedPlan && parsedPlan.tasks.length > 0 ? parsedPlan : generateMockPlanFromCard(card)

  const plan: ExecutionPlan = {
    id: planId,
    card_id: cardId,
    loop_id: loopId,
    interpretation: rawPlan.interpretation,
    tasks: rawPlan.tasks.map((task, index) => ({
      id: `${planId}-${String(index + 1).padStart(2, "0")}`,
      plan_id: planId,
      card_id: cardId,
      sequence: index + 1,
      spec: {
        title: task.title,
        description: task.description,
        files_to_modify: task.files_to_modify,
        definition_of_done: task.definition_of_done,
        must_not: task.must_not,
      },
      depends_on: task.depends_on,
      status: "pending",
    })),
    status: "pending",
    git_sha_before: getGitHead(cwd),
    git_branch_before: getCurrentBranch(cwd),
    created_at: new Date().toISOString(),
  }

  const planPath = resolveMetaEntryPath(cwd, "plans", `${planId}.yaml`)
  fs.writeFileSync(planPath, yaml.dump(plan, { lineWidth: 120 }))

  return plan
}

async function callPlannerAgent(
  session: Session | undefined,
  systemPrompt: string,
  userMessage: string,
): Promise<string | undefined> {
  try {
    if (session?.createSubtask) {
      const result = await session.createSubtask({ systemPrompt, userMessage })
      return extractText(result)
    }

    if (session?.prompt) {
      const result = await session.prompt({
        system: systemPrompt,
        message: userMessage,
      })
      return extractText(result)
    }

    return undefined
  } catch (err) {
    console.error("[Planner] Failed to call agent:", err)
    return undefined
  }
}

function buildPlannerPrompt(card: any, planId: string, metaContext: string): string {
  const objective = String(card.content?.objective ?? "No objective provided")
  const approach = String(card.content?.approach ?? "No approach provided")
  const risk = String(card.content?.risk ?? "No risk provided")
  const scope = Array.isArray(card.content?.scope) ? card.content.scope.join(", ") : "Not specified"

  return `${metaContext}

---

Create execution plan ${planId} for this accepted MetaDesign card.

Objective: ${objective}
Approach: ${approach}
Scope: ${scope}
Risk: ${risk}

Return only this structure:

---PLAN START---
interpretation: one short paragraph
---PLAN END---

---TASK START---
title: short task title
description: detailed execution description
files_to_modify:
  - path/to/file
definition_of_done: verifiable completion condition
must_not:
  - explicit boundary
depends_on: []
---TASK END---`
}

function parsePlanFromText(text: string): PlannerOutput {
  const planBlock = text.match(/---PLAN START---([\s\S]*?)---PLAN END---/)
  const interpretation = planBlock?.[1]?.match(/interpretation:\s*(.+)/)?.[1]?.trim() ?? ""

  const taskBlocks = text.split("---TASK START---").slice(1)
  const tasks: PlannerOutput["tasks"] = []

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
      // Ignore malformed task blocks and fall back if nothing useful remains.
    }
  }

  return { interpretation, tasks }
}

function extractText(response: unknown): string {
  if (typeof response === "string") return response
  const value = response as any
  if (typeof value?.text === "string") return value.text
  if (Array.isArray(value?.content)) return value.content.map((part: any) => part?.text ?? "").join("\n")
  return String(response)
}

function generateMockPlanFromCard(card: any): PlannerOutput {
  const objective = String(card.content?.objective ?? "Implement the accepted card")
  const approach = String(card.content?.approach ?? "Apply the accepted improvement")
  const risk = String(card.content?.risk ?? "Avoid regressions outside the accepted scope")
  const filesToModify = Array.isArray(card.content?.scope)
    ? card.content.scope.filter((value: unknown): value is string => typeof value === "string")
    : []

  return {
    interpretation:
      "Break the accepted card into a safe three-step plan: inspect the current implementation, apply the scoped change, and verify the affected surface before evaluation.",
    tasks: [
      {
        title: "Inspect current flow",
        description: `Review the current implementation for "${objective}" and confirm how the proposed approach "${approach}" fits into the existing architecture.`,
        files_to_modify: [],
        definition_of_done: "The affected code path, constraints, and implementation approach are clear before editing.",
        must_not: ["Do not modify files during the inspection step."],
        depends_on: [],
      },
      {
        title: "Implement accepted card",
        description:
          "Apply the accepted card objective and approach in the scoped code path. Keep the change aligned with the card intent and minimize unrelated edits.",
        files_to_modify: filesToModify,
        definition_of_done: "The accepted behavior is implemented and the relevant code paths reflect the intended change.",
        must_not: [
          `Do not ignore this card risk: ${risk}`,
          "Do not modify unrelated files, APIs, or behaviors unless they are required by the scoped change.",
        ],
        depends_on: [],
      },
      {
        title: "Verify changed surface",
        description:
          "Run the relevant checks for the touched surface and confirm the change behaves as intended without obvious regressions.",
        files_to_modify: [],
        definition_of_done: "The relevant verification steps are completed and any remaining risk is clearly documented.",
        must_not: ["Do not skip verification for the modified surface area."],
        depends_on: [],
      },
    ],
  }
}
