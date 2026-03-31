/**
 * Query Engine
 *
 * Unified data query layer for TUI, Dashboard, and CLI.
 * Orchestrates runtime manifest + card backlog + loop history + agent-tasks + anomalies
 * into standardized summary outputs (Markdown/JSON).
 *
 * Inspired by the QueryEnginePort pattern from claude-code-main/src/query_engine.py
 */

import { loadMetaRuntimeSnapshot, type MetaRuntimeSnapshot, type AgentStatusSummary } from "./runtime.js"
import { loadLoopRecords, type MetaLoopRecord, type MetaDecisionCard } from "./loop.js"
import { loadMetaDesign } from "./design.js"
import { assessQuality, formatQualityReport } from "./quality-monitor.js"
import { listMetaEntryPaths } from "./paths.js"
import * as fs from "fs"
import yaml from "js-yaml"

export interface QuerySummaryOptions {
  includeQuality?: boolean
  includeAgents?: boolean
  includeWatchdog?: boolean
  includeTechDebt?: boolean
  includeLoops?: boolean
  loopLimit?: number
}

export interface CardBacklogItem {
  id: string
  loopId: string
  objective: string
  status: "pending" | "accepted" | "rejected"
  confidence: number
  reqRefs: string[]
  createdAt?: string
  resolvedAt?: string
  note?: string
}

export interface CardBacklog {
  title: string
  items: CardBacklogItem[]
  stats: {
    total: number
    pending: number
    accepted: number
    rejected: number
  }
}

export class QueryEngine {
  private cwd: string

  constructor(cwd: string) {
    this.cwd = cwd
  }

  /**
   * Load a fresh runtime snapshot.
   */
  async snapshot(): Promise<MetaRuntimeSnapshot> {
    return loadMetaRuntimeSnapshot(this.cwd)
  }

