/**
 * GSD (Goal-Signal-Done) execution types.
 *
 * Plan: one accepted card decomposed into a small local execution plan.
 * Task: the smallest reviewable unit inside a plan.
 * Preflight: a safe local readiness check performed before any code execution.
 */

export type PreflightStatus = "ready" | "warning" | "blocked"

/**
 * 基础执行选项（不包含 cwd 和 planId）
 * 用于在不同模块间共享执行配置
 */
export interface ExecutionOptionsBase {
  autoCommit?: boolean
  dryRun?: boolean
  autoRollback?: boolean
  onTaskStart?: (task: ExecutionTask) => void
  onTaskComplete?: (task: ExecutionTask, result: TaskResult) => void
  onTaskConfirm?: (task: ExecutionTask, diff: string) => Promise<boolean>
  onRollback?: (reason: string, error?: string) => void
}

export interface TaskPreflight {
  status: PreflightStatus
  summary: string
  warnings: string[]
  blockers: string[]
  touched_files: string[]
  existing_files: string[]
  new_files: string[]
}

export interface PlanPreflight {
  status: PreflightStatus
  checked_at: string
  summary: string
  warnings: string[]
  blockers: string[]
  touched_files: string[]
  existing_files: string[]
  new_files: string[]
  duplicate_targets: string[]
  tasks_total: number
  tasks_ready: number
  tasks_warning: number
  tasks_blocked: number
}

export interface ExecutionPreflightSummary {
  status: PreflightStatus
  readyPlans: number
  warningPlans: number
  blockedPlans: number
  warnings: string[]
  blockers: string[]
  plans: ExecutionPlan[]
  summary: string
}

export interface ExecutionTask {
  id: string
  plan_id: string
  card_id: string
  sequence: number
  spec: {
    title: string
    description: string
    files_to_modify: string[]
    definition_of_done: string
    must_not: string[]
  }
  depends_on: string[]
  status: "pending" | "running" | "done" | "failed" | "skipped"
  preflight?: TaskPreflight
  git_sha?: string
  error?: string
  started_at?: string
  completed_at?: string
}

export interface ExecutionPlan {
  id: string
  card_id: string
  loop_id: string
  interpretation: string
  tasks: ExecutionTask[]
  status: "pending" | "running" | "done" | "failed" | "rolled_back"
  preflight?: PlanPreflight
  git_sha_before: string
  git_branch_before?: string
  git_sha_after?: string
  created_at: string
  completed_at?: string
}

export interface PlannerOutput {
  interpretation: string
  tasks: Array<{
    title: string
    description: string
    files_to_modify: string[]
    definition_of_done: string
    must_not: string[]
    depends_on: string[]
  }>
}

export interface TaskResult {
  success: boolean
  git_sha?: string
  error?: string
}

export interface PlanResult {
  success: boolean
  tasks_completed: number
  tasks_failed: number
  git_sha_before: string
  git_sha_after?: string
  rolled_back?: boolean
  error?: string
}
