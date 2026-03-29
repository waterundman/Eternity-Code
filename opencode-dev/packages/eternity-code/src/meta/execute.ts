import path from "path"
import fs from "fs"
import yaml from "js-yaml"
import { planCard } from "./execution/planner.js"
import type {
  ExecutionPlan,
  ExecutionTask,
  ExecutionPreflightSummary,
  PlanPreflight,
  PreflightStatus,
  TaskPreflight,
  TaskResult,
  PlanResult,
  ExecutionOptionsBase,
} from "./execution/types.js"
import { findLatestAcceptedLoop, loadLoopCards, loadLoopRecords, updateLoopExecutionPlan } from "./loop.js"
import { listMetaEntryPaths, resolveMetaDirectory, resolveMetaEntryPath } from "./paths.js"

const PREVIEW_LIMIT = 5
const GLOB_PATTERN = /[*?[\]{}]/

export interface ExecutePlanningResult {
  loopId: string
  acceptedCards: string[]
  createdPlans: ExecutionPlan[]
  reusedPlans: ExecutionPlan[]
  planIds: string[]
  summary: string
  preflight: ExecutionPreflightSummary
}

export function loadExecutionPlans(cwd: string): ExecutionPlan[] {
  return listMetaEntryPaths(cwd, "plans", ".yaml")
    .map((filePath) => readYamlFile<ExecutionPlan>(filePath))
    .filter((plan): plan is ExecutionPlan => Boolean(plan?.id))
    .sort((a, b) => {
      const timeA = a.created_at ?? ""
      const timeB = b.created_at ?? ""
      if (timeA !== timeB) return timeB.localeCompare(timeA)
      return b.id.localeCompare(a.id)
    })
}

export function loadExecutionPlansForLoop(cwd: string, loopId: string): ExecutionPlan[] {
  return loadExecutionPlans(cwd).filter((plan) => plan.loop_id === loopId)
}

export async function planAcceptedCardsForLoop(
  cwd: string,
  options: {
    loopId?: string
    session?: import("./types.js").Session
  } = {},
): Promise<ExecutePlanningResult> {
  const targetLoop = options.loopId
    ? loadLoopRecords(cwd).find((loop) => loop.id === options.loopId)
    : findLatestAcceptedLoop(cwd)
  if (!targetLoop?.id) {
    throw new Error(options.loopId ? `Loop not found: ${options.loopId}` : "No accepted loop found")
  }

  const acceptedCards = [...new Set(targetLoop.decision_session?.accepted_cards ?? [])]
  if (acceptedCards.length === 0) {
    throw new Error(`No accepted cards found for ${targetLoop.id}`)
  }

  const cards = loadLoopCards(cwd, targetLoop)
  const cardIds = new Set(cards.map((card) => card.id))
  const missingCards = acceptedCards.filter((cardId) => !cardIds.has(cardId))
  if (missingCards.length > 0) {
    throw new Error(`Accepted cards missing on disk: ${missingCards.join(", ")}`)
  }

  const existingPlans = loadExecutionPlans(cwd)
  const createdPlans: ExecutionPlan[] = []
  const reusedPlans: ExecutionPlan[] = []

  for (const cardId of acceptedCards) {
    const existingPlan = existingPlans.find((plan) => plan.loop_id === targetLoop.id && plan.card_id === cardId)
    if (existingPlan) {
      reusedPlans.push(existingPlan)
      continue
    }

    const createdPlan = await planCard(cwd, cardId, targetLoop.id, options.session)
    createdPlans.push(createdPlan)
    existingPlans.unshift(createdPlan)
  }

  const allPlans = [...reusedPlans, ...createdPlans]
  const preflight = runExecutionPreflight(cwd, allPlans)
  const byId = new Map(preflight.plans.map((plan) => [plan.id, plan]))
  const hydratedCreatedPlans = createdPlans.map((plan) => byId.get(plan.id) ?? plan)
  const hydratedReusedPlans = reusedPlans.map((plan) => byId.get(plan.id) ?? plan)
  const planIds = preflight.plans.map((plan) => plan.id)
  const planningSummary =
    createdPlans.length > 0
      ? `Execution plans prepared for ${targetLoop.id}: ${createdPlans.length} created, ${reusedPlans.length} reused`
      : `Execution plans refreshed for ${targetLoop.id}: ${reusedPlans.length} reused`
  const summary = `${planningSummary}. ${preflight.summary}`

  await updateLoopExecutionPlan(cwd, targetLoop.id, {
    planIds,
    plannedCards: acceptedCards,
    summary,
    preflight: {
      status: preflight.status,
      readyPlans: preflight.readyPlans,
      warningPlans: preflight.warningPlans,
      blockedPlans: preflight.blockedPlans,
      warnings: preflight.warnings,
      blockers: preflight.blockers,
    },
  })

  return {
    loopId: targetLoop.id,
    acceptedCards,
    createdPlans: hydratedCreatedPlans,
    reusedPlans: hydratedReusedPlans,
    planIds,
    summary,
    preflight,
  }
}

