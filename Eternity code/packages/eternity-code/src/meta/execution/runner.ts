import type { PlanResult } from "./types.js"
import type { Session } from "../types.js"
import { executePlan } from "./executor.js"

/**
 * Compatibility wrapper around the unified execution entrypoint.
 *
 * Older orchestration paths still call runPlan(). Keep that API stable while
 * routing all plan execution through ExecutionExecutor so plan state,
 * rollback behavior, and task persistence stay consistent.
 */
export async function runPlan(cwd: string, planId: string, session?: Session): Promise<PlanResult> {
  if (!session) {
    return {
      success: false,
      tasks_completed: 0,
      tasks_failed: 0,
      git_sha_before: "",
      error: "Session required for execution",
    }
  }

  return executePlan(cwd, planId, {
    session,
    autoCommit: true,
    autoRollback: true,
  })
}