  /**
   * Render a Markdown summary of the entire workspace.
   */
  async renderSummary(options: QuerySummaryOptions = {}): Promise<string> {
    const {
      includeQuality = true,
      includeAgents = true,
      includeWatchdog = true,
      includeTechDebt = true,
      includeLoops = true,
      loopLimit = 5,
    } = options

    const snapshot = await this.snapshot()
    const sections: string[] = []

    // Header
    sections.push("# Eternity Code Runtime Summary")
    sections.push("")

    // Status
    sections.push(`**Phase**: ${snapshot.status.phase}`)
    sections.push(`**Status**: ${snapshot.status.desc}`)
    if (snapshot.status.loopId) {
      sections.push(`**Loop**: ${snapshot.status.loopId}`)
    }
    sections.push("")

    // Stats
    sections.push("## Stats")
    sections.push("")
    sections.push(`- Total loops: ${snapshot.stats.totalLoops}`)
    sections.push(`- Pending cards: ${snapshot.stats.pendingCards}`)
    sections.push(`- Latest plans: ${snapshot.stats.latestPlanCount}`)
    sections.push(`- Accepted plans: ${snapshot.stats.acceptedPlanCount}`)
    sections.push("")

    // Execution Progress
    const ep = snapshot.executionProgress
    if (ep.totalTasks > 0) {
      sections.push("## Execution Progress")
      sections.push("")
      sections.push(`- Total tasks: ${ep.totalTasks}`)
      sections.push(`- Completed: ${ep.completedTasks}`)
      sections.push(`- Failed: ${ep.failedTasks}`)
      sections.push(`- Pending: ${ep.pendingTasks}`)
      sections.push(`- Completion rate: ${ep.completionRate}%`)
      sections.push("")
    }

    // Quality
    if (includeQuality) {
      sections.push("## Quality")
      sections.push("")
      sections.push(`- Tech debt density: ${snapshot.quality.tech_debt_density.toFixed(1)} items/loop`)
      sections.push(`- Rollback rate: ${(snapshot.quality.rollback_rate * 100).toFixed(0)}%`)
      sections.push(`- TODO count: ${snapshot.quality.todo_count}`)
      sections.push(`- SOTA trigger: ${snapshot.quality.should_trigger_sota ? "Yes" : "No"}`)
      if (snapshot.quality.triggered_by.length > 0) {
        sections.push("")
        for (const reason of snapshot.quality.triggered_by) {
          sections.push(`  - ⚠ ${reason}`)
        }
      }
      sections.push("")
    }

    // Tech Debt
    if (includeTechDebt && snapshot.techDebt.totalItems > 0) {
      sections.push("## Tech Debt")
      sections.push("")
      sections.push(`- Density: ${snapshot.techDebt.densityPerLoop} items/loop`)
      sections.push(`- Total items: ${snapshot.techDebt.totalItems}`)
      sections.push("")
      for (const item of snapshot.techDebt.topItems) {
        sections.push(`- ${item}`)
      }
      sections.push("")
    }

    // Agents
    if (includeAgents && snapshot.agents.length > 0) {
      sections.push("## Agent Activity")
      sections.push("")
      sections.push("| Role | Total | Done | Failed | Running | Avg Duration |")
      sections.push("|------|-------|------|--------|---------|-------------|")
      for (const agent of snapshot.agents) {
        const avg = agent.avgDurationMs > 0 ? `${(agent.avgDurationMs / 1000).toFixed(1)}s` : "—"
        sections.push(`| ${agent.roleId} | ${agent.totalTasks} | ${agent.doneTasks} | ${agent.failedTasks} | ${agent.runningTasks} | ${avg} |`)
      }
      sections.push("")
    }

    // Watchdog
    if (includeWatchdog) {
      sections.push("## Watchdog")
      sections.push("")
      sections.push(`- Healthy: ${snapshot.watchdog.healthy ? "Yes" : "No"}`)
      sections.push(`- Recent anomalies: ${snapshot.watchdog.recentAnomalyCount}`)
      if (snapshot.watchdog.lastAnomalyType) {
        sections.push(`- Last anomaly: ${snapshot.watchdog.lastAnomalyType}`)
      }
      if (snapshot.watchdog.openBreakers.length > 0) {
        sections.push("")
        for (const breaker of snapshot.watchdog.openBreakers) {
          sections.push(`- ✗ ${breaker}`)
        }
      }
      sections.push("")
    }

    // Recent Loops
    if (includeLoops) {
      const loops = loadLoopRecords(this.cwd).slice(0, loopLimit)
      if (loops.length > 0) {
        sections.push("## Recent Loops")
        sections.push("")
        sections.push("| Loop | Status | Phase | Cards | Delta |")
        sections.push("|------|--------|-------|-------|-------|")
        for (const loop of loops) {
          const cardCount = (loop.decision_session?.accepted_cards?.length ?? 0) +
                            (loop.decision_session?.rejected_cards?.length ?? 0)
          const delta = loop.evaluation?.composite_delta
          const deltaStr = delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}` : "—"
          const statusIcon = loop.status === "rolled_back" ? "✗" : loop.status === "completed" ? "✓" : "~"
          sections.push(`| ${loop.id} | ${statusIcon} ${loop.status ?? "—"} | ${loop.phase ?? "—"} | ${cardCount} | ${deltaStr} |`)
        }
        sections.push("")
      }
    }

    // Card Backlog
    const backlog = await this.cardBacklog()
    if (backlog.items.length > 0) {
      sections.push("## Card Backlog")
      sections.push("")
      sections.push(`Total: ${backlog.stats.total} | Pending: ${backlog.stats.pending} | Accepted: ${backlog.stats.accepted} | Rejected: ${backlog.stats.rejected}`)
      sections.push("")
      for (const item of backlog.items.slice(0, 10)) {
        const statusIcon = item.status === "accepted" ? "✓" : item.status === "rejected" ? "✗" : "○"
        sections.push(`- ${statusIcon} **${item.id}** [${item.loopId}] ${item.objective}`)
        if (item.reqRefs.length > 0) {
          sections.push(`  - Refs: ${item.reqRefs.join(", ")}`)
        }
        if (item.note) {
          sections.push(`  - Note: ${item.note}`)
        }
      }
      sections.push("")
    }

    return sections.join("\n")
  }

  /**
   * Build a structured card backlog from all loops.
   */
  async cardBacklog(): Promise<CardBacklog> {
    const loops = loadLoopRecords(this.cwd)
    const items: CardBacklogItem[] = []

    for (const loop of loops) {
      const cardIds = [
        ...(loop.candidates?.presented_cards ?? []),
        ...(loop.decision_session?.accepted_cards ?? []),
        ...(loop.decision_session?.rejected_cards ?? []),
      ]
      const uniqueIds = [...new Set(cardIds.filter(Boolean))]

      for (const cardId of uniqueIds) {
        const cardPath = listMetaEntryPaths(this.cwd, "cards", ".yaml")
          .find((f) => f.endsWith(`${cardId}.yaml`))
        if (!cardPath) continue

        try {
          const content = fs.readFileSync(cardPath, "utf8")
          const card = yaml.load(content) as {
            id?: string
            loop_id?: string
            content?: { objective?: string }
            prediction?: { confidence?: number }
            req_refs?: string[]
            decision?: { status?: string; note?: string; resolved_at?: string }
            created_at?: string
          }
          if (!card?.id) continue

          items.push({
            id: card.id,
            loopId: card.loop_id ?? loop.id,
            objective: card.content?.objective ?? "",
            status: (card.decision?.status as CardBacklogItem["status"]) ?? "pending",
            confidence: card.prediction?.confidence ?? 0,
            reqRefs: card.req_refs ?? [],
            createdAt: card.created_at,
            resolvedAt: card.decision?.resolved_at,
            note: card.decision?.note,
          })
        } catch { /* skip malformed */ }
      }
    }

    const pending = items.filter((i) => i.status === "pending").length
    const accepted = items.filter((i) => i.status === "accepted").length
    const rejected = items.filter((i) => i.status === "rejected").length

    return {
      title: "Card Backlog",
      items,
      stats: { total: items.length, pending, accepted, rejected },
    }
  }

  /**
   * Render a quality report.
   */
  renderQualityReport(): string {
    return formatQualityReport(assessQuality(this.cwd))
  }

  /**
   * Get agent activity summary.
   */
  async agentSummary(): Promise<AgentStatusSummary[]> {
    const snapshot = await this.snapshot()
    return snapshot.agents
  }

  /**
   * Get loop history.
   */
  loopHistory(limit: number = 10): MetaLoopRecord[] {
    return loadLoopRecords(this.cwd).slice(0, limit)
  }
}