function runExecutionPreflight(cwd: string, plans: ExecutionPlan[]): ExecutionPreflightSummary {
  const updatedPlans = plans.map((plan) => applyPlanPreflight(cwd, plan))
  for (const plan of updatedPlans) {
    writeExecutionPlan(cwd, plan)
  }

  const readyPlans = updatedPlans.filter((plan) => plan.preflight?.status === "ready").length
  const warningPlans = updatedPlans.filter((plan) => plan.preflight?.status === "warning").length
  const blockedPlans = updatedPlans.filter((plan) => plan.preflight?.status === "blocked").length
  const warnings = collectPreview(
    updatedPlans.flatMap((plan) => (plan.preflight?.warnings ?? []).map((item) => `${plan.id}: ${item}`)),
  )
  const blockers = collectPreview(
    updatedPlans.flatMap((plan) => (plan.preflight?.blockers ?? []).map((item) => `${plan.id}: ${item}`)),
  )
  const status: PreflightStatus = blockedPlans > 0 ? "blocked" : warningPlans > 0 ? "warning" : "ready"
  const summary = `Preflight ${status.toUpperCase()}: ${readyPlans} ready, ${warningPlans} warning, ${blockedPlans} blocked`

  return {
    status,
    readyPlans,
    warningPlans,
    blockedPlans,
    warnings,
    blockers,
    plans: updatedPlans,
    summary,
  }
}

function applyPlanPreflight(cwd: string, plan: ExecutionPlan): ExecutionPlan {
  const taskIds = new Set(plan.tasks.map((task) => task.id))
  const cycleTaskIds = detectDependencyCycles(plan.tasks)
  const checkedAt = new Date().toISOString()

  let tasks = plan.tasks.map((task) => {
    const nextTask = applyTaskPreflight(cwd, task, taskIds, cycleTaskIds)
    return nextTask
  })

  const targetOwners = new Map<string, string[]>()
  for (const task of tasks) {
    for (const file of task.preflight?.touched_files ?? []) {
      targetOwners.set(file, [...(targetOwners.get(file) ?? []), task.id])
    }
  }

  const duplicateTargets = [...targetOwners.entries()]
    .filter(([, taskList]) => taskList.length > 1)
    .map(([file]) => file)
    .sort()

  tasks = tasks.map((task) => {
    const sharedTargets = (task.preflight?.touched_files ?? []).filter((file) => duplicateTargets.includes(file))
    if (sharedTargets.length === 0 || !task.preflight) return task

    const warnings = uniqueStrings([
      ...task.preflight.warnings,
      `Shares target files with another task: ${sharedTargets.join(", ")}`,
    ])
    const status: PreflightStatus = task.preflight.blockers.length > 0 ? "blocked" : "warning"

    return {
      ...task,
      preflight: {
        ...task.preflight,
        status,
        warnings,
        summary: summarizeTaskPreflight(status, warnings.length, task.preflight.blockers.length, task.preflight.touched_files.length),
      },
    }
  })

  const taskWarnings = tasks.filter((task) => task.preflight?.status === "warning").length
  const taskBlockers = tasks.filter((task) => task.preflight?.status === "blocked").length
  const taskReady = tasks.filter((task) => task.preflight?.status === "ready").length
  const touchedFiles = uniqueStrings(tasks.flatMap((task) => task.preflight?.touched_files ?? [])).sort()
  const existingFiles = uniqueStrings(tasks.flatMap((task) => task.preflight?.existing_files ?? [])).sort()
  const newFiles = uniqueStrings(tasks.flatMap((task) => task.preflight?.new_files ?? [])).sort()

  const warnings: string[] = []
  const blockers: string[] = []

  if (!plan.interpretation?.trim()) {
    warnings.push("Plan interpretation is empty.")
  }
  if (tasks.length === 0) {
    blockers.push("Plan contains no tasks.")
  }
  if (duplicateTargets.length > 0) {
    warnings.push(`Multiple tasks touch the same files: ${duplicateTargets.join(", ")}`)
  }
  if (touchedFiles.length === 0 && tasks.length > 0) {
    warnings.push("No concrete files_to_modify targets were declared across the plan.")
  }
  if (taskWarnings > 0) {
    warnings.push(`${taskWarnings} task(s) require review before implementation.`)
  }
  if (taskBlockers > 0) {
    blockers.push(`${taskBlockers} task(s) are blocked by invalid targets or dependencies.`)
  }

  const status: PreflightStatus = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready"
  const preflight: PlanPreflight = {
    status,
    checked_at: checkedAt,
    summary: summarizePlanPreflight(status, taskReady, taskWarnings, taskBlockers, touchedFiles.length),
    warnings: uniqueStrings(warnings),
    blockers: uniqueStrings(blockers),
    touched_files: touchedFiles,
    existing_files: existingFiles,
    new_files: newFiles,
    duplicate_targets: duplicateTargets,
    tasks_total: tasks.length,
    tasks_ready: taskReady,
    tasks_warning: taskWarnings,
    tasks_blocked: taskBlockers,
  }

  return {
    ...plan,
    tasks,
    preflight,
  }
}

