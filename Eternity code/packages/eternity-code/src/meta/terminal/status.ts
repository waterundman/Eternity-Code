import { loadMetaRuntimeSnapshot, type MetaRuntimeSnapshot } from "../runtime.js"
import { loadLoopRecords, type MetaLoopRecord } from "../loop.js"
import { Watchdog } from "../watchdog/index.js"
import type { WatchdogStatus, AnomalyEvent } from "../watchdog/types.js"
import type { AgentTask } from "../agents/types.js"
import { resolveMetaDirectory } from "../paths.js"
import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"

function repeat(ch: string, n: number): string {
  return ch.repeat(Math.max(0, n))
}

function padRight(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len)
  return str + " ".repeat(len - str.length)
}

function formatPhase(phase: string): string {
  const icons: Record<string, string> = {
    idle: "[~]",
    analyzing: "[..]",
    deciding: "[?]",
    executing: "[>]",
    evaluating: "[*]",
    complete: "[v]",
  }
  return `${icons[phase] ?? "[ ]"} ${phase}`
}

function formatLoopStatus(status: string): string {
  switch (status) {
    case "completed":
      return "[OK]"
    case "rolled_back":
      return "[X]"
    case "running":
      return "[>]"
    case "aborted":
      return "[!]"
    default:
      return "[~]"
  }
}

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? "+" : ""
  return `${sign}${delta.toFixed(2)}`
}

function formatTimestamp(iso?: string): string {
  if (!iso) return "N/A"
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch {
    return iso
  }
}

export async function displayLoopStatus(cwd: string): Promise<void> {
  let snapshot: MetaRuntimeSnapshot
  try {
    snapshot = await loadMetaRuntimeSnapshot(cwd)
  } catch {
    console.log("[MetaTerminal] No MetaDesign found. Run /meta-init first.")
    return
  }

  const divider = repeat("-", 56)

  console.log("")
  console.log(divider)
  console.log("  LOOP STATUS")
  console.log(divider)

  console.log(`  Phase: ${formatPhase(snapshot.status.phase)}`)
  if (snapshot.status.loopId) {
    console.log(`  Loop:  ${snapshot.status.loopId}`)
  }
  console.log(`  Desc:  ${snapshot.status.desc}`)
  console.log("")

  console.log(`  Total loops:      ${snapshot.stats.totalLoops}`)
  console.log(`  Pending cards:    ${snapshot.stats.pendingCards}`)
  console.log(`  Latest plans:     ${snapshot.stats.latestPlanCount}`)
  console.log(`  Accepted plans:   ${snapshot.stats.acceptedPlanCount}`)

  if (snapshot.latestLoop) {
    console.log("")
    console.log("  Latest Loop:")
    printLoopSummary(snapshot.latestLoop, "    ")
  }

  if (snapshot.pendingLoop && snapshot.pendingCards.length > 0) {
    console.log("")
    console.log("  Pending Decision:")
    console.log(`    Loop: ${snapshot.pendingLoop.id}`)
    console.log(`    Cards waiting: ${snapshot.pendingCards.length}`)
    for (const card of snapshot.pendingCards.slice(0, 5)) {
      const conf = card.prediction?.confidence ?? 0
      const confBar = repeat("#", Math.round(conf * 8)).padEnd(8, "-")
      console.log(`      ${card.id} [${confBar}] ${(conf * 100).toFixed(0)}%`)
      console.log(`        ${card.content.objective}`)
    }
  }

  console.log(divider)
  console.log("")
}

export async function displayAgentStatus(cwd: string): Promise<void> {
  const divider = repeat("-", 56)

  console.log("")
  console.log(divider)
  console.log("  AGENT DISPATCH STATUS")
  console.log(divider)

  const tasksDir = resolveMetaDirectory(cwd, "agentTasks")
  if (!fs.existsSync(tasksDir)) {
    console.log("  No agent tasks recorded yet.")
    console.log(divider)
    console.log("")
    return
  }

  const files = fs.readdirSync(tasksDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .reverse()
    .slice(0, 10)

  if (files.length === 0) {
    console.log("  No agent tasks recorded yet.")
    console.log(divider)
    console.log("")
    return
  }

  const tasks: AgentTask[] = []
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(tasksDir, file), "utf8")
      const task = yaml.load(content) as AgentTask
      if (task?.id) tasks.push(task)
    } catch {
      // skip invalid files
    }
  }

  const running = tasks.filter((t) => t.status === "running").length
  const done = tasks.filter((t) => t.status === "done").length
  const failed = tasks.filter((t) => t.status === "failed").length

  console.log(`  Recent tasks: ${tasks.length}  [${done} done, ${running} running, ${failed} failed]`)
  console.log("")

  const header = `  ${padRight("ID", 20)} ${padRight("ROLE", 18)} ${padRight("STATUS", 10)} DURATION`
  console.log(header)
  console.log(`  ${repeat("-", 52)}`)

  for (const task of tasks) {
    const statusIcon = task.status === "done" ? "[OK]" : task.status === "failed" ? "[X]" : task.status === "running" ? "[>]" : "[~]"
    const duration = task.duration_ms != null ? `${task.duration_ms}ms` : "-"
    console.log(
      `  ${padRight(task.id, 20)} ${padRight(task.role_id, 18)} ${padRight(statusIcon, 10)} ${duration}`,
    )
  }

  console.log(divider)
  console.log("")
}

