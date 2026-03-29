/**
 * Context Mixer Module
 *
 * Implements a structured 3-layer context pipeline:
 * - Short-Term: current task, target files, recent actions, relevant snippets
 * - Mid-Term: compressed project state and constraints
 * - Long-Term: lightweight retrieval from persisted project state
 * - Total mixed context should stay within 40% of the configured budget
 */

import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { MetaDesign } from "./types.js"

/**
 * Context layer budget configuration.
 */
export interface ContextLayerConfig {
  maxTokens: number
  maxPercent: number
}

export interface ContextBudget {
  shortTerm: ContextLayerConfig
  midTerm: ContextLayerConfig
  longTerm: ContextLayerConfig
  system: ContextLayerConfig
  total: number
}

/**
 * Default token budget.
 */
export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  shortTerm: { maxTokens: 200000, maxPercent: 0.20 },
  midTerm: { maxTokens: 200000, maxPercent: 0.20 },
  longTerm: { maxTokens: 100000, maxPercent: 0.10 },
  system: { maxTokens: 50000, maxPercent: 0.05 },
  total: 550000,
}

export interface ShortTermContext {
  task: string
  targetFiles: string[]
  recentActions: string[]
  codeSnippets: Array<{
    file: string
    content: string
    relevance: number
  }>
}

export interface MidTermMemory {
  currentModule: string
  primaryGoal: string
  completed: string[]
  pending: string[]
  constraints: string[]
}

export interface LongTermMemory {
  results: Array<{
    content: string
    source: string
    relevance: number
  }>
}

export interface ContextMixerConfig {
  budget: ContextBudget
  ragTopK: number
  enableDeduplication: boolean
}

export const DEFAULT_MIXER_CONFIG: ContextMixerConfig = {
  budget: DEFAULT_CONTEXT_BUDGET,
  ragTopK: 5,
  enableDeduplication: true,
}

export type ContextLayerName = "system" | "midTerm" | "shortTerm" | "longTerm"

export interface ContextLayerUsage {
  tokens: number
  limit: number
  truncated: boolean
}

export interface ContextMixDiagnostics {
  totalTokens: number
  recommendedMaxTokens: number
  withinBudget: boolean
  layerUsage: Record<ContextLayerName, ContextLayerUsage>
  longTermSources: string[]
}

export interface ContextMixResult {
  text: string
  diagnostics: ContextMixDiagnostics
}

export interface ContextMixSnapshot {
  taskId: string
  roleId: string
  triggeredBy: string
  createdAt: string
  task: string
  targetFiles: string[]
  rolePromptTokens: number
  finalSystemPromptTokens: number
  preview: string
  diagnostics: ContextMixDiagnostics
  layers: {
    shortTerm: ShortTermContext
    midTerm: MidTermMemory
    longTerm: LongTermMemory
  }
}

type InternalLayerState = {
  text: string
  tokens: number
  limit: number
  truncated: boolean
}

/**
 * Estimate token count using a lightweight character heuristic.
 */
export function estimateTokens(text: string): number {
  const englishChars = text.replace(/[^\x00-\x7F]/g, "").length
  const nonEnglishChars = text.length - englishChars
  return Math.ceil(englishChars / 4 + nonEnglishChars / 2)
}