function applyTaskPreflight(
  cwd: string,
  task: ExecutionTask,
  taskIds: Set<string>,
  cycleTaskIds: Set<string>,
): ExecutionTask {
  const warnings: string[] = []
  const blockers: string[] = []
  const touchedFiles: string[] = []
  const existingFiles: string[] = []
  const newFiles: string[] = []
  const files = Array.isArray(task.spec.files_to_modify) ? task.spec.files_to_modify : []

  if (files.length === 0) {
    warnings.push("No files_to_modify declared.")
  }

  for (const rawFile of files) {
    const normalized = normalizeTaskTarget(cwd, rawFile)
    if (normalized.blocker) {
      blockers.push(normalized.blocker)
      continue
    }
    if (!normalized.relative) continue

    touchedFiles.push(normalized.relative)
    if (normalized.warning) warnings.push(normalized.warning)
    if (normalized.exists) existingFiles.push(normalized.relative)
    else newFiles.push(normalized.relative)

    if (normalized.relative === ".git" || normalized.relative.startsWith(".git/")) {
      blockers.push(`Refuses to modify git internals: ${normalized.relative}`)
    }
    if (normalized.relative === "node_modules" || normalized.relative.startsWith("node_modules/")) {
      blockers.push(`Refuses to modify installed dependency output: ${normalized.relative}`)
    }
    if (normalized.relative === ".meta" || normalized.relative.startsWith(".meta/")) {
      warnings.push(`Touches MetaDesign runtime files: ${normalized.relative}`)
    }
  }

  const dependencies = Array.isArray(task.depends_on) ? task.depends_on : []
  const unknownDependencies = dependencies.filter((dependency) => !taskIds.has(dependency))
  if (unknownDependencies.length > 0) {
    blockers.push(`Unknown dependency task ids: ${unknownDependencies.join(", ")}`)
  }
  if (dependencies.includes(task.id)) {
    blockers.push("Task cannot depend on itself.")
  }
  if (cycleTaskIds.has(task.id)) {
    blockers.push("Task is part of a dependency cycle.")
  }

  const uniqueTouchedFiles = uniqueStrings(touchedFiles)
  const uniqueExistingFiles = uniqueStrings(existingFiles)
  const uniqueNewFiles = uniqueStrings(newFiles)
  const status: PreflightStatus = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready"
  const preflight: TaskPreflight = {
    status,
    summary: summarizeTaskPreflight(status, warnings.length, blockers.length, uniqueTouchedFiles.length),
    warnings: uniqueStrings(warnings),
    blockers: uniqueStrings(blockers),
    touched_files: uniqueTouchedFiles,
    existing_files: uniqueExistingFiles,
    new_files: uniqueNewFiles,
  }

  return {
    ...task,
    preflight,
  }
}

