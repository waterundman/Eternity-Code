import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { loadMetaDesign } from "../meta/design.js"
import { loadLoopRecords } from "../meta/loop.js"
import { runEvaluation } from "../meta/evaluator.js"
import { runOptimization, applyOptimizations } from "../meta/optimizer.js"
import { loadMetaRuntimeSnapshot, resolveLoop } from "../meta/runtime.js"

const DESCRIPTION = `Manage the MetaDesign core loop for AI-native software engineering.

The MetaDesign loop consists of 6 phases:
1. Analyze - Plan agent analyzes codebase
2. Generate - Decision cards are created
3. Decide - Human accepts/rejects cards
4. Execute - Build agent implements accepted cards
5. Evaluate - Results are measured against eval factors
6. Optimize - Search strategy is refined

This tool provides status information and control over the loop.`

export const MetaLoopTool = Tool.define("meta_loop", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z
      .enum(["status", "evaluate", "optimize", "history"])
      .describe("Action to perform"),
    loopId: z.string().optional().describe("Loop ID to operate on (uses latest if not specified)"),
  }),
  async execute(params, ctx) {
    const cwd = Instance.directory
    const design = await loadMetaDesign(cwd)

    if (!design) {
      return {
        title: "MetaDesign not initialized",
        output: "No .meta/design/design.yaml found. Run /meta-init to initialize MetaDesign for this project.",
        metadata: {},
      }
    }

    switch (params.action) {
      case "status": {
        const runtime = await loadMetaRuntimeSnapshot(cwd)
        const latestLoop = params.loopId
          ? loadLoopRecords(cwd).find((loop) => loop.id === params.loopId)
          : runtime.latestLoop
        const acceptedLoop = params.loopId
          ? resolveLoop(cwd, params.loopId)
          : runtime.acceptedLoop
        const plans =
          acceptedLoop?.id === latestLoop?.id
            ? runtime.latestPlans
            : acceptedLoop?.id
              ? runtime.acceptedPlans
              : runtime.latestPlans

        const reqs = design.requirements ?? []
        const avgCoverage = reqs.length
          ? Math.round((reqs.reduce((s, r) => s + (r.coverage ?? 0), 0) / reqs.length) * 100)
          : 0

        const activeNegs = (design.rejected_directions ?? []).filter((n) => n.status === "active")

        let statusText = `Project: ${design.project.name ?? "Unnamed"}\n`
        statusText += `Stage: ${design.project.stage}\n`
        statusText += `Core Value: ${design.project.core_value}\n\n`
        statusText += `Requirements: ${reqs.length}\n`
        statusText += `Average Coverage: ${avgCoverage}%\n`
        statusText += `Active Negatives: ${activeNegs.length}\n`
        statusText += `Total Loops: ${design.loop_history?.total_loops ?? 0}\n\n`

        if (latestLoop) {
          statusText += `Latest Loop: ${latestLoop.id}\n`
          statusText += `Status: ${latestLoop.status ?? "pending"}\n`
        }

        if (acceptedLoop) {
          const accepted = acceptedLoop.decision_session?.accepted_cards?.length ?? 0
          statusText += `\nAccepted Loop: ${acceptedLoop.id}\n`
          statusText += `Accepted Cards: ${accepted}\n`
        }

        if (plans.length > 0) {
          statusText += `\nExecution Plans: ${plans.length}\n`
          const readyPlans = plans.filter((p) => p.preflight?.status === "ready").length
          const warningPlans = plans.filter((p) => p.preflight?.status === "warning").length
          const blockedPlans = plans.filter((p) => p.preflight?.status === "blocked").length
          statusText += `Ready: ${readyPlans} | Warning: ${warningPlans} | Blocked: ${blockedPlans}\n`
        }

        return {
          title: "MetaDesign Status",
          output: statusText,
          metadata: {},
        }
      }

      case "evaluate": {
        const targetLoop = resolveLoop(cwd, params.loopId)

        if (!targetLoop) {
          return {
            title: "No loop to evaluate",
            output: "There are no loops with accepted cards. Run /meta to generate cards first.",
            metadata: {},
          }
        }

        const evalResult = await runEvaluation(cwd, design, undefined)

        let output = `Evaluation for ${targetLoop.id}:\n\n`
        for (const result of evalResult.results) {
          const status = result.passedFloor ? "✓" : "✗"
          output += `${status} ${result.factorName}: ${result.valueBefore} → ${result.valueAfter} (Δ${result.delta.toFixed(2)})\n`
        }
        output += `\nComposite Score: ${evalResult.compositeScoreBefore.toFixed(2)} → ${evalResult.compositeScoreAfter.toFixed(2)}\n`
        output += `Delta: ${evalResult.compositeDelta.toFixed(2)}\n`
        if (evalResult.forcedRollback) {
          output += `\n⚠️ ROLLBACK REQUIRED: ${evalResult.rollbackReason}`
        }

        return {
          title: "Evaluation complete",
          output,
          metadata: {},
        }
      }

      case "optimize": {
        const optimizationResult = await runOptimization(cwd, design)
        await applyOptimizations(cwd, design, optimizationResult)

        let output = `Optimization complete:\n\n`
        output += `Insights:\n`
        for (const insight of optimizationResult.insights) {
          output += `  • ${insight}\n`
        }

        if (optimizationResult.unlockedNegs.length > 0) {
          output += `\nUnlocked Negatives: ${optimizationResult.unlockedNegs.join(", ")}\n`
        }

        output += `\nRecommendations:\n`
        for (const rec of optimizationResult.recommendations.slice(0, 3)) {
          output += `  • ${rec.source}: ${rec.currentWeight} → ${rec.recommendedWeight} (${rec.reason})\n`
        }

        return {
          title: "Optimization complete",
          output,
          metadata: {},
        }
      }

      case "history": {
        const loops = design.loop_history?.loops ?? []
        if (loops.length === 0) {
          return {
            title: "No loop history",
            output: "No loops have been completed yet. Run /meta to start a loop.",
            metadata: {},
          }
        }

        let output = `Loop History (${loops.length} loops):\n\n`
        for (const loop of loops.slice(0, 10)) {
          const delta = loop.composite_score_delta ?? 0
          const status = loop.status === "completed" ? "✓" : loop.status === "rolled_back" ? "✗" : "~"
          output += `${status} ${loop.loop_id} | Δ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} | ${loop.summary ?? "No summary"}\n`
        }

        return {
          title: "Loop history",
          output,
          metadata: {},
        }
      }

      default:
        throw new Error(`Unknown action: ${params.action}`)
    }
  },
})
