/**
 * Loop Orchestrator
 *
 * 管理 Plan 和 Build 智能体的自动切换
 * 实现核心循环：Plan → Human → Build → Eval → Loop
 *
 * 整合说明：
 * - 使用 execution/planner.ts 生成计划
 * - 使用 execution/runner.ts 执行任务
 * - 使用 agents/dispatcher.ts 统一调度 sub-agent
 * - 保留循环状态管理和回调通知
 *
 * Handoff 支持：
 * - Agent 可返回 HandoffResult 将控制权转移给另一个 Agent
 * - 支持 context_variables 在 Agent 间传递
 * - HandoffTrace 记录完整的转移链路
 * - max_handoff_depth 防止无限递归
 */

import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { MetaDesign, Session } from "./types.js"
import { loadMetaDesign } from "./design.js"
import { parseCardsFromText, writeCard, updateLoopHistory } from "./cards.js"
import { generateLoopId } from "./utils/id-generator.js"
import { loadLoopRecords, applyLoopDecisions, updateLoopEvaluation, updateLoopCloseSummary } from "./loop.js"
import { planAcceptedCardsForLoop, loadExecutionPlans } from "./execute.js"
import { planCard } from "./execution/planner.js"
import { runPlan } from "./execution/runner.js"
import { runEvaluation } from "./evaluator.js"
import { runOptimization, applyOptimizations } from "./optimizer.js"
import type { ExecutionPlan, PlanResult } from "./execution/types.js"
import { extractText } from "./utils/extract-text.js"
import { getRole } from "./agents/registry.js"
import { isHandoffResult, HandoffTrace } from "./agents/handoff.js"
import type { HandoffResult, AgentToolResult } from "./agents/handoff.js"
import { createHandoffExecutor } from "./utils/handoff.js"
import type { HandoffExecutionResult } from "./utils/handoff.js"
import { createLogger } from "./utils/logger.js"
import { PerformanceMonitor, getGlobalMonitor } from "./utils/performance.js"
import { createTraceContext, createChildTraceContext, propagateTraceContext } from "./utils/trace-context.js"
import type { TraceContext } from "./utils/trace-context.js"
import { ProvenanceTracker, getGlobalTracker } from "./utils/provenance.js"
import { AuditReportGenerator, type AuditReportConfig } from "./utils/audit-report.js"

export interface LoopOrchestratorOptions {
  cwd: string
  session: Session
  performanceMonitor?: PerformanceMonitor
  onPhaseChange?: (phase: LoopPhase) => void
  onCardsReady?: (cards: DecisionCard[]) => void
  onExecutionStart?: (cardId: string) => void
  onExecutionComplete?: (cardId: string, success: boolean) => void
  onEvaluationComplete?: (result: EvaluationResult) => void
  onHandoff?: (from: string, to: string, reason: string) => void
  max_handoff_depth?: number
  onLoopStart?: (loopId: string) => void
  onLoopComplete?: (loopId: string, result: LoopResult) => void
  onStageChange?: (loopId: string, stage: LoopPhase, previousStage: LoopPhase) => void
  onCustomEvent?: (eventName: string, data: unknown) => void
  onAuditReportGenerated?: (reportPath: string) => void
  auditReportConfig?: Partial<AuditReportConfig>
}

export type LoopPhase = "idle" | "analyzing" | "generating" | "deciding" | "executing" | "evaluating" | "optimizing" | "complete" | "handing_off" | "paused"

export interface LoopResult {
  success: boolean
  loopId: string
  cardsAccepted: number
  cardsRejected: number
  evaluationDelta?: number
  error?: string
}

export interface LoopPauseState {
  loopId: string
  phase: LoopPhase
  previousPhase: LoopPhase
  design: MetaDesign
  currentCards: DecisionCard[]
  decisions: Map<string, LoopDecision>
  handoffTrace: HandoffTrace
  pausedAt: string
  reason?: string
}

export interface ConditionalBranch {
  condition: (result: EvaluationResult) => boolean
  truePath: () => Promise<void>
  falsePath: () => Promise<void>
}

export interface UserDecisionBranch {
  decisionPoint: string
  options: Array<{
    id: string
    label: string
    action: () => Promise<void>
  }>
}

