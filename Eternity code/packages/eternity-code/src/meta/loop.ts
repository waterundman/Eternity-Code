import path from "path"
import fs from "fs"
import yaml from "js-yaml"
import type { MetaDesign } from "./types.js"
import type { EvaluationOutput } from "./evaluator.js"
import type { PreflightStatus } from "./execution/types.js"
import { loadMetaDesign } from "./design.js"
import { listMetaEntryPaths, resolveMetaDesignPath, resolveMetaEntryPath } from "./paths.js"
import { PromptFeedbackLoop, type NoiseType } from "./prompt/feedback-loop.js"
import { DEFAULT_CARD_TEMPLATE_ID } from "./cards.js"
import { resolveCard, updateLoopHistory, writeRejectedDirection } from "./cards.js"
import { writeLoopLog, type LoopLog } from "./execution/logs.js"

export interface MetaDecisionCard {
  _schema_version?: string
  _schema_type?: string
  id: string
  loop_id?: string
  req_refs: string[]
  content: {
    objective: string
    approach: string
    benefit: string
    cost: string
    risk: string
    warnings: string[]
  }
  prediction: {
    confidence: number
  }
  source?: {
    template_id?: string
    generator?: string
  }
  decision?: {
    status: "pending" | "accepted" | "rejected"
    chosen_by?: string | null
    resolved_at?: string | null
    note?: string | null
  }
  outcome?: unknown
  created_at?: string
}

export interface MetaLoopRecord {
  _schema_type?: string
  id: string
  sequence?: number
  started_at?: string
  completed_at?: string
  status?: string
  phase?: string
  message_id?: string
  candidates?: {
    presented_cards?: string[]
  }
  decision_session?: {
    accepted_cards?: string[]
    rejected_cards?: string[]
    new_negatives_written?: string[]
    completed_at?: string
  }
  execution?: {
    status?: "planned" | PreflightStatus
    preflight_status?: PreflightStatus
    plan_ids?: string[]
    planned_cards?: string[]
    planned_at?: string
    checked_at?: string
    ready_plans?: number
    warning_plans?: number
    blocked_plans?: number
    warnings?: string[]
    blockers?: string[]
    summary?: string
  }
  evaluation?: {
    composite_score_before?: number
    composite_score_after?: number
    composite_delta?: number
    forced_rollback?: boolean
    rollback_reason?: string
    results?: Array<{
      factor_id: string
      factor_name: string
      value_before: string
      value_after: string
      normalized_score: number
      passed_floor: boolean
      delta: number
    }>
    evaluated_at?: string
  }
  close?: {
    summary?: string
    optimized_at?: string
  }
}

export interface MetaLoopRuntime {
  design: MetaDesign | null
  loops: MetaLoopRecord[]
  latestLoop?: MetaLoopRecord
  latestCards: MetaDecisionCard[]
  pendingLoop?: MetaLoopRecord
  pendingCards: MetaDecisionCard[]
}

export interface ApplyLoopDecisionsResult {
  loopId: string
  acceptedCards: string[]
  rejectedCards: string[]
  newNegatives: string[]
  summary: string
}

export interface ApplyLoopDecisionsOptions {
  chosenBy?: string
  recordFeedback?: boolean
}

export interface UpdateLoopEvaluationResult {
  loopId: string
  summary: string
}

export interface UpdateLoopExecutionResult {
  loopId: string
  summary: string
  planIds: string[]
  plannedCards: string[]
}

export async function loadMetaLoopRuntime(cwd: string): Promise<MetaLoopRuntime> {
  const design = await loadMetaDesign(cwd)
  const loops = loadLoopRecords(cwd)
  const latestLoop = loops[0]
  const latestCards = latestLoop ? loadLoopCards(cwd, latestLoop) : []

  const pendingEntry = loops
    .map((loop) => ({ loop, cards: loadLoopCards(cwd, loop) }))
    .find(({ loop, cards }) => {
      const cardIds = getLoopCardIds(loop)
      if (cardIds.length === 0) return false
      if (!loop.decision_session) return true
      return cards.some((card) => (card.decision?.status ?? "pending") === "pending")
    })

  return {
    design,
    loops,
    latestLoop,
    latestCards,
    pendingLoop: pendingEntry?.loop,
    pendingCards: pendingEntry?.cards ?? [],
  }
}

