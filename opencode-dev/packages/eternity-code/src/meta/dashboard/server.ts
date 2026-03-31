import * as fs from "fs"
import * as path from "path"
import yaml from "js-yaml"
import type { AgentTask } from "../agents/types.js"
import {
  computeAgentTaskStats,
  loadCurrentModel,
  loadDashboardBootstrap,
  loadUsageStats,
  readMetaYamlDirectory,
  readYamlDirectory,
  readYamlFile,
} from "./data.js"
import { getDashboardSessionBridge } from "./bridge.js"
import { getDashboardHtml } from "./html.js"
import { MetaPaths, resolveMetaDesignPath } from "../paths.js"

const PORT = parseInt(process.env.ETERNITY_DASHBOARD_PORT ?? "7777")

// Store active SSE connections
const sseClients: Set<ReadableStreamDefaultController> = new Set()

// Broadcast update to all connected clients
function broadcastUpdate(event: string, data: any) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const encoder = new TextEncoder()
  const encoded = encoder.encode(message)
  
  for (const controller of sseClients) {
    try {
      controller.enqueue(encoded)
    } catch {
      // Remove disconnected clients
      sseClients.delete(controller)
    }
  }
}

export function startDashboard(cwd: string): void {
  const designPath = resolveMetaDesignPath(cwd)
  if (!fs.existsSync(designPath)) return

  try {
    Bun.serve({
      port: PORT,
      async fetch(req) {
        const url = new URL(req.url)
        const headers = {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        }

        if (url.pathname === "/" || url.pathname === "/index.html") {
          return new Response(getDashboardHtml(), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
        }

        if (url.pathname === "/api/state") {
          const design = readYamlFile(designPath)
          if (!design) {
            return Response.json({ error: "design.yaml not found" }, { status: 404, headers })
          }
          return Response.json(design, { headers })
        }

        if (url.pathname === "/api/runtime") {
          try {
            const { loadMetaRuntimeSnapshot } = await import("../runtime.js")
            const snapshot = await loadMetaRuntimeSnapshot(cwd)
            return Response.json(snapshot, { headers })
          } catch (error: any) {
            const message = error instanceof Error ? error.message : String(error)
            return Response.json({ error: message }, { status: 400, headers })
          }
        }

        // QueryEngine summary endpoint
        if (url.pathname === "/api/query/summary") {
          try {
            const { QueryEngine } = await import("../query-engine.js")
            const engine = new QueryEngine(cwd)
            const summary = await engine.renderSummary({
              includeQuality: url.searchParams.get("quality") !== "false",
              includeAgents: url.searchParams.get("agents") !== "false",
              includeWatchdog: url.searchParams.get("watchdog") !== "false",
              includeTechDebt: url.searchParams.get("techdebt") !== "false",
              includeLoops: url.searchParams.get("loops") !== "false",
              loopLimit: parseInt(url.searchParams.get("loop_limit") ?? "5"),
            })
            return Response.json({ summary }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // QueryEngine card backlog endpoint
        if (url.pathname === "/api/query/backlog") {
          try {
            const { QueryEngine } = await import("../query-engine.js")
            const engine = new QueryEngine(cwd)
            const backlog = await engine.cardBacklog()
            return Response.json(backlog, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // QueryEngine agent summary endpoint
        if (url.pathname === "/api/query/agents") {
          try {
            const { QueryEngine } = await import("../query-engine.js")
            const engine = new QueryEngine(cwd)
            const agents = await engine.agentSummary()
            return Response.json(agents, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/dashboard/bootstrap") {
          try {
            const agentTaskLimit = parseInt(url.searchParams.get("agent_task_limit") ?? "50")
            const snapshot = await loadDashboardBootstrap(cwd, { agentTaskLimit })
            return Response.json(snapshot, { headers })
          } catch (error: any) {
            const message = error instanceof Error ? error.message : String(error)
            const status = message.includes("busy") || message.includes("in flight") ? 409 : 400
            return Response.json({ error: message }, { status, headers })
          }
        }

        if (url.pathname === "/api/loops") {
          return Response.json(readMetaYamlDirectory(cwd, "loops", 20), { headers })
        }

        if (url.pathname === "/api/cards") {
          const statusFilter = url.searchParams.get("status")
          const cards = readMetaYamlDirectory(cwd, "cards", 50).filter((card: any) =>
            statusFilter ? card?.decision?.status === statusFilter : true,
          )
          return Response.json(cards, { headers })
        }

        if (url.pathname === "/api/negatives") {
          return Response.json(readYamlDirectory(MetaPaths.negatives(cwd)), { headers })
        }

        if (url.pathname === "/api/plans") {
          const loopId = url.searchParams.get("loop_id")
          if (loopId) {
            const { loadExecutionPlansForLoop } = await import("../execute.js")
            return Response.json(loadExecutionPlansForLoop(cwd, loopId), { headers })
          }
          return Response.json(readMetaYamlDirectory(cwd, "plans", 20), { headers })
        }

        if (url.pathname === "/api/agent-tasks") {
          const limit = parseInt(url.searchParams.get("limit") ?? "50")
          const loopId = url.searchParams.get("loop_id")
          const roleId = url.searchParams.get("role_id")
          const status = url.searchParams.get("status")

          let tasks = readMetaYamlDirectory<AgentTask>(cwd, "agentTasks", limit)

          // Filter by loop_id (triggered_by contains loop id)
          if (loopId) {
            tasks = tasks.filter((t: any) => t?.triggered_by?.includes(loopId))
          }

          // Filter by role_id
          if (roleId) {
            tasks = tasks.filter((t: any) => t?.role_id === roleId)
          }

          // Filter by status
          if (status) {
            tasks = tasks.filter((t: any) => t?.status === status)
          }

          return Response.json(tasks, { headers })
        }

        if (url.pathname === "/api/agent-tasks/stats") {
          const tasks = readMetaYamlDirectory<AgentTask>(cwd, "agentTasks", 1000)
          return Response.json(computeAgentTaskStats(tasks), { headers })
        }

        // Watchdog Anomalies API
        if (url.pathname === "/api/anomalies") {
          try {
            const limit = parseInt(url.searchParams.get("limit") ?? "50")
            const anomalyType = url.searchParams.get("type")
            const roleId = url.searchParams.get("role_id")

            const anomaliesDir = MetaPaths.anomalies(cwd)
            if (!fs.existsSync(anomaliesDir)) {
              return Response.json([], { headers })
            }

            let anomalies = fs.readdirSync(anomaliesDir)
              .filter(f => f.endsWith(".yaml"))
              .sort()
              .reverse()
              .slice(0, 5)
              .flatMap(f => {
                try {
                  const content = fs.readFileSync(path.join(anomaliesDir, f), "utf8")
                  return yaml.load(content) as any[]
                } catch {
                  return []
                }
              })

            // Filter by type
            if (anomalyType) {
              anomalies = anomalies.filter((a: any) => a?.type === anomalyType)
            }

            // Filter by role_id
            if (roleId) {
              anomalies = anomalies.filter((a: any) => a?.agent_role === roleId)
            }

            // Apply limit
            anomalies = anomalies.slice(0, limit)

            return Response.json(anomalies, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // Quality Monitor APIs
        if (url.pathname === "/api/quality/assess") {
          try {
            const { assessQuality, formatQualityReport } = await import("../quality-monitor.js")
            const report = assessQuality(cwd)
            return Response.json({
              ...report,
              formatted: formatQualityReport(report),
            }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // Blueprint APIs
        if (url.pathname === "/api/blueprints/current") {
          try {
            const { loadCurrentBlueprint } = await import("../blueprints.js")
            const blueprint = loadCurrentBlueprint(cwd)
            if (!blueprint) {
              return Response.json({ error: "No blueprint found" }, { status: 404, headers })
            }
            return Response.json(blueprint, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/blueprints") {
          try {
            const { loadAllBlueprints } = await import("../blueprints.js")
            const blueprints = loadAllBlueprints(cwd)
            return Response.json(blueprints, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // Insights APIs
        if (url.pathname === "/api/insights") {
          try {
            const { loadInsights } = await import("../insights.js")
            const statusFilter = url.searchParams.get("status")
            let insights = loadInsights(cwd)
            if (statusFilter) {
              insights = insights.filter(i => i.status === statusFilter)
            }
            return Response.json(insights, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // Restructure APIs
        if (url.pathname === "/api/restructures") {
          try {
            const restructuresDir = path.join(cwd, ".meta", "restructures")
            if (!fs.existsSync(restructuresDir)) {
              return Response.json([], { headers })
            }
            const restructures = fs.readdirSync(restructuresDir)
              .filter(f => f.endsWith(".yaml"))
              .sort()
              .reverse()
              .map(f => {
                const content = fs.readFileSync(path.join(restructuresDir, f), "utf8")
                return yaml.load(content)
              })
            return Response.json(restructures, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // Context Loader API
        if (url.pathname === "/api/context/load") {
          try {
            const { loadLoopContext } = await import("../context-loader.js")
            const context = await loadLoopContext(cwd)
            return Response.json({
              design: context.design ? {
                name: context.design.project?.name,
                stage: context.design.project?.stage,
                core_value: context.design.project?.core_value,
              } : null,
              blueprint: context.blueprint ? {
                version: context.blueprint.version,
                current_state: context.blueprint.current_state?.split('\n')[0],
                priorities: context.blueprint.priorities?.length || 0,
              } : null,
              insights: context.insights?.length || 0,
              recent_logs: context.recentLogs?.length || 0,
              negatives: context.negatives?.length || 0,
            }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // Loop Logs API
        if (url.pathname === "/api/logs") {
          try {
            const { loadAllLogs } = await import("../execution/logs.js")
            const limit = parseInt(url.searchParams.get("limit") ?? "10")
            const logs = loadAllLogs(cwd).slice(0, limit)
            return Response.json(logs.map((content, i) => ({
              index: i,
              firstLine: content.split('\n')[0],
              content,
            })), { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // Coverage Assessment APIs
        if (url.pathname === "/api/coverage/assess" && req.method === "POST") {
          try {
            const bridge = getDashboardSessionBridge(cwd)
            if (!bridge) {
              return experimentalUnavailable(
                "Coverage assessment requires a live TUI session bridge. Re-open the dashboard from the active TUI runtime and try again.",
                headers,
              )
            }

            const { runCoverageAssessment } = await import("../coverage.js")
            const result = await runCoverageAssessment(cwd, bridge)

            broadcastUpdate("coverage", {
              action: "assessed",
              updated: result.updatedReqs.length,
              errors: result.errors.length,
            })
            broadcastUpdate("state", {
              action: "coverage_assessed",
              timestamp: result.timestamp,
            })

            return Response.json(
              {
                success: result.errors.length === 0,
                result,
              },
              { headers },
            )
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/coverage/history") {
          try {
            const { getRecentAssessments } = await import("../coverage.js")
            const limit = parseInt(url.searchParams.get("limit") ?? "10")
            const history = getRecentAssessments(cwd, limit)
            return Response.json(history, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/coverage/stats") {
          try {
            const design = readYamlFile(designPath) as any
            if (!design) {
              return Response.json({ error: "design.yaml not found" }, { status: 404, headers })
            }
            const { getCoverageStats } = await import("../coverage.js")
            const stats = getCoverageStats(design)
            return Response.json(stats, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/reports") {
          return Response.json(readYamlDirectory(path.join(cwd, ".meta", "reports"), 20), { headers })
        }

        if (url.pathname === "/api/plan" && url.searchParams.get("id")) {
          const planId = url.searchParams.get("id")
          const planPath = path.join(MetaPaths.plans(cwd), `${planId}.yaml`)
          if (fs.existsSync(planPath)) {
            return Response.json(readYamlFile(planPath), { headers })
          }
          return Response.json({ error: "Plan not found" }, { status: 404, headers })
        }

        if (url.pathname === "/api/rollback" && req.method === "POST") {
          try {
            const body = await req.json()
            const { planId, reason } = body
            
            if (!planId) {
              return Response.json({ error: "planId is required" }, { status: 400, headers })
            }

            // Import and call rollback function
            const { rollbackPlan } = await import("../execute.js")
            await rollbackPlan(cwd, planId)
            
            return Response.json({ success: true, message: `Plan ${planId} rolled back` }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/execute" && req.method === "POST") {
          try {
            const body = await req.json()
            const { planId, taskId, dryRun } = body
            
            if (!planId) {
              return Response.json({ error: "planId is required" }, { status: 400, headers })
            }

            const { executePlan, executeTask } = await import("../execute.js")
            
            if (taskId) {
              const result = await executeTask(cwd, planId, taskId, { dryRun })
              return Response.json({ success: true, result }, { headers })
            } else {
              const result = await executePlan(cwd, planId, { dryRun })
              return Response.json({ success: true, result }, { headers })
            }
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // Auto-execute API - one-click execution of all ready plans
        if (url.pathname === "/api/execute/auto" && req.method === "POST") {
          try {
            const { loadExecutionPlansForLoop, planAcceptedCardsForLoop, executePlan } = await import("../execute.js")
            const { loadMetaDesign } = await import("../design.js")
            const { runEvaluation } = await import("../evaluator.js")
            const { resolveLoop } = await import("../runtime.js")

            // Step 1: Get latest accepted loop
            const targetLoop = resolveLoop(cwd)
            if (!targetLoop) {
              return Response.json({ error: "No accepted loop found. Run /meta first." }, { status: 400, headers })
            }

            // Step 2: Generate plans if needed
            let plans = loadExecutionPlansForLoop(cwd, targetLoop.id)
            if (plans.length === 0) {
              const planningResult = await planAcceptedCardsForLoop(cwd, { loopId: targetLoop.id })
              plans = planningResult.preflight.plans
            }

            // Step 3: Filter ready plans
            const readyPlans = plans.filter(p => p.preflight?.status === "ready")
            if (readyPlans.length === 0) {
              return Response.json({
                error: "No ready plans to execute",
                loopId: targetLoop.id,
                plans: plans.length,
                warning: plans.filter(p => p.preflight?.status === "warning").length,
                blocked: plans.filter(p => p.preflight?.status === "blocked").length,
              }, { status: 400, headers })
            }

            // Step 4: Execute all ready plans
            const results = []
            let totalSuccess = 0
            let totalFailed = 0

            for (const plan of readyPlans) {
              try {
                const result = await executePlan(cwd, plan.id, {
                  autoCommit: true,
                  autoRollback: true,
                })

                if (result.success) {
                  totalSuccess++
                  results.push({
                    planId: plan.id,
                    success: true,
                    tasks: result.tasks_completed,
                    commit: result.git_sha_after?.slice(0, 7),
                  })
                } else {
                  totalFailed++
                  results.push({
                    planId: plan.id,
                    success: false,
                    error: result.error,
                    rolledBack: result.rolled_back,
                  })

                  if (result.rolled_back) break
                }
              } catch (error: any) {
                totalFailed++
                results.push({
                  planId: plan.id,
                  success: false,
                  error: error.message,
                })
              }

              // Broadcast progress
              broadcastUpdate("execution", {
                action: "plan_completed",
                planId: plan.id,
                success: results[results.length - 1].success,
                progress: `${results.length}/${readyPlans.length}`,
              })
            }

            // Step 5: Run evaluation
            let evalDelta = null
            try {
              const design = await loadMetaDesign(cwd)
              if (design?.eval_factors?.length) {
                const evalResult = await runEvaluation(cwd, design, undefined)
                evalDelta = evalResult.compositeDelta
              }
            } catch {}

            // Broadcast completion
            broadcastUpdate("execution", {
              action: "auto_complete",
              totalPlans: readyPlans.length,
              success: totalSuccess,
              failed: totalFailed,
            })

            return Response.json({
              success: true,
              loopId: targetLoop.id,
              totalPlans: readyPlans.length,
              successCount: totalSuccess,
              failedCount: totalFailed,
              results,
              evalDelta,
            }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/evaluation/history") {
          const reportsDir = path.join(cwd, ".meta", "reports")
          if (!fs.existsSync(reportsDir)) {
            return Response.json([], { headers })
          }
          
          const reports = fs.readdirSync(reportsDir)
            .filter(f => f.startsWith("eval-") && f.endsWith(".md"))
            .sort()
            .reverse()
            .slice(0, 10)
            .map(f => {
              const content = fs.readFileSync(path.join(reportsDir, f), "utf8")
              const loopId = f.replace("eval-", "").replace(".md", "")
              return { loopId, content }
            })
          
          return Response.json(reports, { headers })
        }

        if (url.pathname === "/api/negatives/analyze") {
          try {
            const { analyzeAllNegatives, generateNegativeUnlockSuggestions } = await import("../cards.js")
            const design = readYamlFile(designPath) as any
            const analyses = analyzeAllNegatives(design)
            const suggestions = generateNegativeUnlockSuggestions(design, analyses)
            
            return Response.json({ analyses, suggestions }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/negatives/unlock" && req.method === "POST") {
          try {
            const body = await req.json()
            const { negId, reason } = body
            
            if (!negId) {
              return Response.json({ error: "negId is required" }, { status: 400, headers })
            }

            const { unlockNegative } = await import("../cards.js")
            await unlockNegative(cwd, negId, reason || "Manual unlock")
            
            // Broadcast update
            broadcastUpdate("negatives", { action: "unlock", negId })
            
            return Response.json({ success: true }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/optimization/run" && req.method === "POST") {
          try {
            const { loadMetaDesign } = await import("../design.js")
            const { runOptimization, applyOptimizations } = await import("../optimizer.js")
            
            const design = await loadMetaDesign(cwd)
            if (!design) {
              return Response.json({ error: "design.yaml not found" }, { status: 404, headers })
            }
            
            const result = await runOptimization(cwd, design)
            await applyOptimizations(cwd, design, result)
            
            // Broadcast update
            broadcastUpdate("optimization", { action: "applied", result })
            
            return Response.json({ success: true, result }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // Model/Provider APIs - using models.dev from opencode
        if (url.pathname === "/api/providers/models") {
          try {
            // Fetch models from models.dev
            const modelsUrl = "https://models.dev/api.json"
            let modelsData: any = {}
            
            try {
              const resp = await fetch(modelsUrl, { signal: AbortSignal.timeout(5000) })
              if (resp.ok) {
                modelsData = await resp.json()
              }
            } catch {
              // Fallback: return empty providers
              modelsData = {}
            }

            // Get current config
            const configPath = path.join(cwd, "eternity-code.json")
            let config: any = {}
            if (fs.existsSync(configPath)) {
              config = JSON.parse(fs.readFileSync(configPath, "utf8"))
            }

            // Transform models data to simpler format
            const providers: Record<string, any> = {}
            for (const [id, provider] of Object.entries(modelsData)) {
              const p = provider as any
              providers[id] = {
                id,
                name: p.name || id,
                api: p.api,
                npm: p.npm,
                env: p.env || [],
                models: Object.entries(p.models || {}).reduce((acc, [modelId, model]) => {
                  const m = model as any
                  acc[modelId] = {
                    id: modelId,
                    name: m.name || modelId,
                    cost: m.cost,
                    limit: m.limit,
                    status: m.status,
                    reasoning: m.reasoning,
                    attachment: m.attachment,
                  }
                  return acc
                }, {} as Record<string, any>),
              }
            }

            return Response.json({
              providers,
              current: config.model || "",
              config: config.provider || {},
            }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/providers/current") {
          try {
            return Response.json({ model: loadCurrentModel(cwd) }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // Token usage stats
        if (url.pathname === "/api/usage") {
          try {
            const design = readYamlFile(designPath) as any
            return Response.json(loadUsageStats(design), { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // Loop Orchestrator APIs
        if (url.pathname === "/api/loop/status") {
          try {
            const { loadMetaRuntimeSnapshot } = await import("../runtime.js")
            const snapshot = await loadMetaRuntimeSnapshot(cwd)
            return Response.json(snapshot.status, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/loop/start" && req.method === "POST") {
          try {
            const bridge = getDashboardSessionBridge(cwd)
            if (!bridge) {
              return experimentalUnavailable(
                "Dashboard loop start requires a live TUI session bridge. Start the dashboard from the active TUI runtime and try again.",
                headers,
              )
            }

            const status = bridge.getStatus()
            if (status.pendingLoopStart) {
              return Response.json(
                { error: "A loop start request is already in flight." },
                { status: 409, headers },
              )
            }

            const { loadMetaRuntimeSnapshot } = await import("../runtime.js")
            const snapshotBefore = await loadMetaRuntimeSnapshot(cwd)
            if (!["idle", "complete"].includes(snapshotBefore.status.phase)) {
              return Response.json(
                {
                  error: `Loop start is only allowed from idle or complete phases. Current phase: ${snapshotBefore.status.phase}.`,
                },
                { status: 409, headers },
              )
            }

            const result = await bridge.startLoop()

            broadcastUpdate("loop", {
              action: "start_requested",
              sessionID: result.sessionID,
              createdSession: result.createdSession,
              routeType: result.routeType,
              timestamp: new Date().toISOString(),
            })

            return Response.json(
              {
                success: true,
                result,
              },
              { headers },
            )
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/loop/decide" && req.method === "POST") {
          try {
            const body = await req.json()
            const decisionItems = Array.isArray(body?.decisions) ? body.decisions : []

            if (decisionItems.length === 0) {
              return Response.json({ error: "At least one decision is required." }, { status: 400, headers })
            }

            const { applyLoopDecisions, loadMetaLoopRuntime } = await import("../loop.js")
            const { loadMetaRuntimeSnapshot } = await import("../runtime.js")
            const runtime = await loadMetaLoopRuntime(cwd)

            if (!runtime.pendingLoop || runtime.pendingCards.length === 0) {
              return Response.json(
                { error: "No pending loop is waiting for decisions." },
                { status: 409, headers },
              )
            }

            const pendingCards = runtime.pendingCards.filter((card) => (card.decision?.status ?? "pending") === "pending")
            const pendingIds = new Set(pendingCards.map((card) => card.id))

            const decisions: Record<string, "accepted" | "rejected"> = {}
            const notes: Record<string, string> = {}

            for (const item of decisionItems) {
              const cardId = item?.cardId
              const status = item?.status
              if (typeof cardId !== "string" || (status !== "accepted" && status !== "rejected")) {
                return Response.json({ error: "Invalid decision payload." }, { status: 400, headers })
              }
              if (!pendingIds.has(cardId)) {
                return Response.json(
                  { error: `Card ${cardId} is not pending in ${runtime.pendingLoop.id}.` },
                  { status: 400, headers },
                )
              }
              decisions[cardId] = status
              if (typeof item?.note === "string" && item.note.trim()) {
                notes[cardId] = item.note.trim()
              }
            }

            const missing = pendingCards
              .map((card) => card.id)
              .filter((cardId) => !decisions[cardId])

            if (missing.length > 0) {
              return Response.json(
                { error: `Decisions missing for: ${missing.join(", ")}` },
                { status: 400, headers },
              )
            }

            const result = await applyLoopDecisions(cwd, runtime.pendingLoop.id, decisions, notes, {
              chosenBy: "dashboard",
              recordFeedback: true,
            })
            const snapshot = await loadMetaRuntimeSnapshot(cwd)

            broadcastUpdate("cards", { action: "decided", loopId: result.loopId, accepted: result.acceptedCards.length, rejected: result.rejectedCards.length })
            broadcastUpdate("loops", { action: "decision_complete", loopId: result.loopId })
            broadcastUpdate("negatives", { action: "decision_negatives", loopId: result.loopId, negatives: result.newNegatives })
            broadcastUpdate("feedback", { action: "decision_feedback", loopId: result.loopId })

            return Response.json(
              {
                success: true,
                result,
                status: snapshot.status,
              },
              { headers },
            )
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // Prompt Feedback APIs
        if (url.pathname === "/api/feedback/scores") {
          try {
            const { PromptFeedbackLoop } = await import("../prompt/feedback-loop.js")
            const feedbackLoop = new PromptFeedbackLoop(cwd)
            const scores = feedbackLoop.getAllQualityScores()
            return Response.json(scores, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/feedback/suggestions") {
          try {
            const { PromptFeedbackLoop } = await import("../prompt/feedback-loop.js")
            const feedbackLoop = new PromptFeedbackLoop(cwd)
            const suggestions = feedbackLoop.generateOptimizationSuggestions()
            return Response.json({ suggestions }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/feedback/needs-optimization") {
          try {
            const { PromptFeedbackLoop } = await import("../prompt/feedback-loop.js")
            const feedbackLoop = new PromptFeedbackLoop(cwd)
            const threshold = parseFloat(url.searchParams.get("threshold") ?? "0.6")
            const templates = feedbackLoop.getTemplatesNeedingOptimization(threshold)
            return Response.json(templates, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/metadesign/init" && req.method === "POST") {
          try {
            const body = await req.json()
            const { projectName, stage, coreValue, antiValue, requirements, constraints } = body
            
            // Create .meta directory structure using new paths
            const designDir = path.dirname(MetaPaths.design(cwd))
            const dirs = [
              designDir,
              MetaPaths.schema(cwd),
              MetaPaths.insights(cwd),
              MetaPaths.blueprints(cwd),
              MetaPaths.cards(cwd),
              MetaPaths.plans(cwd),
              MetaPaths.loops(cwd),
              MetaPaths.logs(cwd),
              MetaPaths.agentTasks(cwd),
              MetaPaths.negatives(cwd),
            ]
            for (const dirPath of dirs) {
              if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true })
              }
            }

            // Generate design.yaml
            const design = {
              _schema_version: "1.0.0",
              project: {
                id: projectName?.toLowerCase().replace(/\s+/g, "-") || "my-project",
                name: projectName || "My Project",
                stage: stage || "prototype",
                core_value: coreValue || "",
                anti_value: antiValue || "",
              },
              requirements: (requirements || []).map((req: any, idx: number) => ({
                id: `REQ-${String(idx + 1).padStart(3, "0")}`,
                text: req.text || req,
                priority: req.priority || "p1",
                coverage: 0,
              })),
              constraints: {
                compliance: constraints?.compliance || [],
                immutable_modules: constraints?.immutable_modules || [],
              },
              rejected_directions: [],
              eval_factors: [],
              search_policy: {
                mode: "balanced",
                max_cards_per_loop: 3,
                exploration_rate: 0.2,
                candidate_sources: [
                  { source: "coverage_gap", weight: 0.4 },
                  { source: "eval_regression", weight: 0.3 },
                  { source: "tech_debt", weight: 0.2 },
                  { source: "free_exploration", weight: 0.1 },
                ],
              },
              loop_history: {
                total_loops: 0,
                loops: [],
              },
              updated_at: new Date().toISOString(),
            }

            const designPath = MetaPaths.design(cwd)
            fs.writeFileSync(designPath, yaml.dump(design, { lineWidth: 100 }))
            
            // Broadcast update
            broadcastUpdate("state", { action: "initialized", design })
            
            return Response.json({ success: true, design }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/metadesign/update" && req.method === "POST") {
          try {
            const body = await req.json()
            const designPath = resolveMetaDesignPath(cwd)
            
            if (!fs.existsSync(designPath)) {
              return Response.json({ error: "design.yaml not found" }, { status: 404, headers })
            }

            const design = yaml.load(fs.readFileSync(designPath, "utf8")) as any
            
            // Update fields
            if (body.project) {
              design.project = { ...design.project, ...body.project }
            }
            if (body.requirements) {
              design.requirements = body.requirements
            }
            if (body.constraints) {
              design.constraints = { ...design.constraints, ...body.constraints }
            }
            if (body.search_policy) {
              design.search_policy = { ...design.search_policy, ...body.search_policy }
            }
            
            design.updated_at = new Date().toISOString()
            
            fs.writeFileSync(designPath, yaml.dump(design, { lineWidth: 100 }))
            
            // Broadcast update
            broadcastUpdate("state", { action: "updated", design })
            
            return Response.json({ success: true, design }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/metadesign/requirement/add" && req.method === "POST") {
          try {
            const body = await req.json()
            const designPath = resolveMetaDesignPath(cwd)
            
            if (!fs.existsSync(designPath)) {
              return Response.json({ error: "design.yaml not found - initialize first" }, { status: 404, headers })
            }

            const design = yaml.load(fs.readFileSync(designPath, "utf8")) as any
            const reqs = design.requirements || []
            
            const newReq = {
              id: `REQ-${String(reqs.length + 1).padStart(3, "0")}`,
              text: body.text,
              priority: body.priority || "p1",
              coverage: 0,
              coverage_note: body.coverage_note,
            }
            
            reqs.push(newReq)
            design.requirements = reqs
            design.updated_at = new Date().toISOString()
            
            fs.writeFileSync(designPath, yaml.dump(design, { lineWidth: 100 }))
            
            // Broadcast update
            broadcastUpdate("state", { action: "requirement_added", requirement: newReq })
            
            return Response.json({ success: true, requirement: newReq }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/metadesign/constraint/add" && req.method === "POST") {
          try {
            const body = await req.json()
            const designPath = resolveMetaDesignPath(cwd)
            
            if (!fs.existsSync(designPath)) {
              return Response.json({ error: "design.yaml not found - initialize first" }, { status: 404, headers })
            }

            const design = yaml.load(fs.readFileSync(designPath, "utf8")) as any
            
            if (!design.constraints) {
              design.constraints = { compliance: [] }
            }
            if (!design.constraints.compliance) {
              design.constraints.compliance = []
            }
            
            design.constraints.compliance.push(body.text)
            design.updated_at = new Date().toISOString()
            
            fs.writeFileSync(designPath, yaml.dump(design, { lineWidth: 100 }))
            
            // Broadcast update
            broadcastUpdate("state", { action: "constraint_added", constraint: body.text })
            
            return Response.json({ success: true }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/config") {
          try {
            const configPath = path.join(cwd, "eternity-code.json")
            let config: any = {}
            if (fs.existsSync(configPath)) {
              config = JSON.parse(fs.readFileSync(configPath, "utf8"))
            }
            return Response.json(config, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        if (url.pathname === "/api/config/update" && req.method === "POST") {
          try {
            const body = await req.json()
            const configPath = path.join(cwd, "eternity-code.json")
            
            let config: any = {}
            if (fs.existsSync(configPath)) {
              config = JSON.parse(fs.readFileSync(configPath, "utf8"))
            }
            
            // Merge updates
            const updated = { ...config, ...body }
            fs.writeFileSync(configPath, JSON.stringify(updated, null, 2))
            
            // Broadcast update
            broadcastUpdate("config", { action: "updated", config: updated })
            
            return Response.json({ success: true, config: updated }, { headers })
          } catch (error: any) {
            return Response.json({ error: error.message }, { status: 500, headers })
          }
        }

        // SSE endpoint for real-time updates
        if (url.pathname === "/api/events") {
          const stream = new ReadableStream({
            start(controller) {
              sseClients.add(controller)
              
              // Send initial connection message
              const message = `event: connected\ndata: {"status":"connected"}\n\n`
              controller.enqueue(new TextEncoder().encode(message))
            },
            cancel(controller) {
              sseClients.delete(controller)
            }
          })

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
              "Access-Control-Allow-Origin": "*",
            },
          })
        }

        return new Response("Not found", { status: 404 })
      },
    })

    console.error(`[Eternity Code] Dashboard -> http://localhost:${PORT}`)
    
    // Start file watcher for real-time updates
    startFileWatcher(cwd)
  } catch (error: any) {
    if (error.message?.includes("Address already in use") || error.message?.includes("EADDRINUSE")) {
      console.error(`[Eternity Code] Dashboard port ${PORT} already in use, skipping`)
      return
    }

    console.error("[Eternity Code] Dashboard failed to start:", error.message)
  }
}

// File watcher for real-time updates
function startFileWatcher(cwd: string) {
  const metaDir = path.join(cwd, ".meta")
  if (!fs.existsSync(metaDir)) return

  // Watch for changes in .meta directory
  const watcher = fs.watch(metaDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return

    // Determine update type based on file path
    const filePath = filename.toString()
    let updateType = "unknown"
    
    if (filePath.includes("loops")) {
      updateType = "loops"
    } else if (filePath.includes("cards")) {
      updateType = "cards"
    } else if (filePath.includes("plans")) {
      updateType = "plans"
    } else if (filePath.includes("feedback")) {
      updateType = "feedback"
    } else if (filePath.includes("negatives")) {
      updateType = "negatives"
    } else if (filePath.includes("design.yaml")) {
      updateType = "state"
    } else if (filePath.includes("reports")) {
      updateType = "reports"
    } else if (filePath.includes("anomalies") || filePath.includes("ANOMALY")) {
      updateType = "watchdog"
    } else if (filePath.includes("agent-tasks") || filePath.includes("task-")) {
      updateType = "agents"
    } else if (filePath.includes("blueprint")) {
      updateType = "blueprints"
    } else if (filePath.includes("insight") || filePath.includes("INS-")) {
      updateType = "insights"
    }

    // Broadcast the update
    broadcastUpdate(updateType, { 
      action: eventType, 
      file: filePath,
      timestamp: new Date().toISOString()
    })
  })

  // Clean up on process exit
  process.on("SIGTERM", () => watcher.close())
  process.on("SIGINT", () => watcher.close())
}

function experimentalUnavailable(message: string, headers: Record<string, string>) {
  return Response.json(
    {
      error: message,
      experimental: true,
    },
    { status: 501, headers },
  )
}
