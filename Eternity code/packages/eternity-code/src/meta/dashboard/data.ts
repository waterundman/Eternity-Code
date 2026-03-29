import fs from "fs"
import path from "path"
import yaml from "js-yaml"
import type { AgentTask } from "../agents/types.js"
import { getCoverageStats } from "../coverage.js"
import { loadLatestContextMixSnapshot, type ContextMixSnapshot } from "../context-mixer.js"
import { listMetaEntryPaths, type MetaCompatDirectoryKey } from "../paths.js"
import { PromptFeedbackLoop, type TemplateQualityScore } from "../prompt/feedback-loop.js"
import { loadMetaRuntimeSnapshot, type MetaRuntimeSnapshot } from "../runtime.js"
import type { MetaDesign } from "../types.js"

export type DashboardCoverageStats = ReturnType<typeof getCoverageStats>

export interface DashboardAgentTaskStats {
  total: number
  byStatus: {
    done: number
    failed: number
    running: number
  }
  byRole: Record<string, number>
  avgDurationMs: number
  totalDurationMs: number
}

export interface DashboardUsageStats {
  tokens: number
  cost: number
  loops: number
}

export interface DashboardBootstrap {
  runtime: MetaRuntimeSnapshot
  agentTasks: AgentTask[]
  agentTaskStats: DashboardAgentTaskStats
  coverage: DashboardCoverageStats | null
  latestContext: ContextMixSnapshot | null
  feedback: {
    scores: TemplateQualityScore[]
    suggestions: string[]
  }
  usage: DashboardUsageStats
  currentModel: string
  generatedAt: string
}

export async function loadDashboardBootstrap(
  cwd: string,
  options: {
    agentTaskLimit?: number
  } = {},
): Promise<DashboardBootstrap> {
  const runtime = await loadMetaRuntimeSnapshot(cwd)
  const allAgentTasks = readMetaYamlDirectory<AgentTask>(cwd, "agentTasks", 1000)
  const agentTasks = options.agentTaskLimit
    ? allAgentTasks.slice(0, options.agentTaskLimit)
    : allAgentTasks

  const feedbackLoop = new PromptFeedbackLoop(cwd)

  return {
    runtime,
    agentTasks,
    agentTaskStats: computeAgentTaskStats(allAgentTasks),
    coverage: runtime.design ? getCoverageStats(runtime.design) : null,
    latestContext: loadLatestContextMixSnapshot(cwd),
    feedback: {
      scores: feedbackLoop.getAllQualityScores(),
      suggestions: feedbackLoop.generateOptimizationSuggestions(),
    },
    usage: loadUsageStats(runtime.design),
    currentModel: loadCurrentModel(cwd),
    generatedAt: new Date().toISOString(),
  }
}

export function computeAgentTaskStats(tasks: AgentTask[]): DashboardAgentTaskStats {
  const stats: DashboardAgentTaskStats = {
    total: tasks.length,
    byStatus: {
      done: 0,
      failed: 0,
      running: 0,
    },
    byRole: {},
    avgDurationMs: 0,
    totalDurationMs: 0,
  }

  let totalDuration = 0
  for (const task of tasks) {
    if (task.status === "done") stats.byStatus.done++
    if (task.status === "failed") stats.byStatus.failed++
    if (task.status === "running") stats.byStatus.running++

    if (task.role_id) {
      stats.byRole[task.role_id] = (stats.byRole[task.role_id] ?? 0) + 1
    }

    if (task.duration_ms) {
      totalDuration += task.duration_ms
    }
  }

  stats.totalDurationMs = totalDuration
  stats.avgDurationMs = tasks.length > 0 ? Math.round(totalDuration / tasks.length) : 0
  return stats
}

export function loadUsageStats(design: Pick<MetaDesign, "loop_history"> | null | undefined): DashboardUsageStats {
  const loops = design?.loop_history?.loops ?? []

  let totalTokens = 0
  let totalCost = 0

  for (const loop of loops) {
    totalTokens += (loop as { tokens_used?: number }).tokens_used ?? 0
    totalCost += (loop as { cost?: number }).cost ?? 0
  }

  return {
    tokens: totalTokens,
    cost: totalCost,
    loops: loops.length,
  }
}

export function loadCurrentModel(cwd: string): string {
  const config = readJsonFile<{ model?: string }>(path.join(cwd, "eternity-code.json"))
  return config?.model ?? ""
}

export function readMetaYamlDirectory<T = any>(
  cwd: string,
  key: MetaCompatDirectoryKey,
  limit?: number,
): T[] {
  return listMetaEntryPaths(cwd, key, ".yaml")
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left)))
    .slice(0, limit ?? Number.MAX_SAFE_INTEGER)
    .map((filePath) => readYamlFile<T>(filePath))
    .filter((value): value is T => value !== null)
}

export function readYamlDirectory<T = any>(dir: string, limit?: number): T[] {
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .reverse()
    .slice(0, limit ?? Number.MAX_SAFE_INTEGER)
    .map((file) => readYamlFile<T>(path.join(dir, file)))
    .filter((value): value is T => value !== null)
}

export function readYamlFile<T = any>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null
  return yaml.load(fs.readFileSync(filePath, "utf8")) as T
}

export function readJsonFile<T = any>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T
  } catch {
    return null
  }
}
