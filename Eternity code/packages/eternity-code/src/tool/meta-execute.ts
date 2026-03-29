import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { planAcceptedCardsForLoop, executePlan, rollbackPlan, loadExecutionPlansForLoop } from "../meta/execute.js"
import { runEvaluation } from "../meta/evaluator.js"
import { loadMetaDesign } from "../meta/design.js"
import { resolveLoop } from "../meta/runtime.js"

const DESCRIPTION = `Execute MetaDesign execution plans for accepted cards.

This tool manages the execution phase of the MetaDesign loop:
- Plans are generated from accepted decision cards
- Each plan contains atomic tasks that can be executed sequentially
- Tasks are validated with preflight checks before execution

Use this tool to:
1. Generate execution plans from accepted cards
2. Execute a specific plan by ID
3. Rollback a plan if execution fails
4. Auto-execute all ready plans (one-click execution)`

export const MetaExecuteTool = Tool.define("meta_execute", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z
      .enum(["plan", "execute", "rollback", "status", "auto-execute"])
      .describe("Action to perform: 'plan' to generate plans, 'execute' to run a plan, 'rollback' to undo, 'status' to check current state, 'auto-execute' to run all ready plans automatically"),
    planId: z.string().optional().describe("Plan ID for execute/rollback actions (e.g., PLAN-001)"),
    loopId: z.string().optional().describe("Loop ID for plan generation (uses latest if not specified)"),
    dryRun: z.boolean().optional().describe("If true, simulate execution without making changes"),
    autoCommit: z.boolean().optional().default(true).describe("If true, automatically commit after each task"),
    autoRollback: z.boolean().optional().default(true).describe("If true, automatically rollback on failure"),
  }),
  async execute(params, ctx) {
    const cwd = Instance.directory

    switch (params.action) {
      case "plan": {
        const result = await planAcceptedCardsForLoop(cwd, {
          loopId: params.loopId,
        })

        return {
          title: `Execution plans prepared`,
          output: `Generated ${result.createdPlans.length} new plans, reused ${result.reusedPlans.length} existing plans.\n\nPreflight: ${result.preflight.status.toUpperCase()}\n- Ready: ${result.preflight.readyPlans}\n- Warning: ${result.preflight.warningPlans}\n- Blocked: ${result.preflight.blockedPlans}\n\n${result.summary}`,
          metadata: {},
        }
      }

      case "execute": {
        if (!params.planId) {
          throw new Error("planId is required for execute action")
        }

        await ctx.ask({
          permission: "bash",
          patterns: ["*"],
          always: ["*"],
          metadata: { action: "meta_execute", planId: params.planId },
        })

        const result = await executePlan(cwd, params.planId, {
          dryRun: params.dryRun,
          autoCommit: params.autoCommit,
          autoRollback: params.autoRollback,
        })

        return {
          title: `Plan ${params.planId} ${result.success ? "completed" : "failed"}`,
          output: result.success
            ? `Executed ${result.tasks_completed} tasks successfully.\nCommit: ${result.git_sha_after?.slice(0, 7)}`
            : `Execution failed after ${result.tasks_completed} tasks.\nError: ${result.error}${result.rolled_back ? "\n(Rolled back)" : ""}`,
          metadata: {},
        }
      }

      case "rollback": {
        if (!params.planId) {
          throw new Error("planId is required for rollback action")
        }

        await ctx.ask({
          permission: "bash",
          patterns: ["*"],
          always: ["*"],
          metadata: { action: "meta_rollback", planId: params.planId },
        })

        await rollbackPlan(cwd, params.planId)

        return {
          title: `Plan ${params.planId} rolled back`,
          output: `Successfully rolled back plan ${params.planId} to its original state.`,
          metadata: {},
        }
      }

      case "status": {
        const targetLoop = resolveLoop(cwd, params.loopId)

        if (!targetLoop) {
          return {
            title: "No accepted loop found",
            output: "There are no loops with accepted cards. Run /meta to generate cards first.",
            metadata: {},
          }
        }

        const plans = loadExecutionPlansForLoop(cwd, targetLoop.id)
        const planIds = plans.map((plan) => plan.id)
        const preflightStatus = targetLoop.execution?.preflight_status ?? "unknown"
        const readyPlans = plans.filter((plan) => plan.preflight?.status === "ready").length
        const warningPlans = plans.filter((plan) => plan.preflight?.status === "warning").length
        const blockedPlans = plans.filter((plan) => plan.preflight?.status === "blocked").length

        return {
          title: `Loop ${targetLoop.id} execution status`,
          output:
            `Plans: ${planIds.length}\n` +
            `Preflight: ${preflightStatus}\n` +
            `Ready: ${readyPlans} | Warning: ${warningPlans} | Blocked: ${blockedPlans}\n` +
            `Plan IDs: ${planIds.join(", ") || "none"}`,
          metadata: {},
        }
      }

      case "auto-execute": {
        // 一键执行：自动生成计划并执行所有 ready 的计划
        await ctx.ask({
          permission: "bash",
          patterns: ["*"],
          always: ["*"],
          metadata: { action: "meta_auto_execute" },
        })

        // Step 1: 获取最新的 accepted loop
        const targetLoop = resolveLoop(cwd, params.loopId)
        if (!targetLoop) {
          return {
            title: "No accepted loop found",
            output: "There are no loops with accepted cards. Run /meta to generate cards first.",
            metadata: {},
          }
        }

        // Step 2: 生成执行计划（如果没有的话）
        let plans = loadExecutionPlansForLoop(cwd, targetLoop.id)

        if (plans.length === 0) {
          const planningResult = await planAcceptedCardsForLoop(cwd, {
            loopId: targetLoop.id,
          })
          plans = planningResult.preflight.plans
        }

        // Step 3: 过滤出 ready 状态的计划
        const readyPlans = plans.filter(p => p.preflight?.status === "ready")
        const warningPlans = plans.filter(p => p.preflight?.status === "warning")
        const blockedPlans = plans.filter(p => p.preflight?.status === "blocked")

        if (readyPlans.length === 0) {
          return {
            title: "No ready plans to execute",
            output: `Found ${plans.length} plans, but none are ready.\n- Warning: ${warningPlans.length}\n- Blocked: ${blockedPlans.length}`,
            metadata: {},
          }
        }

        // Step 4: 依次执行所有 ready 的计划
        const results = []
        let totalSuccess = 0
        let totalFailed = 0

        for (const plan of readyPlans) {
          if (params.dryRun) {
            results.push(`${plan.id}: [DRY RUN] Would execute`)
            continue
          }

          try {
            const result = await executePlan(cwd, plan.id, {
              autoCommit: params.autoCommit,
              autoRollback: params.autoRollback,
            })

            if (result.success) {
              totalSuccess++
              results.push(`${plan.id}: ✓ ${result.tasks_completed} tasks committed (${result.git_sha_after?.slice(0, 7)})`)
            } else {
              totalFailed++
              results.push(`${plan.id}: ✗ Failed - ${result.error}${result.rolled_back ? " (rolled back)" : ""}`)

              // 如果一个计划失败且自动回滚，停止执行后续计划
              if (result.rolled_back) {
                results.push("Stopping execution due to rollback.")
                break
              }
            }
          } catch (error) {
            totalFailed++
            const errorMsg = error instanceof Error ? error.message : String(error)
            results.push(`${plan.id}: ✗ Error - ${errorMsg}`)
          }
        }

        // Step 5: 运行评估（如果有 eval factors）
        let evalSummary = ""
        try {
          const design = await loadMetaDesign(cwd)
          if (design?.eval_factors?.length) {
            const evalResult = await runEvaluation(cwd, design, undefined)
            evalSummary = `\n\nEvaluation: Δ${evalResult.compositeDelta.toFixed(2)}${evalResult.forcedRollback ? " (rollback recommended)" : ""}`
          }
        } catch {
          // 评估失败不影响主流程
        }

        return {
          title: `Auto-execute complete`,
          output: `Executed ${readyPlans.length} plans:\n${results.join("\n")}${evalSummary}\n\nSummary: ${totalSuccess} succeeded, ${totalFailed} failed`,
          metadata: {},
        }
      }

      default:
        throw new Error(`Unknown action: ${params.action}`)
    }
  },
})