/**
 * Truncate text to the requested token budget.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (!text || maxTokens <= 0) return ""

  const currentTokens = estimateTokens(text)
  if (currentTokens <= maxTokens) return text

  const ratio = maxTokens / currentTokens
  const targetLength = Math.max(0, Math.floor(text.length * ratio * 0.9))
  return text.slice(0, targetLength) + "\n... (truncated)"
}

export class ContextMixer {
  private config: ContextMixerConfig

  constructor(config: Partial<ContextMixerConfig> = {}) {
    this.config = { ...DEFAULT_MIXER_CONFIG, ...config }
  }

  buildShortTermContext(
    task: string,
    targetFiles: string[],
    recentActions: string[] = [],
    codeSnippets: ShortTermContext["codeSnippets"] = [],
  ): ShortTermContext {
    return {
      task,
      targetFiles: targetFiles.slice(0, 5),
      recentActions: recentActions.slice(0, 2),
      codeSnippets: codeSnippets.sort((a, b) => b.relevance - a.relevance).slice(0, 10),
    }
  }

  buildMidTermMemory(
    design: MetaDesign | null,
    completedTasks: string[] = [],
    pendingTasks: string[] = [],
  ): MidTermMemory {
    const reqs = design?.requirements ?? []
    const lowCoverageReqs = reqs
      .filter((r) => (r.coverage ?? 0) < 0.8)
      .slice(0, 3)
      .map((r) => r.id)

    const immutableConstraints = (design?.constraints?.immutable_modules ?? [])
      .slice(0, 3)
      .map((item) => `immutable: ${item.path}`)

    return {
      currentModule: design?.project?.name ?? "Unknown",
      primaryGoal: design?.project?.core_value ?? "",
      completed: completedTasks.slice(0, 10),
      pending: [...lowCoverageReqs, ...pendingTasks].slice(0, 10),
      constraints: [...(design?.constraints?.compliance ?? []).slice(0, 5), ...immutableConstraints].slice(0, 8),
    }
  }

  async buildLongTermMemory(query: string, cwd: string): Promise<LongTermMemory> {
    const metaDir = path.join(cwd, ".meta")
    if (!fs.existsSync(metaDir)) {
      return { results: [] }
    }

    const keywords = normalizeQueryKeywords(query)
    if (keywords.length === 0) {
      return { results: [] }
    }

    const candidates: Array<LongTermMemory["results"][number] & { mtimeMs: number }> = []
    for (const filePath of collectSearchFiles(metaDir)) {
      try {
        const content = fs.readFileSync(filePath, "utf8")
        const relevance = scoreContent(content, keywords)
        if (relevance <= 0) continue

        const stat = fs.statSync(filePath)
        candidates.push({
          content: extractRelevantSnippet(content, keywords, 700),
          source: path.relative(cwd, filePath).replace(/\\/g, "/"),
          relevance,
          mtimeMs: stat.mtimeMs,
        })
      } catch {
        continue
      }
    }

    const results = candidates
      .sort((a, b) => {
        if (b.relevance !== a.relevance) return b.relevance - a.relevance
        if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs
        return a.source.localeCompare(b.source)
      })
      .slice(0, this.config.ragTopK)
      .map(({ mtimeMs: _mtimeMs, ...result }) => result)

    return { results }
  }

  async mix(
    shortTerm: ShortTermContext,
    midTerm: MidTermMemory,
    longTerm: LongTermMemory,
    systemPrompt: string = "",
  ): Promise<string> {
    return (await this.mixDetailed(shortTerm, midTerm, longTerm, systemPrompt)).text
  }

  async mixDetailed(
    shortTerm: ShortTermContext,
    midTerm: MidTermMemory,
    longTerm: LongTermMemory,
    systemPrompt: string = "",
  ): Promise<ContextMixResult> {
    const states: Record<ContextLayerName, InternalLayerState> = {
      system: this.limitLayer("system", systemPrompt),
      midTerm: this.limitLayer("midTerm", this.formatMidTermMemory(midTerm)),
      shortTerm: this.limitLayer("shortTerm", this.formatShortTermContext(shortTerm)),
      longTerm: this.limitLayer(
        "longTerm",
        longTerm.results.length > 0 ? this.formatLongTermMemory(longTerm) : "",
      ),
    }

    const recommendedMaxTokens = Math.floor(this.config.budget.total * 0.4)
    let totalTokens = getCombinedTokens(states)

    if (totalTokens > recommendedMaxTokens) {
      totalTokens = this.rebalanceWithinBudget(states, recommendedMaxTokens)
    }

    let text = joinLayerStates(states)
    if (this.config.enableDeduplication) {
      text = this.deduplicate(text)
    }

    const finalTokens = estimateTokens(text)
    return {
      text,
      diagnostics: {
        totalTokens: finalTokens,
        recommendedMaxTokens,
        withinBudget: finalTokens <= recommendedMaxTokens,
        layerUsage: {
          system: this.toUsage(states.system),
          midTerm: this.toUsage(states.midTerm),
          shortTerm: this.toUsage(states.shortTerm),
          longTerm: this.toUsage(states.longTerm),
        },
        longTermSources: longTerm.results.map((item) => item.source),
      },
    }
  }

  private limitLayer(layer: ContextLayerName, text: string): InternalLayerState {
    const limit = resolveLayerLimit(this.config.budget[layer], this.config.budget.total)
    const limitedText = truncateToTokens(text, limit)
    return {
      text: limitedText,
      tokens: estimateTokens(limitedText),
      limit,
      truncated: limitedText !== text,
    }
  }

  private rebalanceWithinBudget(states: Record<ContextLayerName, InternalLayerState>, maxTokens: number): number {
    const minimumTokens: Record<ContextLayerName, number> = {
      system: states.system.tokens,
      midTerm: states.midTerm.text ? Math.min(states.midTerm.tokens, 12) : 0,
      shortTerm: states.shortTerm.text ? Math.min(states.shortTerm.tokens, 16) : 0,
      longTerm: 0,
    }

    let totalTokens = getCombinedTokens(states)
    for (const layer of ["longTerm", "shortTerm", "midTerm"] as const) {
      if (totalTokens <= maxTokens) break

      const state = states[layer]
      if (!state.text) continue

      const removable = Math.max(0, state.tokens - minimumTokens[layer])
      if (removable === 0) continue

      const overflow = totalTokens - maxTokens
      const targetTokens = Math.max(minimumTokens[layer], state.tokens - Math.min(removable, overflow))
      const nextText = truncateToTokens(state.text, targetTokens)
      state.text = nextText
      state.tokens = estimateTokens(nextText)
      state.truncated = true
      totalTokens = getCombinedTokens(states)
    }

    return totalTokens
  }

  private toUsage(state: InternalLayerState): ContextLayerUsage {
    return {
      tokens: state.tokens,
      limit: state.limit,
      truncated: state.truncated,
    }
  }

  private formatShortTermContext(ctx: ShortTermContext): string {
    const parts: string[] = ["[Current Task]", ctx.task]

    if (ctx.targetFiles.length > 0) {
      parts.push("\n[Target Files]")
      ctx.targetFiles.forEach((file) => parts.push(`  - ${file}`))
    }

    if (ctx.recentActions.length > 0) {
      parts.push("\n[Recent Actions]")
      ctx.recentActions.forEach((action) => parts.push(`  - ${action}`))
    }

    if (ctx.codeSnippets.length > 0) {
      parts.push("\n[Code Snippets]")
      ctx.codeSnippets.forEach((snippet) => {
        parts.push(`\n// ${snippet.file} (relevance: ${snippet.relevance.toFixed(2)})`)
        parts.push(snippet.content.slice(0, 500))
      })
    }

    return parts.join("\n")
  }

  private formatMidTermMemory(mem: MidTermMemory): string {
    const parts: string[] = ["[Project State]", `Module: ${mem.currentModule}`, `Goal: ${mem.primaryGoal}`]

    if (mem.completed.length > 0) {
      parts.push("\n[Completed]")
      mem.completed.forEach((item) => parts.push(`  - ${item}`))
    }

    if (mem.pending.length > 0) {
      parts.push("\n[Pending]")
      mem.pending.forEach((item) => parts.push(`  - ${item}`))
    }

    if (mem.constraints.length > 0) {
      parts.push("\n[Constraints]")
      mem.constraints.forEach((item) => parts.push(`  ! ${item}`))
    }

    return parts.join("\n")
  }

  private formatLongTermMemory(mem: LongTermMemory): string {
    const parts: string[] = ["[Retrieved Knowledge]"]

    mem.results.forEach((result, index) => {
      parts.push(
        `\n--- Result ${index + 1} (relevance: ${result.relevance.toFixed(2)}, source: ${result.source}) ---`,
      )
      parts.push(result.content)
    })

    return parts.join("\n")
  }

  private deduplicate(text: string): string {
    const lines = text.split("\n")
    const seen = new Set<string>()
    const result: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        result.push(line)
        continue
      }

      if (trimmed.startsWith("[") || trimmed.startsWith("--- Result")) {
        result.push(line)
        continue
      }

      if (seen.has(trimmed)) continue
      seen.add(trimmed)
      result.push(line)
    }

    return result.join("\n")
  }
}

export function createContextMixer(config?: Partial<ContextMixerConfig>): ContextMixer {
  return new ContextMixer(config)
}

export function saveContextMixSnapshot(cwd: string, snapshot: ContextMixSnapshot): string {
  const dir = path.join(cwd, ".meta", "context")
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const filePath = path.join(dir, `${snapshot.taskId}.yaml`)
  fs.writeFileSync(filePath, yaml.dump(snapshot, { lineWidth: 120 }))
  return filePath
}

export function loadContextMixSnapshots(cwd: string, limit?: number): ContextMixSnapshot[] {
  const dir = path.join(cwd, ".meta", "context")
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .reverse()
    .slice(0, limit ?? Number.MAX_SAFE_INTEGER)
    .map((file) => {
      try {
        return yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) as ContextMixSnapshot
      } catch {
        return null
      }
    })
    .filter((item): item is ContextMixSnapshot => item !== null)
}

export function loadLatestContextMixSnapshot(cwd: string): ContextMixSnapshot | null {
  return loadContextMixSnapshots(cwd, 1)[0] ?? null
}

function resolveLayerLimit(layer: ContextLayerConfig, totalBudget: number): number {
  return Math.max(1, Math.min(layer.maxTokens, Math.floor(totalBudget * layer.maxPercent)))
}

function getCombinedTokens(states: Record<ContextLayerName, InternalLayerState>) {
  return (Object.values(states) as InternalLayerState[]).reduce((sum, state) => sum + state.tokens, 0)
}

function joinLayerStates(states: Record<ContextLayerName, InternalLayerState>) {
  return [states.system.text, states.midTerm.text, states.shortTerm.text, states.longTerm.text]
    .filter(Boolean)
    .join("\n\n")
}

function normalizeQueryKeywords(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9_\-.\/]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 3)
        .slice(0, 8),
    ),
  )
}

function scoreContent(content: string, keywords: string[]): number {
  const lower = content.toLowerCase()
  let total = 0

  for (const keyword of keywords) {
    const matches = lower.split(keyword).length - 1
    total += matches
  }

  if (total === 0) return 0
  return Math.min(1, total / Math.max(1, keywords.length * 2))
}

function extractRelevantSnippet(content: string, keywords: string[], maxLength: number): string {
  const lower = content.toLowerCase()
  const firstMatchIndex = keywords
    .map((keyword) => lower.indexOf(keyword))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]

  if (firstMatchIndex === undefined) {
    return content.slice(0, maxLength)
  }

  const start = Math.max(0, firstMatchIndex - Math.floor(maxLength / 3))
  const end = Math.min(content.length, start + maxLength)
  return content.slice(start, end)
}

function collectSearchFiles(dir: string): string[] {
  const results: string[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectSearchFiles(fullPath))
      continue
    }

    if (/\.(ya?ml|md)$/i.test(entry.name)) {
      results.push(fullPath)
    }
  }

  return results
}