function normalizeTaskTarget(
  cwd: string,
  rawTarget: string,
): {
  relative?: string
  exists?: boolean
  warning?: string
  blocker?: string
} {
  const target = String(rawTarget ?? "").trim()
  if (!target) {
    return {
      blocker: "Encountered an empty files_to_modify entry.",
    }
  }

  if (GLOB_PATTERN.test(target)) {
    return {
      blocker: `Target must be a concrete repository-relative path, not a glob: ${target}`,
    }
  }

  const absolute = path.resolve(cwd, target)
  const relative = toPortablePath(path.relative(cwd, absolute))
  if (!relative || relative === "." || relative === "") {
    return {
      blocker: `Target resolves to the repository root instead of a file: ${target}`,
    }
  }
  if (relative === ".." || relative.startsWith("../")) {
    return {
      blocker: `Target escapes the repository root: ${target}`,
    }
  }

  const exists = fs.existsSync(absolute)
  if (exists && fs.statSync(absolute).isDirectory()) {
    return {
      blocker: `Target resolves to a directory, not a file: ${relative}`,
    }
  }

  return {
    relative,
    exists,
    warning: path.isAbsolute(target) ? `Target should be repository-relative: ${toPortablePath(target)}` : undefined,
  }
}

function detectDependencyCycles(tasks: ExecutionTask[]): Set<string> {
  const adjacency = new Map<string, string[]>()
  for (const task of tasks) {
    adjacency.set(task.id, Array.isArray(task.depends_on) ? task.depends_on : [])
  }

  const cycleIds = new Set<string>()
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(taskId: string, trail: string[]) {
    if (visited.has(taskId)) return
    if (visiting.has(taskId)) {
      const cycleStart = trail.indexOf(taskId)
      const cycleTrail = cycleStart === -1 ? trail : trail.slice(cycleStart)
      for (const cycleTask of cycleTrail) {
        cycleIds.add(cycleTask)
      }
      cycleIds.add(taskId)
      return
    }

    visiting.add(taskId)
    const nextTrail = [...trail, taskId]
    for (const dependency of adjacency.get(taskId) ?? []) {
      if (!adjacency.has(dependency)) continue
      visit(dependency, nextTrail)
    }
    visiting.delete(taskId)
    visited.add(taskId)
  }

  for (const task of tasks) {
    visit(task.id, [])
  }

  return cycleIds
}

function summarizeTaskPreflight(
  status: PreflightStatus,
  warningCount: number,
  blockerCount: number,
  touchedFileCount: number,
) {
  return `${status.toUpperCase()}: ${touchedFileCount} target(s), ${warningCount} warning(s), ${blockerCount} blocker(s)`
}

function summarizePlanPreflight(
  status: PreflightStatus,
  readyTasks: number,
  warningTasks: number,
  blockedTasks: number,
  touchedFileCount: number,
) {
  return `${status.toUpperCase()}: ${readyTasks} ready, ${warningTasks} warning, ${blockedTasks} blocked tasks across ${touchedFileCount} file target(s)`
}

function writeExecutionPlan(cwd: string, plan: ExecutionPlan) {
  const planDir = resolveMetaDirectory(cwd, "plans")
  if (!fs.existsSync(planDir)) fs.mkdirSync(planDir, { recursive: true })
  const planPath = resolveMetaEntryPath(cwd, "plans", `${plan.id}.yaml`)
  fs.writeFileSync(planPath, yaml.dump(plan, { lineWidth: 120 }))
}

function collectPreview(values: string[]) {
  return uniqueStrings(values).slice(0, PREVIEW_LIMIT)
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function toPortablePath(value: string) {
  return value.replaceAll("\\", "/")
}

function readYamlFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null
  return yaml.load(fs.readFileSync(filePath, "utf8")) as T
}

// ============================================================================
// Execution Functions
// ============================================================================

/**
 * 执行选项（继承自基础选项）
 * 用于 executePlan 和 executeTask 函数
 */
export interface ExecutionOptions extends ExecutionOptionsBase {
  session?: import("./types.js").Session
}

export async function executePlan(
  cwd: string,
  planId: string,
  options: ExecutionOptions = {},
): Promise<PlanResult> {
  const { executePlan: executorExecutePlan } = await import("./execution/executor.js")
  return executorExecutePlan(cwd, planId, options)
}

export async function executeTask(
  cwd: string,
  planId: string,
  taskId: string,
  options: ExecutionOptions = {},
): Promise<TaskResult> {
  const { executeTask: executorExecuteTask } = await import("./execution/executor.js")
  return executorExecuteTask(cwd, planId, taskId, options)
}

export async function rollbackPlan(cwd: string, planId: string): Promise<void> {
  const { ExecutionExecutor } = await import("./execution/executor.js")
  const executor = new ExecutionExecutor({ cwd, planId })
  await executor.rollback()
}
