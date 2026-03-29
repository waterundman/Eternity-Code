import type { ExecutionPlan } from "./execution/types.js"
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

export type MetaRuntimePhase = "idle" | "analyzing" | "deciding" | "executing" | "evaluating" | "complete"

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