export function loadLoopRecords(cwd: string): MetaLoopRecord[] {
  return listMetaEntryPaths(cwd, "loops", ".yaml")
    .map((filePath) => readYamlFile<MetaLoopRecord>(filePath))
    .filter((loop): loop is MetaLoopRecord => Boolean(loop?.id))
    .sort((a, b) => {
      const seqA = a.sequence ?? 0
      const seqB = b.sequence ?? 0
      if (seqA !== seqB) return seqB - seqA
      return b.id.localeCompare(a.id)
    })
}

export function loadLoopCards(cwd: string, loop: MetaLoopRecord): MetaDecisionCard[] {
  return getLoopCardIds(loop)
    .map((cardId) => readYamlFile<MetaDecisionCard>(resolveMetaEntryPath(cwd, "cards", `${cardId}.yaml`)))
    .filter((card): card is MetaDecisionCard => Boolean(card?.id))
}

export function findLatestAcceptedLoop(cwd: string): MetaLoopRecord | undefined {
  return loadLoopRecords(cwd).find((loop) => (loop.decision_session?.accepted_cards?.length ?? 0) > 0)
}

export async function updateLoopExecutionPlan(
  cwd: string,
  loopId: string,
  input: {
    planIds: string[]
    plannedCards: string[]
    summary: string
    preflight?: {
      status: PreflightStatus
      readyPlans: number
      warningPlans: number
      blockedPlans: number
      warnings: string[]
      blockers: string[]
    }
  },
): Promise<UpdateLoopExecutionResult> {
  const loopPath = resolveMetaEntryPath(cwd, "loops", `${loopId}.yaml`)
  const loop = readYamlFile<MetaLoopRecord>(loopPath)
  if (!loop?.id) throw new Error(`Loop not found: ${loopId}`)

  const nextLoop: MetaLoopRecord = {
    ...loop,
    phase: "execute",
    execution: {
      ...(loop.execution ?? {}),
      status: input.planIds.length > 0 ? (input.preflight?.status ?? "planned") : undefined,
      preflight_status: input.preflight?.status,
      plan_ids: input.planIds,
      planned_cards: input.plannedCards,
      planned_at: new Date().toISOString(),
      checked_at: input.preflight ? new Date().toISOString() : loop.execution?.checked_at,
      ready_plans: input.preflight?.readyPlans,
      warning_plans: input.preflight?.warningPlans,
      blocked_plans: input.preflight?.blockedPlans,
      warnings: input.preflight?.warnings,
      blockers: input.preflight?.blockers,
      summary: input.summary,
    },
  }
  writeYamlFile(loopPath, nextLoop)

  await updateDesignLoopSummary(cwd, loopId, {
    status: nextLoop.status ?? "completed",
    summary: input.summary,
  })

  return {
    loopId,
    summary: input.summary,
    planIds: input.planIds,
    plannedCards: input.plannedCards,
  }
}

export async function updateLoopRollback(
  cwd: string,
  loopId: string,
  planId: string,
  reason: string,
  error?: string,
): Promise<void> {
  const loopPath = resolveMetaEntryPath(cwd, "loops", `${loopId}.yaml`)
  const loop = readYamlFile<MetaLoopRecord>(loopPath)
  if (!loop?.id) throw new Error(`Loop not found: ${loopId}`)

  const now = new Date().toISOString()
  const summary = `Plan ${planId} rolled back: ${reason}${error ? ` (Error: ${error})` : ""}`

  const nextLoop: MetaLoopRecord = {
    ...loop,
    status: "rolled_back",
    phase: "complete",
    completed_at: now,
    execution: {
      ...(loop.execution ?? {}),
      status: "blocked",
      summary,
    },
    evaluation: {
      ...(loop.evaluation ?? {}),
      forced_rollback: true,
      rollback_reason: reason,
    },
  }
  writeYamlFile(loopPath, nextLoop)

  await updateDesignLoopSummary(cwd, loopId, {
    status: "rolled_back",
    summary,
  })
}