export async function displayWatchdogStatus(cwd: string, watchdog?: Watchdog): Promise<void> {
  const divider = repeat("-", 56)

  console.log("")
  console.log(divider)
  console.log("  WATCHDOG STATUS")
  console.log(divider)

  if (!watchdog) {
    watchdog = new Watchdog(cwd)
  }

  const status = watchdog.getStatus()

  console.log(`  Healthy: ${status.healthy ? "YES" : "NO"}`)
  console.log("")

  if (status.open_breakers.length > 0) {
    console.log("  Open Circuit Breakers:")
    for (const breaker of status.open_breakers) {
      console.log(`    ${breaker}`)
    }
  } else {
    console.log("  Circuit Breakers: all closed")
  }

  console.log("")

  if (status.recent_anomalies.length > 0) {
    console.log("  Recent Anomalies:")
    for (const anomaly of status.recent_anomalies) {
      printAnomaly(anomaly, "    ")
    }
  } else {
    console.log("  Anomalies: none")
  }

  // Also load persisted anomalies from disk
  const persistedAnomalies = loadPersistedAnomalies(cwd)
  if (persistedAnomalies.length > 0) {
    console.log("")
    console.log(`  Persisted anomaly files: ${persistedAnomalies.length}`)
  }

  console.log(divider)
  console.log("")
}

function printLoopSummary(loop: MetaLoopRecord, indent: string): void {
  const statusStr = formatLoopStatus(loop.status ?? "unknown")
  console.log(`${indent}${statusStr} ${loop.id}`)

  if (loop.phase) {
    console.log(`${indent}Phase: ${loop.phase}`)
  }
  if (loop.started_at) {
    console.log(`${indent}Started: ${formatTimestamp(loop.started_at)}`)
  }
  if (loop.completed_at) {
    console.log(`${indent}Completed: ${formatTimestamp(loop.completed_at)}`)
  }

  const accepted = loop.decision_session?.accepted_cards?.length ?? 0
  const rejected = loop.decision_session?.rejected_cards?.length ?? 0
  if (accepted + rejected > 0) {
    console.log(`${indent}Cards: ${accepted} accepted, ${rejected} rejected`)
  }

  if (loop.evaluation) {
    const delta = loop.evaluation.composite_delta ?? 0
    console.log(`${indent}Score delta: ${formatDelta(delta)}`)
    if (loop.evaluation.forced_rollback) {
      console.log(`${indent}ROLLBACK: ${loop.evaluation.rollback_reason ?? "evaluation failed"}`)
    }
  }

  if (loop.execution?.summary) {
    console.log(`${indent}Execution: ${loop.execution.summary}`)
  }

  if (loop.close?.summary) {
    console.log(`${indent}Summary: ${loop.close.summary}`)
  }
}

function printAnomaly(event: AnomalyEvent, indent: string): void {
  const icons: Record<string, string> = {
    infinite_loop: "inf",
    token_overflow: "tok",
    network_error: "net",
    hallucination_loop: "loop",
    empty_response: "empty",
    rate_limit: "rate",
    timeout: "time",
    circuit_open: "circuit",
  }
  const icon = icons[event.type] ?? "!"
  const time = event.detected_at ? formatTimestamp(event.detected_at) : ""
  console.log(`${indent}[${icon}] ${event.agent_role}: ${event.detail}`)
  if (time) {
    console.log(`${indent}  at ${time}`)
  }
}

function loadPersistedAnomalies(cwd: string): string[] {
  try {
    const dir = resolveMetaDirectory(cwd, "logs")
    const anomaliesDir = path.join(dir, "anomalies")
    if (!fs.existsSync(anomaliesDir)) return []
    return fs.readdirSync(anomaliesDir).filter((f) => f.endsWith(".yaml"))
  } catch {
    return []
  }
}
