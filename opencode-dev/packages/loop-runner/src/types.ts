import type { z } from 'zod'
import type { DesignSchema, LoopSchema, CardSchema, NegativeSchema } from './schema/index.js'

export type Design = z.infer<typeof DesignSchema>
export type Loop = z.infer<typeof LoopSchema>
export type Card = z.infer<typeof CardSchema>
export type Negative = z.infer<typeof NegativeSchema>

export interface LoopRunnerConfig {
  projectRoot: string
  metaDir: string
  llm: {
    provider: 'anthropic' | 'glm' | 'openai'
    apiKey: string
    model?: string
    baseUrl?: string
  }
  git: {
    defaultBranch: string
    branchPrefix: string
  }
  tui: {
    enabled: boolean
    theme?: 'dark' | 'light'
  }
}

export interface LoopRunnerOptions {
  dryRun?: boolean
  fromPhase?: PhaseType
  resume?: boolean
  verbose?: boolean
}

export type PhaseType = 'analyze' | 'generate' | 'decide' | 'execute' | 'evaluate' | 'close'

export interface PhaseContext {
  config: LoopRunnerConfig
  design: Design
  loop: Loop
  options: LoopRunnerOptions
}

export interface PhaseResult {
  success: boolean
  data?: Record<string, any>
  error?: Error
}

export interface AnalyzeResult extends PhaseResult {
  data?: {
    codebaseSnapshot: {
      filesRead: number
      totalLines: number
      gitSha: string
    }
    requirementCoverage: Array<{
      reqId: string
      coverageBefore: number
      coverageAssessed: number
      gapDescription: string
    }>
    constraintProximity: Array<{
      constraintRef: string
      status: 'safe' | 'warning' | 'breach'
      detail: string
    }>
    activeNegativesChecked: string[]
    negativesUnlocked: string[]
  }
}

export interface GenerateResult extends PhaseResult {
  data?: {
    generatedCount: number
    filteredCount: number
    filterLog: Array<{
      candidateSummary: string
      matchedNegative: string
    }>
    presentedCards: string[]
  }
}

export interface DecideResult extends PhaseResult {
  data?: {
    acceptedCards: string[]
    rejectedCards: string[]
    skippedCards: string[]
    newNegativesWritten: string[]
    directionOverride?: string
  }
}

export interface ExecuteResult extends PhaseResult {
  data?: {
    cardsExecuted: Array<{
      cardId: string
      status: 'success' | 'failed' | 'rolled_back'
      filesModified: string[]
      gitShaAfter?: string
      error?: string
    }>
    totalFilesModified: number
    gitShaBefore: string
    gitShaAfter?: string
  }
}

export interface EvaluateResult extends PhaseResult {
  data?: {
    factorResults: Array<{
      factorId: string
      valueBefore: string
      valueAfter: string
      normalizedScore: number
      passedFloor: boolean
      delta: number
    }>
    compositeScoreBefore: number
    compositeScoreAfter: number
    compositeDelta: number
    conflictsDetected: Array<{
      factorA: string
      factorB: string
      description: string
      severity: 'warn' | 'block'
    }>
    forcedRollback: boolean
    rollbackReason?: string
  }
}

export interface CloseResult extends PhaseResult {
  data?: {
    designUpdates: {
      requirementsCoverageUpdated: boolean
      negativesAdded: string[]
      negativesLifted: string[]
      evalBaselinesUpdated: boolean
      loopHistoryAppended: boolean
    }
    summary: string
    nextLoopHints: Array<{
      type: 'coverage_gap' | 'eval_regression' | 'constraint_risk' | 'opportunity'
      message: string
      priority: 'high' | 'medium' | 'low'
    }>
  }
}
