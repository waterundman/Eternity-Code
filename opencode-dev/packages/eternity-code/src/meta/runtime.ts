import * as fs from "fs"
import yaml from "js-yaml"
import type { ExecutionPlan, ExecutionTask } from "./execution/types.js"
import {
  findLatestAcceptedLoop,
  loadLoopCards,
  loadLoopRecords,
  loadMetaLoopRuntime,
  type MetaDecisionCard,
  type MetaLoopRecord,
  type MetaLoopRuntime,
} from "./loop.js"
import { loadExecutionPlansForLoop } from "./execute.js"
import { listMetaEntryPaths, resolveMetaDirectory } from "./paths.js"
import { assessQuality, type QualityReport } from "./quality-monitor.js"
import { loadAllLogs } from "./execution/logs.js"

export type MetaRuntimePhase = "idle" | "analyzing" | "generating" | "deciding" | "planning" | "contracting" | "executing" | "evaluating" | "optimizing" | "complete"

export interface MetaRuntimeStatus {
  phase: MetaRuntimePhase
  desc: string
  loopId?: string
}

type MetaRuntimeStatusInput = {
  latestLoop?: MetaLoopRecord
  pendingLoop?: MetaLoopRecord
  pendingCards: MetaDecisionCard[]
  acceptedLoop?: MetaLoopRecord
  acceptedPlans: ExecutionPlan[]
}

export interface AgentStatusSummary {
  roleId: string
  totalTasks: number
  doneTasks: number
  failedTasks: number
  runningTasks: number
  avgDurationMs: number
  lastError?: string
}

export interface WatchdogHealthSummary {
  healthy: boolean
  openBreakers: string[]
  recentAnomalyCount: number
  lastAnomalyType?: string
}

export interface TechDebtSummary {
  densityPerLoop: number
  totalItems: number
  recentLogs: number
  topItems: string[]
}

export interface ExecutionProgressSummary {
  totalTasks: number
  completedTasks: number
  failedTasks: number
  pendingTasks: number
  completionRate: number
}

export interface MetaRuntimeSnapshot extends MetaLoopRuntime {
  acceptedLoop?: MetaLoopRecord
  acceptedCards: MetaDecisionCard[]
  latestPlans: ExecutionPlan[]
  acceptedPlans: ExecutionPlan[]
  status: MetaRuntimeStatus
  stats: {
    totalLoops: number
    pendingCards: number
    latestPlanCount: number
    acceptedPlanCount: number
  }
  quality: QualityReport
  techDebt: TechDebtSummary
  agents: AgentStatusSummary[]
  watchdog: WatchdogHealthSummary
  executionProgress: ExecutionProgressSummary
}

export async function loadMetaRuntimeSnapshot(cwd: string): Promise<MetaRuntimeSnapshot> {
  const runtime = await loadMetaLoopRuntime(cwd)
  const acceptedLoop = findLatestAcceptedLoop(cwd)
  const acceptedCards = acceptedLoop ? loadLoopCards(cwd, acceptedLoop) : []
  const latestPlans = runtime.latestLoop ? loadExecutionPlansForLoop(cwd, runtime.latestLoop.id) : []
  const acceptedPlans = acceptedLoop ? loadExecutionPlansForLoop(cwd, acceptedLoop.id) : []

  return {
    ...runtime,
    acceptedLoop,
    acceptedCards,
    latestPlans,
    acceptedPlans,
    status: inferMetaRuntimeStatus({
      latestLoop: runtime.latestLoop,
      pendingLoop: runtime.pendingLoop,
      pendingCards: runtime.pendingCards,
      acceptedLoop,
      acceptedPlans,
    }),
    stats: {
      totalLoops: runtime.loops.length,
      pendingCards: runtime.pendingCards.length,
      latestPlanCount: latestPlans.length,
      acceptedPlanCount: acceptedPlans.length,
    },
    quality: assessQuality(cwd),
    techDebt: computeTechDebtSummary(cwd),
    agents: computeAgentStatusSummary(cwd),
    watchdog: computeWatchdogHealth(cwd),
    executionProgress: computeExecutionProgress(acceptedPlans),
  }
}

export function resolveLoop(cwd: string, loopId?: string): MetaLoopRecord | undefined {
  if (loopId) {
    return loadLoopRecords(cwd).find((loop) => loop.id === loopId)
  }
  return findLatestAcceptedLoop(cwd)
}

