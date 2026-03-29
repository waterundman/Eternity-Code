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
 */

import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { MetaDesign, Session } from "./types.js"
import { loadMetaDesign } from "./design.js"
import { parseCardsFromText, writeCard, updateLoopHistory } from "./cards.js"
import { loadLoopRecords, applyLoopDecisions, updateLoopEvaluation, updateLoopCloseSummary } from "./loop.js"
import { planAcceptedCardsForLoop, loadExecutionPlans } from "./execute.js"
import { planCard } from "./execution/planner.js"
import { runPlan } from "./execution/runner.js"
import { runEvaluation } from "./evaluator.js"
import { runOptimization, applyOptimizations } from "./optimizer.js"
import type { ExecutionPlan, PlanResult } from "./execution/types.js"

export interface LoopOrchestratorOptions {
  cwd: string
  session: Session
  onPhaseChange?: (phase: LoopPhase) => void
  onCardsReady?: (cards: DecisionCard[]) => void
  onExecutionStart?: (cardId: string) => void
  onExecutionComplete?: (cardId: string, success: boolean) => void
  onEvaluationComplete?: (result: EvaluationResult) => void
}

export type LoopPhase = "idle" | "analyzing" | "generating" | "deciding" | "executing" | "evaluating" | "optimizing" | "complete"

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

export class LoopOrchestrator {
  private cwd: string
  private session: Session
  private phase: LoopPhase = "idle"
  private design: MetaDesign | null = null
  private currentLoopId: string | null = null
  private currentCards: DecisionCard[] = []
  private decisions: Map<string, LoopDecision> = new Map()

  private onPhaseChange?: (phase: LoopPhase) => void
  private onCardsReady?: (cards: DecisionCard[]) => void
  private onExecutionStart?: (cardId: string) => void
  private onExecutionComplete?: (cardId: string, success: boolean) => void
  private onEvaluationComplete?: (result: EvaluationResult) => void

  constructor(options: LoopOrchestratorOptions) {
    this.cwd = options.cwd
    this.session = options.session
    this.onPhaseChange = options.onPhaseChange
    this.onCardsReady = options.onCardsReady
    this.onExecutionStart = options.onExecutionStart
    this.onExecutionComplete = options.onExecutionComplete
    this.onEvaluationComplete = options.onEvaluationComplete
  }

  /**
   * 启动完整的 Loop 循环
   */
  async startLoop(): Promise<void> {
    // 1. 加载 MetaDesign
    this.design = await loadMetaDesign(this.cwd)
    if (!this.design) {
      throw new Error("MetaDesign not found. Initialize first.")
    }

    // 2. 生成 Loop ID
    const loopNum = (this.design.loop_history?.total_loops ?? 0) + 1
    this.currentLoopId = `loop-${String(loopNum).padStart(3, "0")}`

    // 3. Analyze 阶段 - 分析代码库
    this.setPhase("analyzing")

    // 4. Generate 阶段 - 生成决策卡片
    this.setPhase("generating")
    this.currentCards = await this.runGeneratePhase()

    // 5. 等待人类决策
    this.setPhase("deciding")
    this.onCardsReady?.(this.currentCards)

    // 注意：这里会暂停，等待外部调用 submitDecisions()
  }

  /**
   * 提交人类决策并继续执行
   */
  async submitDecisions(decisions: LoopDecision[]): Promise<void> {
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
    await applyLoopDecisions(this.cwd, this.currentLoopId, decisionsMap, notesMap)

    // 6. Execute 阶段 - 执行被接受的卡片
    this.setPhase("executing")
    const acceptedDecisions = decisions.filter(d => d.status === "accepted")
    if (acceptedDecisions.length > 0) {
      await this.runExecutePhase(acceptedDecisions.map(d => d.cardId))
    }

    // 7. Evaluate 阶段 - 评估执行结果
    this.setPhase("evaluating")
    const evalResult = await this.runEvalPhase()
    this.onEvaluationComplete?.(evalResult)

    // 8. Optimize 阶段 - 优化搜索策略
    this.setPhase("optimizing")
    await this.runOptimizePhase()

    // 9. 完成
    this.setPhase("complete")
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
    const response = await this.session.prompt({
      system: GENERATE_SYSTEM_PROMPT,
      message: prompt,
    })

    const text = this.extractText(response)
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
    // 使用现有的 planAcceptedCardsForLoop 生成执行计划
    const planningResult = await planAcceptedCardsForLoop(this.cwd, {
      loopId: this.currentLoopId!,
      session: this.session,
    })

    // 执行每个计划
    for (const plan of planningResult.createdPlans) {
      this.onExecutionStart?.(plan.card_id)

      try {
        const result = await runPlan(this.cwd, plan.id, this.session)
        this.onExecutionComplete?.(plan.card_id, result.success)

        if (!result.success) {
          console.error(`[LoopOrchestrator] Plan ${plan.id} failed: ${result.error}`)
        }
      } catch (error) {
        console.error(`[LoopOrchestrator] Failed to execute plan ${plan.id}:`, error)
        this.onExecutionComplete?.(plan.card_id, false)
      }
    }
  }

  /**
   * 运行 Evaluate 阶段 - 评估执行结果
   */
  private async runEvalPhase(): Promise<EvaluationResult> {
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
    const evalOutput = await runEvaluation(this.cwd, design, this.session)

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
    const optimizationResult = await runOptimization(this.cwd, design)

    // 应用优化结果
    await applyOptimizations(this.cwd, design, optimizationResult)

    // 更新 loop 关闭摘要
    const summary = `Loop completed. ${optimizationResult.insights.length} insights, ${optimizationResult.unlockedNegs.length} negatives unlocked`
    await updateLoopCloseSummary(this.cwd, this.currentLoopId!, summary)
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
    this.phase = phase
    this.onPhaseChange?.(phase)
  }

  private extractText(response: unknown): string {
    if (typeof response === "string") return response
    const r = response as any
    if (typeof r?.text === "string") return r.text
    if (Array.isArray(r?.content)) return r.content.map((c: any) => c?.text ?? "").join("\n")
    return String(response)
  }

  getPhase(): LoopPhase {
    return this.phase
  }

  getCurrentCards(): DecisionCard[] {
    return this.currentCards
  }

  getCurrentLoopId(): string | null {
    return this.currentLoopId
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