export async function applyLoopDecisions(
  cwd: string,
  loopId: string,
  decisions: Record<string, "accepted" | "rejected">,
  notes: Record<string, string> = {},
  options: ApplyLoopDecisionsOptions = {},
): Promise<ApplyLoopDecisionsResult> {
  const loopPath = resolveMetaEntryPath(cwd, "loops", `${loopId}.yaml`)
  const loop = readYamlFile<MetaLoopRecord>(loopPath)
  if (!loop?.id) throw new Error(`Loop not found: ${loopId}`)

  const cards = loadLoopCards(cwd, loop)
  if (cards.length === 0) throw new Error(`No cards found for ${loopId}`)

  const unresolved = cards.filter((card) => !decisions[card.id] && (card.decision?.status ?? "pending") === "pending")
  if (unresolved.length > 0) {
    throw new Error(`Decisions missing for: ${unresolved.map((card) => card.id).join(", ")}`)
  }

  const now = new Date().toISOString()
  const chosenBy = options.chosenBy ?? "human"
  const acceptedCards: string[] = []
  const rejectedCards: string[] = []
  const newNegatives: string[] = []
  const processedCards: Array<{ card: MetaDecisionCard; status: "accepted" | "rejected"; note?: string }> = []

  for (const card of cards) {
    const existingStatus = card.decision?.status
    if (!decisions[card.id] && (!existingStatus || existingStatus === "pending")) continue

    const status = decisions[card.id] ?? existingStatus
    if (!status) continue

    if (status === "accepted") {
      await resolveCard(cwd, card.id, {
        status: "accepted",
        chosen_by: chosenBy,
        resolved_at: now,
      })
      acceptedCards.push(card.id)
      processedCards.push({ card, status: "accepted" })
      continue
    }

    const note = notes[card.id]?.trim()
    await resolveCard(cwd, card.id, {
      status: "rejected",
      note,
      chosen_by: chosenBy,
      resolved_at: now,
    })
    rejectedCards.push(card.id)
    processedCards.push({ card, status: "rejected", note })

    if (!hasNegativeForCard(cwd, card.id)) {
      const negativeId = await writeRejectedDirection(
        cwd,
        card.id,
        card.content.objective,
        card.content.risk,
        note ?? "",
      )
      newNegatives.push(negativeId)
    }
  }

  const updatedLoop: MetaLoopRecord = {
    ...loop,
    status: "completed",
    phase: acceptedCards.length > 0 ? "execute" : "complete",
    completed_at: now,
    decision_session: {
      accepted_cards: acceptedCards,
      rejected_cards: rejectedCards,
      new_negatives_written: newNegatives,
      completed_at: now,
    },
  }
  fs.writeFileSync(loopPath, yaml.dump(updatedLoop, { lineWidth: 100 }))

  const summary = `Cards accepted: ${acceptedCards.length}, rejected: ${rejectedCards.length}`
  await updateLoopHistory(cwd, loopId, "completed", cards.length, acceptedCards.length, rejectedCards.length, summary)

  if (options.recordFeedback !== false && processedCards.length > 0) {
    recordDecisionFeedback(cwd, loopId, processedCards)
  }

  return {
    loopId,
    acceptedCards,
    rejectedCards,
    newNegatives,
    summary,
  }
}

function recordDecisionFeedback(
  cwd: string,
  loopId: string,
  decisions: Array<{ card: MetaDecisionCard; status: "accepted" | "rejected"; note?: string }>,
) {
  const feedbackLoop = new PromptFeedbackLoop(cwd)
  const timestamp = new Date().toISOString()

  for (const entry of decisions) {
    feedbackLoop.recordSignal({
      template_id: entry.card.source?.template_id ?? DEFAULT_CARD_TEMPLATE_ID,
      timestamp,
      card_id: entry.card.id,
      loop_id: loopId,
      user_rating: null,
      acceptance: entry.status === "accepted",
      // Before execution is available, accepted cards are treated as passing the decision gate.
      execution_success: entry.status === "accepted",
      noise_type: inferDecisionNoiseType(entry.status, entry.note),
    })
  }
}