export function inferMetaRuntimeStatus(snapshot: MetaRuntimeStatusInput): MetaRuntimeStatus {
  if (!snapshot.latestLoop && !snapshot.acceptedLoop && !snapshot.pendingLoop) {
    return {
      phase: "idle",
      desc: "Ready to start",
    }
  }

  if (snapshot.pendingLoop && snapshot.pendingCards.length > 0) {
    return {
      phase: "deciding",
      loopId: snapshot.pendingLoop.id,
      desc: `${snapshot.pendingLoop.id} is waiting for ${snapshot.pendingCards.length} card decision(s)`,
    }
  }

  const acceptedLoop = snapshot.acceptedLoop
  if (acceptedLoop?.close?.summary) {
    return {
      phase: "complete",
      loopId: acceptedLoop.id,
      desc: acceptedLoop.close.summary,
    }
  }

  if (acceptedLoop?.evaluation) {
    return {
      phase: acceptedLoop.phase === "complete" ? "complete" : "evaluating",
      loopId: acceptedLoop.id,
      desc: acceptedLoop.evaluation.forced_rollback
        ? acceptedLoop.evaluation.rollback_reason ?? `Evaluation requested rollback for ${acceptedLoop.id}`
        : `Evaluation completed for ${acceptedLoop.id}`,
    }
  }

  if (snapshot.acceptedPlans.length > 0) {
    return {
      phase: "executing",
      loopId: acceptedLoop?.id,
      desc:
        acceptedLoop?.execution?.summary ??
        `Execution plans ready for ${acceptedLoop?.id ?? "accepted loop"}: ${snapshot.acceptedPlans.length} plan(s)`,
    }
  }

  const acceptedCards = acceptedLoop?.decision_session?.accepted_cards?.length ?? 0
  if (acceptedCards > 0) {
    return {
      phase: "executing",
      loopId: acceptedLoop?.id,
      desc: `${acceptedLoop?.id ?? "Accepted loop"} has ${acceptedCards} accepted card(s) waiting for execution planning`,
    }
  }

  const latestLoop = snapshot.latestLoop
  if (latestLoop?.status === "running" || latestLoop?.phase === "generate") {
    return {
      phase: "analyzing",
      loopId: latestLoop.id,
      desc: `Loop ${latestLoop.id} is generating candidate cards`,
    }
  }

  if (latestLoop?.phase === "complete" || latestLoop?.decision_session) {
    return {
      phase: "complete",
      loopId: latestLoop.id,
      desc: `Loop ${latestLoop.id} completed`,
    }
  }

  return {
    phase: "idle",
    loopId: latestLoop?.id,
    desc: latestLoop?.id ? `Loop ${latestLoop.id} is idle` : "Ready to start",
  }
}

// ── Tech Debt Summary ─────────────────────────────────────────────

function computeTechDebtSummary(cwd: string): TechDebtSummary {
  const logFiles = listMetaEntryPaths(cwd, "logs", ".md").sort().reverse()
  const recentLogs = logFiles.slice(0, 5).map((f) => {
    try { return fs.readFileSync(f, "utf8") } catch { return "" }
  }).filter(Boolean)

  const allDebtLines: string[] = []
  for (const log of recentLogs) {
    const section = log.split("## 技术债记录")[1]?.split("##")[0] ?? ""
    const lines = section.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim())
    allDebtLines.push(...lines)
  }

  const avgDebt = allDebtLines.length / (recentLogs.length || 1)

  return {
    densityPerLoop: Math.round(avgDebt * 100) / 100,
    totalItems: allDebtLines.length,
    recentLogs: recentLogs.length,
    topItems: allDebtLines.slice(0, 5),
  }
}

// ── Agent Status Summary ──────────────────────────────────────────

function computeAgentStatusSummary(cwd: string): AgentStatusSummary[] {
  const taskFiles = listMetaEntryPaths(cwd, "agentTasks", ".yaml")
  const roleMap = new Map<string, { total: number; done: number; failed: number; running: number; durations: number[]; lastError?: string }>()

  for (const f of taskFiles) {
    try {
      const content = fs.readFileSync(f, "utf8")
      const task = yaml.load(content) as {
        role_id?: string
        status?: string
        duration_ms?: number
        error?: string
      }
      const roleId = task.role_id ?? "unknown"
      const entry = roleMap.get(roleId) ?? { total: 0, done: 0, failed: 0, running: 0, durations: [] }
      entry.total++
      if (task.status === "done") entry.done++
      else if (task.status === "failed") { entry.failed++; entry.lastError = task.error }
      else if (task.status === "running") entry.running++
      if (task.duration_ms != null) entry.durations.push(task.duration_ms)
      roleMap.set(roleId, entry)
    } catch { /* skip malformed */ }
  }

  return Array.from(roleMap.entries()).map(([roleId, data]) => ({
    roleId,
    totalTasks: data.total,
    doneTasks: data.done,
    failedTasks: data.failed,
    runningTasks: data.running,
    avgDurationMs: data.durations.length ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length) : 0,
    lastError: data.lastError,
  })).sort((a, b) => b.totalTasks - a.totalTasks)
}

// ── Watchdog Health Summary ───────────────────────────────────────

function computeWatchdogHealth(cwd: string): WatchdogHealthSummary {
  const anomalyDir = resolveMetaDirectory(cwd, "logs")
  const anomaliesPath = `${anomalyDir}/anomalies`
  if (!fs.existsSync(anomaliesPath)) {
    return { healthy: true, openBreakers: [], recentAnomalyCount: 0 }
  }

  const anomalyFiles = fs.readdirSync(anomaliesPath).filter((f) => f.endsWith(".yaml")).sort().reverse().slice(0, 10)
  let totalAnomalies = 0
  let lastType: string | undefined

  for (const f of anomalyFiles) {
    try {
      const content = fs.readFileSync(`${anomaliesPath}/${f}`, "utf8")
      const entries = yaml.load(content) as unknown[]
      if (Array.isArray(entries)) {
        totalAnomalies += entries.length
        if (entries.length > 0) {
          const last = entries[entries.length - 1] as { type?: string }
          lastType = last?.type
        }
      }
    } catch { /* skip */ }
  }

  return {
    healthy: totalAnomalies === 0,
    openBreakers: [],
    recentAnomalyCount: totalAnomalies,
    lastAnomalyType: lastType,
  }
}

// ── Execution Progress Summary ────────────────────────────────────

function computeExecutionProgress(plans: ExecutionPlan[]): ExecutionProgressSummary {
  let totalTasks = 0
  let completedTasks = 0
  let failedTasks = 0

  for (const plan of plans) {
    for (const task of (plan.tasks ?? [])) {
      totalTasks++
      const status = (task as ExecutionTask).status ?? "pending"
      if (status === "done") completedTasks++
      else if (status === "failed") failedTasks++
    }
  }

  const pendingTasks = totalTasks - completedTasks - failedTasks
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 10000) / 100 : 0

  return {
    totalTasks,
    completedTasks,
    failedTasks,
    pendingTasks,
    completionRate,
  }
}
