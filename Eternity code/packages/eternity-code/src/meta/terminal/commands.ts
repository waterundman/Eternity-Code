import { displayLoopStatus, displayAgentStatus, displayWatchdogStatus } from "./status.js"
import { Watchdog } from "../watchdog/index.js"
import { loadLoopRecords } from "../loop.js"
import { resolveMetaDesignPath } from "../paths.js"
import { loadMetaDesign } from "../design.js"
import * as fs from "fs"

export async function handleMetaStatus(cwd: string): Promise<void> {
  await displayLoopStatus(cwd)
}

export async function handleMetaHistory(cwd: string): Promise<void> {
  const designPath = resolveMetaDesignPath(cwd)
  if (!fs.existsSync(designPath)) {
    console.log("[MetaTerminal] No MetaDesign found. Run /meta-init first.")
    return
  }

  const design = await loadMetaDesign(cwd)
  if (!design) {
    console.log("[MetaTerminal] Failed to load MetaDesign.")
    return
  }

  const loops = await loadLoopRecords(cwd)
  const divider = "-".repeat(56)

  console.log("")
  console.log(divider)
  console.log("  LOOP HISTORY")
  console.log(divider)
  console.log(`  Project: ${design.project.name} (${design.project.stage})`)
  console.log(`  Total loops: ${design.loop_history?.total_loops ?? loops.length}`)
  console.log("")

  if (loops.length === 0) {
    console.log("  No loops recorded yet.")
    console.log(divider)
    console.log("")
    return
  }

  const maxDisplay = 10
  const displayLoops = loops.slice(0, maxDisplay)

  console.log(`  ${pad("ID", 16)} ${pad("STATUS", 14)} ${pad("PHASE", 10)} CARDS`)
  console.log(`  ${"-".repeat(52)}`)

  for (const loop of displayLoops) {
    const status = formatStatusIcon(loop.status ?? "unknown")
    const phase = loop.phase ?? "-"
    const accepted = loop.decision_session?.accepted_cards?.length ?? 0
    const rejected = loop.decision_session?.rejected_cards?.length ?? 0
    const cards = accepted + rejected > 0 ? `${accepted}/${accepted + rejected}` : "-"

    const delta = loop.evaluation?.composite_delta
    const deltaStr = delta != null ? ` (${formatDelta(delta)})` : ""

    console.log(`  ${pad(loop.id, 16)} ${pad(status, 14)} ${pad(phase, 10)} ${cards}${deltaStr}`)

    if (loop.close?.summary) {
      console.log(`  ${" ".repeat(16)} ${loop.close.summary}`)
    }
  }

  if (loops.length > maxDisplay) {
    console.log(`  ... and ${loops.length - maxDisplay} more`)
  }

  // Show design-level loop history summary
  const historyLoops = design.loop_history?.loops ?? []
  if (historyLoops.length > 0) {
    console.log("")
    console.log("  Score Progress:")
    const recentHistory = historyLoops.slice(-5)
    for (const entry of recentHistory) {
      const delta = entry.composite_score_delta ?? 0
      const status = formatStatusIcon(entry.status ?? "unknown")
      console.log(`    ${status} ${entry.loop_id}: ${formatDelta(delta)}`)
    }
  }

  console.log(divider)
  console.log("")
}

export async function handleMetaWatchdog(cwd: string, watchdog?: Watchdog): Promise<void> {
  await displayWatchdogStatus(cwd, watchdog)
}

function pad(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len)
  return str + " ".repeat(len - str.length)
}

function formatStatusIcon(status: string): string {
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