export interface DecisionCard {
  id: string
  objective: string
  approach: string
  benefit: string
  cost: string
  risk: string
  confidence: number
  req_refs: string[]
}

export interface LoopDecision {
  cardId: string
  status: "accepted" | "rejected"
  note?: string
}

export interface EvaluationResult {
  score_before: number
  score_after: number
  delta: number
  forced_rollback: boolean
  rollback_reason?: string
}

export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  call_count: number
}

export class LoopOrchestrator {
  private cwd: string
  private session: Session
  private logger = createLogger("orchestrator")
  private perfMonitor: PerformanceMonitor
  private phase: LoopPhase = "idle"
  private design: MetaDesign | null = null
  private currentLoopId: string | null = null
  private currentCards: DecisionCard[] = []
  private decisions: Map<string, LoopDecision> = new Map()
  private handoffTrace: HandoffTrace = new HandoffTrace()
  private handoffExecutor: ReturnType<typeof createHandoffExecutor>
  private pauseState: LoopPauseState | null = null
  private conditionalBranches: Map<string, ConditionalBranch> = new Map()
  private userDecisionBranches: Map<string, UserDecisionBranch> = new Map()
  private tokenUsage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, call_count: 0 }
  private traceContext: TraceContext | null = null
  private provenanceTracker: ProvenanceTracker | null = null

  private onPhaseChange?: (phase: LoopPhase) => void
  private onCardsReady?: (cards: DecisionCard[]) => void
  private onExecutionStart?: (cardId: string) => void
  private onExecutionComplete?: (cardId: string, success: boolean) => void
  private onEvaluationComplete?: (result: EvaluationResult) => void
  private onHandoff?: (from: string, to: string, reason: string) => void
  private onLoopStart?: (loopId: string) => void
  private onLoopComplete?: (loopId: string, result: LoopResult) => void
  private onStageChange?: (loopId: string, stage: LoopPhase, previousStage: LoopPhase) => void
  private onCustomEvent?: (eventName: string, data: unknown) => void
  private onAuditReportGenerated?: (reportPath: string) => void
  private auditReportConfig?: Partial<AuditReportConfig>

  constructor(options: LoopOrchestratorOptions) {
    this.cwd = options.cwd
    this.session = options.session
    this.perfMonitor = options.performanceMonitor ?? getGlobalMonitor()
    this.onPhaseChange = options.onPhaseChange
    this.onCardsReady = options.onCardsReady
    this.onExecutionStart = options.onExecutionStart
    this.onExecutionComplete = options.onExecutionComplete
    this.onEvaluationComplete = options.onEvaluationComplete
    this.onHandoff = options.onHandoff
    this.onLoopStart = options.onLoopStart
    this.onLoopComplete = options.onLoopComplete
    this.onStageChange = options.onStageChange
    this.onCustomEvent = options.onCustomEvent
    this.onAuditReportGenerated = options.onAuditReportGenerated
    this.auditReportConfig = options.auditReportConfig

    // 创建统一的 handoff 执行器
    this.handoffExecutor = createHandoffExecutor({
      cwd: this.cwd,
      session: this.session,
      maxHandoffDepth: options.max_handoff_depth ?? 5,
      onHandoff: this.onHandoff,
    })
  }

  /**
   * 启动完整的 Loop 循环
   */
  async startLoop(): Promise<void> {
    this.traceContext = createTraceContext()
    return this.perfMonitor.measure(
      "orchestrator.startLoop",
      async () => {
        // 1. 加载 MetaDesign
        this.design = await this.perfMonitor.measure(
          "orchestrator.loadMetaDesign",
          async () => loadMetaDesign(this.cwd),
          { phase: "init" }
        )
        if (!this.design) {
          throw new Error("MetaDesign not found. Initialize first.")
        }

        // 2. 生成 Loop ID
        this.currentLoopId = generateLoopId()

        // 触发 onLoopStart 事件
        this.onLoopStart?.(this.currentLoopId)

        // 3. Analyze 阶段 - 分析代码库
        this.setPhase("analyzing")

        // 4. Generate 阶段 - 生成决策卡片
        this.setPhase("generating")
        this.currentCards = await this.perfMonitor.measure(
          "orchestrator.generatePhase",
          async () => this.runGeneratePhase(),
          { loopId: this.currentLoopId, phase: "generating" }
        )

        // 5. 等待人类决策
        this.setPhase("deciding")
        this.onCardsReady?.(this.currentCards)

        // 注意：这里会暂停，等待外部调用 submitDecisions()
      },
      { action: "startLoop" }
    )
  }

  /**
   * 提交人类决策并继续执行
   */
  async submitDecisions(decisions: LoopDecision[]): Promise<void> {
    return this.perfMonitor.measure(
      "orchestrator.submitDecisions",
      async () => {
        if (!this.currentLoopId) {
          throw new Error("No active loop. Call startLoop() first.")
        }

        // 保存决策
        for (const decision of decisions) {
          this.decisions.set(decision.cardId, decision)
        }

        // 应用决策到文件系统
        const decisionsMap: Record<string, "accepted" | "rejected"> = {}
        const notesMap: Record<string, string> = {}
        for (const decision of decisions) {
          decisionsMap[decision.cardId] = decision.status
          if (decision.note) {
            notesMap[decision.cardId] = decision.note
          }
        }
        await this.perfMonitor.measure(
          "orchestrator.applyDecisions",
          async () => applyLoopDecisions(this.cwd, this.currentLoopId!, decisionsMap, notesMap),
          { loopId: this.currentLoopId, decisionCount: decisions.length }
        )

        // 6. Execute 阶段 - 执行被接受的卡片
        this.setPhase("executing")
        const acceptedDecisions = decisions.filter(d => d.status === "accepted")
        if (acceptedDecisions.length > 0) {
          await this.perfMonitor.measure(
            "orchestrator.executePhase",
            async () => this.runExecutePhase(acceptedDecisions.map(d => d.cardId)),
            { loopId: this.currentLoopId, acceptedCount: acceptedDecisions.length }
          )
        }

        // 7. Evaluate 阶段 - 评估执行结果
        this.setPhase("evaluating")
        const evalResult = await this.perfMonitor.measure(
          "orchestrator.evalPhase",
          async () => this.runEvalPhase(),
          { loopId: this.currentLoopId }
        )
        this.onEvaluationComplete?.(evalResult)

        // 7.5. 生成审计报告
        await this.perfMonitor.measure(
          "orchestrator.generateAuditReport",
          async () => this.runAuditReportGeneration(),
          { loopId: this.currentLoopId }
        )

        // 8. Optimize 阶段 - 优化搜索策略
        this.setPhase("optimizing")
        await this.perfMonitor.measure(
          "orchestrator.optimizePhase",
          async () => this.runOptimizePhase(),
          { loopId: this.currentLoopId }
        )

        // 9. 完成
        this.setPhase("complete")

        // 触发 onLoopComplete 事件
        const loopResult: LoopResult = {
          success: true,
          loopId: this.currentLoopId,
          cardsAccepted: acceptedDecisions.length,
          cardsRejected: decisions.length - acceptedDecisions.length,
          evaluationDelta: evalResult.delta,
        }
        this.onLoopComplete?.(this.currentLoopId, loopResult)

        // 清理暂停状态文件
        await this.cleanupPauseState()
      },
      { action: "submitDecisions", decisionCount: decisions.length }
    )
  }

  /**
   * 清理暂停状态文件
   */
  private async cleanupPauseState(): Promise<void> {
    const pauseStatePath = path.join(this.cwd, ".meta", "pause-state.yaml")
    if (fs.existsSync(pauseStatePath)) {
      fs.unlinkSync(pauseStatePath)
    }
  }

  /**
   * 运行 Generate 阶段 - 生成决策卡片
   */
  private async runGeneratePhase(): Promise<DecisionCard[]> {
    const design = this.design!
    const maxCards = design.search_policy?.max_cards_per_loop ?? 3

    // 构建生成提示
    const prompt = this.buildGeneratePrompt(design, maxCards)

    // 调用 LLM 生成卡片
    const response = await this.perfMonitor.measure(
      "orchestrator.llm.generate",
      async () => this.session.prompt({
        system: GENERATE_SYSTEM_PROMPT,
        message: prompt,
      }),
      { type: "llm_call", purpose: "generate_cards", maxCards }
    )

    // 记录 token 使用量
    this.trackTokenUsage(response)

    const text = extractText(response)
    const rawCards = parseCardsFromText(text)

    // 转换为 DecisionCard 格式并保存
    const cards: DecisionCard[] = []
    for (const rawCard of rawCards) {
      const cardId = await writeCard(this.cwd, rawCard, this.currentLoopId!)
      cards.push({
        id: cardId,
        objective: rawCard.objective,
        approach: rawCard.approach,
        benefit: rawCard.benefit,
        cost: rawCard.cost,
        risk: rawCard.risk,
        confidence: rawCard.confidence,
        req_refs: rawCard.req_refs,
      })
    }

    return cards
  }

  /**
   * 运行 Execute 阶段 - 执行被接受的卡片
   */
  private async runExecutePhase(acceptedCardIds: string[]): Promise<void> {
    const executeTraceContext = this.traceContext ? createChildTraceContext(this.traceContext, { phase: "execute" }) : undefined
    // 使用现有的 planAcceptedCardsForLoop 生成执行计划
    const planningResult = await this.perfMonitor.measure(
      "orchestrator.planAcceptedCards",
      async () => planAcceptedCardsForLoop(this.cwd, {
        loopId: this.currentLoopId!,
        session: this.session,
        traceContext: executeTraceContext,
      }),
      { loopId: this.currentLoopId, cardCount: acceptedCardIds.length }
    )

    // 执行每个计划
    for (const plan of planningResult.createdPlans) {
      this.onExecutionStart?.(plan.card_id)

      try {
        const result = await this.perfMonitor.measure(
          "orchestrator.runPlan",
          async () => runPlan(this.cwd, plan.id, this.session, executeTraceContext),
          { planId: plan.id, cardId: plan.card_id }
        )
        this.onExecutionComplete?.(plan.card_id, result.success)

        if (!result.success) {
          this.logger.error(`Plan ${plan.id} failed: ${result.error}`)
        }
      } catch (error) {
        this.logger.error(`Failed to execute plan ${plan.id}:`, error)
        this.onExecutionComplete?.(plan.card_id, false)
      }
    }
  }

  /**
   * 运行 Evaluate 阶段 - 评估执行结果
   */
  private async runEvalPhase(): Promise<EvaluationResult> {
    const evalTraceContext = this.traceContext ? createChildTraceContext(this.traceContext, { phase: "evaluate" }) : undefined
    const design = this.design!
    const evalFactors = design.eval_factors ?? []

    if (evalFactors.length === 0) {
      // 没有评估因子，跳过评估
      return {
        score_before: 0,
        score_after: 0,
        delta: 0,
        forced_rollback: false,
      }
    }

    // 运行评估
    const evalOutput = await this.perfMonitor.measure(
      "orchestrator.runEvaluation",
      async () => runEvaluation(this.cwd, design, this.session, evalTraceContext),
      { loopId: this.currentLoopId, evalFactorCount: evalFactors.length }
    )

    // 更新 loop 评估结果
    await updateLoopEvaluation(this.cwd, this.currentLoopId!, evalOutput)

    return {
      score_before: evalOutput.compositeScoreBefore,
      score_after: evalOutput.compositeScoreAfter,
      delta: evalOutput.compositeDelta,
      forced_rollback: evalOutput.forcedRollback,
      rollback_reason: evalOutput.rollbackReason,
    }
  }

  /**
   * 运行 Optimize 阶段 - 优化搜索策略
   */
  private async runOptimizePhase(): Promise<void> {
    const design = await loadMetaDesign(this.cwd)
    if (!design) return

    // 运行优化分析
    const optimizationResult = await this.perfMonitor.measure(
      "orchestrator.runOptimization",
      async () => runOptimization(this.cwd, design),
      { loopId: this.currentLoopId }
    )

    // 应用优化结果
    await this.perfMonitor.measure(
      "orchestrator.applyOptimizations",
      async () => applyOptimizations(this.cwd, design, optimizationResult),
      { loopId: this.currentLoopId, insightCount: optimizationResult.insights.length }
    )

    // 更新 loop 关闭摘要
    const summary = `Loop completed. ${optimizationResult.insights.length} insights, ${optimizationResult.unlockedNegs.length} negatives unlocked`
    await updateLoopCloseSummary(this.cwd, this.currentLoopId!, summary)
  }

  /**
   * 运行审计报告生成
   */
  private async runAuditReportGeneration(): Promise<void> {
    try {
      // 获取 ProvenanceTracker
      let tracker: ProvenanceTracker
      try {
        tracker = getGlobalTracker()
      } catch {
        // 如果全局 tracker 未初始化，创建一个临时的
        tracker = new ProvenanceTracker({ cwd: this.cwd })
      }

      // 获取当前 loop 的所有证据
      const entries = tracker.getAllEntries()

      // 创建审计报告生成器
      const reportConfig: AuditReportConfig = {
        cwd: this.cwd,
        title: `Loop ${this.currentLoopId} 溯源审计报告`,
        includeEvidenceDetails: true,
        includeTrustChainValidation: true,
        includeStats: true,
        includeTimeline: true,
        ...this.auditReportConfig,
      }

      const generator = new AuditReportGenerator(reportConfig)

      // 生成并保存报告
      const reportPath = await generator.generateAndSave(
        entries,
        this.currentLoopId ?? undefined,
      )

      this.logger.info(`审计报告已生成: ${reportPath}`)

      // 触发回调
      this.onAuditReportGenerated?.(reportPath)

      // 触发自定义事件
      this.emitCustomEvent("audit.report.generated", {
        loopId: this.currentLoopId,
        reportPath,
        entryCount: entries.length,
      })
    } catch (error) {
      // 审计报告生成失败不应影响主流程
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(`审计报告生成失败: ${errMsg}`)
    }
  }

  /**
   * 构建生成提示
   */
  private buildGeneratePrompt(design: MetaDesign, maxCards: number): string {
    const lowCoverageReqs = [...(design.requirements ?? [])]
      .sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0))
      .slice(0, 3)
      .map((r) => `  [${r.id}] coverage ${((r.coverage ?? 0) * 100).toFixed(0)}%: ${r.text}`)
      .join("\n")

    const activeNegs = (design.rejected_directions ?? [])
      .filter((n) => n.status === "active")
      .map((n) => `  [${n.id}] ${n.text}`)
      .join("\n")

    return `[MetaDesign Loop ${this.currentLoopId}]

以下是当前覆盖度最低的需求：
${lowCoverageReqs}

以下方向已被明确拒绝，你的卡片不得命中这些方向：
${activeNegs || "  （暂无）"}

请分析当前代码库，生成恰好 ${maxCards} 张决策卡片。
每张卡片必须严格按以下格式输出，前后的分隔符不能省略：

---CARD START---
objective: （一句话，这张卡要达到什么目标）
approach: （具体的实施手段，技术层面）
benefit: （预期收益，尽量量化）
cost: （代价或副作用）
risk: （最可能出错的地方）
confidence: （0.0-1.0，你对预测收益的置信度）
req_refs: （关联的 REQ id，逗号分隔）
warnings: （接近哪些约束或 NEG，没有写 none）
---CARD END---

在卡片之外不要提出任何代码修改建议。`
  }

  private setPhase(phase: LoopPhase): void {
    const previousPhase = this.phase
    this.phase = phase
    this.onPhaseChange?.(phase)
    
    // 触发 onStageChange 事件
    if (this.currentLoopId && previousPhase !== phase) {
      this.onStageChange?.(this.currentLoopId, phase, previousPhase)
    }
  }



  /**
   * 执行 Handoff — 将控制权从当前 Agent 转移到目标 Agent
   *
   * 支持链式 handoff（目标 Agent 也可以 handoff），通过 depth 限制防止无限递归。
   * 使用统一的 handoff 执行器，确保与 Dispatcher 行为一致。
   */
  async executeHandoff<T = unknown>(
    handoff: HandoffResult,
    currentRoleId: string,
    depth: number = 0,
  ): Promise<HandoffExecutionResult<T>> {
    const previousPhase = this.phase
    this.setPhase("handing_off")

    try {
      const result = await this.handoffExecutor.executeHandoff<T>(
        handoff,
        currentRoleId,
        depth,
        this.handoffTrace,
      )
      return result
    } finally {
      this.setPhase(previousPhase)
    }
  }

  /**
   * 执行 Agent-as-Tool 调用
   *
   * 将另一个 Agent 作为工具调用，获取输出后返回给当前 Agent。
   * 与 handoff 不同，Agent-as-Tool 不转移控制权，而是获取结果。
   */
  async executeAgentTool<T = unknown>(
    targetRoleId: string,
    toolInput: Record<string, unknown>,
    contextVariables: Record<string, unknown> = {},
    triggeredBy: string = "agent_tool",
  ): Promise<AgentToolResult<T>> {
    const targetRole = getRole(targetRoleId)
    if (!targetRole) {
      throw new Error(`Agent tool target role not found: ${targetRoleId}`)
    }

    const { Dispatcher } = await import("./agents/dispatcher.js")
    const dispatcher = new Dispatcher({
      cwd: this.cwd,
      session: this.session,
      enableWatchdog: true,
    })

    const input = {
      ...contextVariables,
      ...toolInput,
    }

    const output = await dispatcher.dispatch<T>(
      targetRoleId,
      input,
      triggeredBy,
    )

    return {
      type: "agent_tool",
      tool_name: `agent:${targetRoleId}`,
      target_role_id: targetRoleId,
      output,
      handoff_id: `at-${Date.now().toString(36)}`,
    }
  }

  /**
   * 获取当前 handoff 链路
   */
  getHandoffTrace(): HandoffTrace {
    return this.handoffTrace
  }

  getPhase(): LoopPhase {
    return this.phase
  }

  /**
   * 获取性能监控器
   */
  getPerformanceMonitor(): PerformanceMonitor {
    return this.perfMonitor
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats(): ReturnType<PerformanceMonitor["getStats"]> {
    return this.perfMonitor.getStats()
  }

  getCurrentCards(): DecisionCard[] {
    return this.currentCards
  }

  getCurrentLoopId(): string | null {
    return this.currentLoopId
  }

  /**
   * 暂停当前正在执行的 loop
   * 保存当前状态到 YAML，支持从暂停点恢复
   */
  async pauseLoop(reason?: string): Promise<void> {
    if (!this.currentLoopId) {
      throw new Error("No active loop to pause.")
    }

    if (this.phase === "paused") {
      throw new Error("Loop is already paused.")
    }

    // 保存当前状态
    this.pauseState = {
      loopId: this.currentLoopId,
      phase: this.phase,
      previousPhase: this.phase,
      design: this.design!,
      currentCards: [...this.currentCards],
      decisions: new Map(this.decisions),
      handoffTrace: this.handoffTrace,
      pausedAt: new Date().toISOString(),
      reason,
    }

    // 保存状态到 YAML 文件
    await this.savePauseStateToYaml()

    // 设置暂停状态
    this.setPhase("paused")

    // 触发自定义事件
    this.emitCustomEvent("loop.paused", { loopId: this.currentLoopId, reason })
  }

  /**
   * 从暂停点恢复执行
   * 加载保存的状态，继续执行剩余任务
   */
  async resumeLoop(): Promise<void> {
    if (!this.pauseState) {
      // 尝试从 YAML 文件加载暂停状态
      await this.loadPauseStateFromYaml()
      if (!this.pauseState) {
        throw new Error("No paused loop to resume.")
      }
    }

    // 恢复状态
    this.currentLoopId = this.pauseState.loopId
    this.design = this.pauseState.design
    this.currentCards = this.pauseState.currentCards
    this.decisions = new Map(this.pauseState.decisions)
    this.handoffTrace = this.pauseState.handoffTrace

    // 从暂停点继续执行
    const resumePhase = this.pauseState.phase

    // 清除暂停状态
    this.pauseState = null

    // 触发自定义事件
    this.emitCustomEvent("loop.resumed", { loopId: this.currentLoopId, resumePhase })

    // 根据暂停时的阶段继续执行
    await this.resumeFromPhase(resumePhase)
  }

  /**
   * 从指定阶段恢复执行
   */
  private async resumeFromPhase(phase: LoopPhase): Promise<void> {
    switch (phase) {
      case "analyzing":
        // 从分析阶段恢复
        this.setPhase("analyzing")
        // 这里可以添加分析阶段的具体逻辑
        break

      case "generating":
        // 从生成阶段恢复
        this.setPhase("generating")
        this.currentCards = await this.runGeneratePhase()
        this.setPhase("deciding")
        this.onCardsReady?.(this.currentCards)
        break

      case "deciding":
        // 从决策阶段恢复
        this.setPhase("deciding")
        this.onCardsReady?.(this.currentCards)
        break

      case "executing":
        // 从执行阶段恢复
        this.setPhase("executing")
        const acceptedDecisions = Array.from(this.decisions.values()).filter(d => d.status === "accepted")
        if (acceptedDecisions.length > 0) {
          await this.runExecutePhase(acceptedDecisions.map(d => d.cardId))
        }
        // 继续执行评估阶段
        this.setPhase("evaluating")
        const evalResult = await this.runEvalPhase()
        this.onEvaluationComplete?.(evalResult)
        // 继续执行优化阶段
        this.setPhase("optimizing")
        await this.runOptimizePhase()
        // 完成
        this.setPhase("complete")
        break

      case "evaluating":
        // 从评估阶段恢复
        this.setPhase("evaluating")
        const evalResult2 = await this.runEvalPhase()
        this.onEvaluationComplete?.(evalResult2)
        // 继续执行优化阶段
        this.setPhase("optimizing")
        await this.runOptimizePhase()
        // 完成
        this.setPhase("complete")
        break

      case "optimizing":
        // 从优化阶段恢复
        this.setPhase("optimizing")
        await this.runOptimizePhase()
        // 完成
        this.setPhase("complete")
        break

      default:
        throw new Error(`Cannot resume from phase: ${phase}`)
    }
  }

  /**
   * 保存暂停状态到 YAML 文件
   */
  private async savePauseStateToYaml(): Promise<void> {
    if (!this.pauseState) return

    const pauseStatePath = path.join(this.cwd, ".meta", "pause-state.yaml")
    const pauseStateData = {
      loopId: this.pauseState.loopId,
      phase: this.pauseState.phase,
      previousPhase: this.pauseState.previousPhase,
      pausedAt: this.pauseState.pausedAt,
      reason: this.pauseState.reason,
      currentCards: this.pauseState.currentCards,
      decisions: Array.from(this.pauseState.decisions.entries()),
    }

    fs.writeFileSync(pauseStatePath, yaml.dump(pauseStateData, { lineWidth: 100 }))
  }

  /**
   * 从 YAML 文件加载暂停状态
   */
  private async loadPauseStateFromYaml(): Promise<void> {
    const pauseStatePath = path.join(this.cwd, ".meta", "pause-state.yaml")
    if (!fs.existsSync(pauseStatePath)) {
      return
    }

    try {
      const pauseStateData = yaml.load(fs.readFileSync(pauseStatePath, "utf8")) as any
      if (pauseStateData && pauseStateData.loopId) {
        this.pauseState = {
          loopId: pauseStateData.loopId,
          phase: pauseStateData.phase,
          previousPhase: pauseStateData.previousPhase,
          design: await loadMetaDesign(this.cwd) || {} as MetaDesign,
          currentCards: pauseStateData.currentCards || [],
          decisions: new Map(pauseStateData.decisions || []),
          handoffTrace: new HandoffTrace(),
          pausedAt: pauseStateData.pausedAt,
          reason: pauseStateData.reason,
        }
      }
    } catch (error) {
      this.logger.error("Failed to load pause state:", error)
    }
  }

  /**
   * 注册条件分支
   */
  registerConditionalBranch(branchId: string, branch: ConditionalBranch): void {
    this.conditionalBranches.set(branchId, branch)
  }

  /**
   * 注册用户决策分支
   */
  registerUserDecisionBranch(branchId: string, branch: UserDecisionBranch): void {
    this.userDecisionBranches.set(branchId, branch)
  }

  /**
   * 执行条件分支
   */
  async executeConditionalBranch(branchId: string, result: EvaluationResult): Promise<void> {
    const branch = this.conditionalBranches.get(branchId)
    if (!branch) {
      throw new Error(`Conditional branch not found: ${branchId}`)
    }

    if (branch.condition(result)) {
      await branch.truePath()
    } else {
      await branch.falsePath()
    }

    // 触发自定义事件
    this.emitCustomEvent("conditional.branch.executed", {
      branchId,
      result,
      path: branch.condition(result) ? "true" : "false",
    })
  }

  /**
   * 执行用户决策分支
   */
  async executeUserDecisionBranch(branchId: string, selectedOptionId: string): Promise<void> {
    const branch = this.userDecisionBranches.get(branchId)
    if (!branch) {
      throw new Error(`User decision branch not found: ${branchId}`)
    }

    const option = branch.options.find(o => o.id === selectedOptionId)
    if (!option) {
      throw new Error(`Option not found: ${selectedOptionId}`)
    }

    await option.action()

    // 触发自定义事件
    this.emitCustomEvent("user.decision.executed", {
      branchId,
      selectedOptionId,
      decisionPoint: branch.decisionPoint,
    })
  }

  /**
   * 获取可用的用户决策选项
   */
  getUserDecisionOptions(branchId: string): Array<{ id: string; label: string }> {
    const branch = this.userDecisionBranches.get(branchId)
    if (!branch) {
      throw new Error(`User decision branch not found: ${branchId}`)
    }

    return branch.options.map(o => ({ id: o.id, label: o.label }))
  }

  /**
   * 触发自定义事件
   */
  emitCustomEvent(eventName: string, data: unknown): void {
    this.onCustomEvent?.(eventName, data)
  }

  /**
   * 获取暂停状态
   */
  getPauseState(): LoopPauseState | null {
    return this.pauseState
  }

  /**
   * 获取 token 使用统计
   */
  getTokenUsage(): TokenUsage {
    return { ...this.tokenUsage }
  }

  /**
   * 从 LLM 响应中提取并累计 token 使用量
   */
  private trackTokenUsage(response: unknown): void {
    const usage = this.extractTokenUsage(response)
    if (usage) {
      this.tokenUsage.prompt_tokens += usage.prompt_tokens
      this.tokenUsage.completion_tokens += usage.completion_tokens
      this.tokenUsage.total_tokens += usage.total_tokens
      this.tokenUsage.call_count += 1
    }
  }

  /**
   * 从 LLM 响应中提取 token 使用量
   */
  private extractTokenUsage(response: unknown): { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null {
    if (!response || typeof response !== "object") return null

    const resp = response as Record<string, unknown>

    // OpenAI-compatible: response.usage
    if (resp.usage && typeof resp.usage === "object") {
      const usage = resp.usage as Record<string, unknown>
      const prompt = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0
      const completion = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0
      const total = typeof usage.total_tokens === "number" ? usage.total_tokens : prompt + completion
      return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total }
    }

    // Anthropic-compatible: response.usage.input_tokens / output_tokens
    if (resp.usage && typeof resp.usage === "object") {
      const usage = resp.usage as Record<string, unknown>
      if (typeof usage.input_tokens === "number" || typeof usage.output_tokens === "number") {
        const prompt = typeof usage.input_tokens === "number" ? usage.input_tokens : 0
        const completion = typeof usage.output_tokens === "number" ? usage.output_tokens : 0
        return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
      }
    }

    return null
  }

  /**
   * 检查是否处于暂停状态
   */
  isPaused(): boolean {
    return this.phase === "paused" || this.pauseState !== null
  }

  /**
   * 获取所有注册的条件分支
   */
  getConditionalBranches(): Map<string, ConditionalBranch> {
    return new Map(this.conditionalBranches)
  }

  /**
   * 获取所有注册的用户决策分支
   */
  getUserDecisionBranches(): Map<string, UserDecisionBranch> {
    return new Map(this.userDecisionBranches)
  }
}

const GENERATE_SYSTEM_PROMPT = `You are a Plan Agent for MetaDesign.
Your job is to analyze the codebase and generate decision cards.

You CANNOT modify code. You can only:
- Read and analyze code
- Generate decision cards

Output cards in this format:
---CARD START---
objective: What to achieve
approach: How to achieve it
benefit: Expected positive impact
cost: Expected negative impact
risk: Potential risks
confidence: 0.0-1.0
req_refs: REQ-001, REQ-002
---CARD END---

Generate 2-3 cards focusing on the lowest coverage requirements.`