function inferDecisionNoiseType(status: "accepted" | "rejected", note?: string): NoiseType {
  if (status === "accepted") return "none"

  const text = note?.toLowerCase() ?? ""
  if (!text) return "prompt_quality"

  if (/(constraint|scope|latency|budget|interface|dependency|risk|rollback|branch|preflight)/.test(text)) {
    return "structure"
  }

  if (/(priority|goal|user|not needed|wrong problem|business|coverage|value)/.test(text)) {
    return "content"
  }

  return "prompt_quality"
}

export async function updateLoopEvaluation(
  cwd: string,
  loopId: string,
  evaluation: EvaluationOutput,
): Promise<UpdateLoopEvaluationResult> {
  const loopPath = resolveMetaEntryPath(cwd, "loops", `${loopId}.yaml`)
  const loop = readYamlFile<MetaLoopRecord>(loopPath)
  if (!loop?.id) throw new Error(`Loop not found: ${loopId}`)

  const evaluatedAt = new Date().toISOString()
  const summary = evaluation.forcedRollback
    ? `Evaluation delta ${formatDelta(evaluation.compositeDelta)}; rollback required`
    : `Evaluation delta ${formatDelta(evaluation.compositeDelta)}; baselines updated`

  const nextLoop: MetaLoopRecord = {
    ...loop,
    status: evaluation.forcedRollback ? "rolled_back" : loop.status ?? "completed",
    phase: evaluation.forcedRollback ? "complete" : "optimize",
    evaluation: {
      composite_score_before: evaluation.compositeScoreBefore,
      composite_score_after: evaluation.compositeScoreAfter,
      composite_delta: evaluation.compositeDelta,
      forced_rollback: evaluation.forcedRollback,
      rollback_reason: evaluation.rollbackReason,
      results: evaluation.results.map((result) => ({
        factor_id: result.factorId,
        factor_name: result.factorName,
        value_before: result.valueBefore,
        value_after: result.valueAfter,
        normalized_score: result.normalizedScore,
        passed_floor: result.passedFloor,
        delta: result.delta,
      })),
      evaluated_at: evaluatedAt,
    },
  }
  writeYamlFile(loopPath, nextLoop)

  await updateDesignLoopSummary(cwd, loopId, {
    status: nextLoop.status ?? "completed",
    summary,
    compositeScoreDelta: evaluation.compositeDelta,
  })

  return { loopId, summary }
}

export async function updateLoopCloseSummary(cwd: string, loopId: string, summary: string): Promise<void> {
  const loopPath = resolveMetaEntryPath(cwd, "loops", `${loopId}.yaml`)
  const loop = readYamlFile<MetaLoopRecord>(loopPath)
  if (!loop?.id) throw new Error(`Loop not found: ${loopId}`)

  const nextLoop: MetaLoopRecord = {
    ...loop,
    phase: "complete",
    close: {
      ...(loop.close ?? {}),
      summary,
      optimized_at: new Date().toISOString(),
    },
  }
  writeYamlFile(loopPath, nextLoop)

  await updateDesignLoopSummary(cwd, loopId, {
    status: nextLoop.status ?? "completed",
    summary,
  })

  // 自动写入 LOG
  try {
    const design = await loadMetaDesign(cwd)
    const loopLog: LoopLog = {
      loop_id: loopId,
      date: new Date().toISOString().slice(0, 10),
      model: "opencode/mimo-v2-pro-free",
      blueprint_version: design?.loop_history?.last_loop_id ? `loop-${design.loop_history.last_loop_id}` : undefined,
      completed: [
        `Loop ${loopId} 完成`,
        summary,
      ],
      problems: [],
      incomplete: [],
      tech_debt: [],
      next_loop_suggestions: [],
    }
    writeLoopLog(cwd, loopLog)
  } catch (error) {
    console.warn("[MetaDesign] Failed to write loop log:", error)
  }

  // 自动分析并写入 insight
  try {
    const acceptedCount = loop.decision_session?.accepted_cards?.length ?? 0
    const rejectedCount = loop.decision_session?.rejected_cards?.length ?? 0
    const totalCards = acceptedCount + rejectedCount
    
    if (totalCards > 0) {
      const acceptanceRate = acceptedCount / totalCards
      
      // 如果接受率异常高或低，生成 insight
      if (acceptanceRate > 0.9 || acceptanceRate < 0.3) {
        const { handleInsightOutput } = await import("./insight-handler.js")
        const insightText = acceptanceRate > 0.9
          ? `---INSIGHT START---
title: High acceptance rate in ${loopId}
source: loop_analysis
category: process
insight: |
  Loop ${loopId} had an unusually high acceptance rate (${(acceptanceRate * 100).toFixed(0)}%).
  This may indicate that the plan agent is generating too conservative cards,
  or that the quality bar needs to be raised.
implications:
  - Consider adjusting the search policy to be more exploratory
  - Review the card generation prompt for conservatism bias
related:
  - ${loopId}
---INSIGHT END---`
          : `---INSIGHT START---
title: Low acceptance rate in ${loopId}
source: loop_analysis
category: process
insight: |
  Loop ${loopId} had an unusually low acceptance rate (${(acceptanceRate * 100).toFixed(0)}%).
  This may indicate that the plan agent is generating cards that don't align with priorities,
  or that there are unaddressed constraints.
implications:
  - Review the rejected cards for patterns
  - Consider updating the design.yaml with clearer constraints
related:
  - ${loopId}
---INSIGHT END---`
        
        const result = handleInsightOutput(cwd, insightText)
        if (result.success) {
          console.log(`[MetaDesign] Auto-generated insight: ${result.insightId}`)
        }
      }
    }
  } catch (error) {
    console.warn("[MetaDesign] Failed to auto-generate insight:", error)
  }
}

function getLoopCardIds(loop: MetaLoopRecord) {
  const ids = [
    ...(loop.candidates?.presented_cards ?? []),
    ...(loop.decision_session?.accepted_cards ?? []),
    ...(loop.decision_session?.rejected_cards ?? []),
  ]
  return [...new Set(ids.filter(Boolean))]
}

function hasNegativeForCard(cwd: string, cardId: string) {
  const designPath = resolveMetaDesignPath(cwd)
  if (!fs.existsSync(designPath)) return false

  try {
    const design = readYamlFile<MetaDesign>(designPath)
    return (design?.rejected_directions ?? []).some((item) => item.source_card === cardId)
  } catch {
    return false
  }
}

async function updateDesignLoopSummary(
  cwd: string,
  loopId: string,
  input: {
    status: string
    summary: string
    compositeScoreDelta?: number
  },
) {
  const designPath = resolveMetaDesignPath(cwd)
  const design = readYamlFile<MetaDesign>(designPath)
  if (!design) return

  const loops = [...(design.loop_history?.loops ?? [])]
  const index = loops.findIndex((loop) => loop.loop_id === loopId)
  if (index === -1) return

  const current = loops[index]
  loops[index] = {
    ...current,
    status: input.status,
    summary: input.summary,
    ...(input.compositeScoreDelta !== undefined ? { composite_score_delta: input.compositeScoreDelta } : {}),
  }

  const nextDesign: MetaDesign = {
    ...design,
    loop_history: {
      total_loops: design.loop_history?.total_loops ?? loops.length,
      last_loop_id: design.loop_history?.last_loop_id,
      last_loop_at: design.loop_history?.last_loop_at,
      loops,
    },
    updated_at: new Date().toISOString(),
  }
  fs.writeFileSync(designPath, yaml.dump(nextDesign, { lineWidth: 120 }))
}

function formatDelta(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`
}

function readYamlFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null
  return yaml.load(fs.readFileSync(filePath, "utf8")) as T
}

function writeYamlFile<T>(filePath: string, data: T, lineWidth: number = 100): void {
  fs.writeFileSync(filePath, yaml.dump(data, { lineWidth }))
}
