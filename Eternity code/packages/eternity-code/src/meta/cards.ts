import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { RawCard, CardDecision, RejectedDirection, MetaDesign } from "./types.js"
import { MetaPaths, resolveMetaDesignPath, resolveMetaDirectory, resolveMetaEntryPath } from "./paths.js"
import { readYamlStrict } from "./utils/schema-validator.js"
import { updateDesignYaml } from "./design.js"
import { generateCardId, generateNegId } from "./utils/id-generator.js"
import { MetaDecisionCardSchema, MetaDesignSchema, NegativeEntrySchema } from "./schemas.js"

const CardPassthroughSchema = MetaDecisionCardSchema.passthrough()
const DesignPassthroughSchema = MetaDesignSchema.passthrough()
const NegativePassthroughSchema = NegativeEntrySchema.passthrough()

export const DEFAULT_CARD_TEMPLATE_ID = "meta-default-card-template"

// ── Parse cards from model output ──────────────────────────

export function parseCardsFromText(text: string): RawCard[] {
  const cards: RawCard[] = []
  const blocks = text.split("---CARD START---").slice(1)

  for (const block of blocks) {
    const end = block.indexOf("---CARD END---")
    if (end === -1) continue
    const content = block.slice(0, end).trim()

    try {
      const parsed = yaml.load(content) as Record<string, unknown>
      if (!parsed || typeof parsed !== "object") continue

      const card: RawCard = {
        objective: String(parsed.objective ?? ""),
        approach: String(parsed.approach ?? ""),
        benefit: String(parsed.benefit ?? ""),
        cost: String(parsed.cost ?? ""),
        risk: String(parsed.risk ?? ""),
        confidence: Number(parsed.confidence ?? 0.5),
        req_refs: parseStringList(parsed.req_refs),
        warnings: parseStringList(parsed.warnings),
      }

      if (card.objective) cards.push(card)
    } catch (err) {
      console.warn(`[cards] Failed to parse card block: ${err instanceof Error ? err.message : String(err)}`)
      console.warn(`[cards] Raw content: ${content.slice(0, 200)}...`)
    }
  }

  return cards
}

function parseStringList(val: unknown): string[] {
  if (!val || val === "none") return []
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === "string") return val.split(",").map((s) => s.trim()).filter(Boolean)
  return []
}

// ── Write card to disk ──────────────────────────────────────

export async function writeCard(
  cwd: string,
  card: RawCard,
  loopId: string,
  options: {
    templateId?: string
    generator?: string
  } = {},
): Promise<string> {
  const dir = resolveMetaDirectory(cwd, "cards")
  const id = generateCardId()
  const cardPath = path.join(dir, `${id}.yaml`)

  const cardObj = {
    _schema_version: "1.0.0",
    _schema_type: "decision_card",
    id,
    loop_id: loopId,
    req_refs: card.req_refs,
    content: {
      objective: card.objective,
      approach: card.approach,
      benefit: card.benefit,
      cost: card.cost,
      risk: card.risk,
      warnings: card.warnings,
    },
    prediction: {
      confidence: card.confidence,
    },
    source: {
      template_id: card.template_id ?? options.templateId ?? DEFAULT_CARD_TEMPLATE_ID,
      generator: options.generator ?? "meta",
    },
    decision: {
      status: "pending",
      chosen_by: null,
      resolved_at: null,
      note: null,
    },
    outcome: null,
    created_at: new Date().toISOString(),
  }

  fs.writeFileSync(cardPath, yaml.dump(cardObj, { lineWidth: 100 }))
  return id
}

// ── Resolve a card (accept or reject) ──────────────────────

export async function resolveCard(
  cwd: string,
  cardId: string,
  decision: CardDecision
): Promise<void> {
  const cardPath = resolveMetaEntryPath(cwd, "cards", `${cardId}.yaml`)
  if (!fs.existsSync(cardPath)) throw new Error(`Card not found: ${cardId}`)

  const card = readYamlStrict(cardPath, CardPassthroughSchema) as Record<string, unknown>
  const currentDecision = (card.decision as Record<string, unknown> | undefined) ?? {}
  card.decision = {
    status: decision.status,
    note: decision.note ?? null,
    chosen_by: decision.chosen_by ?? currentDecision.chosen_by ?? null,
    resolved_at: decision.resolved_at,
  }

  fs.writeFileSync(cardPath, yaml.dump(card, { lineWidth: 100 }))
}

// ── Write rejected direction to design.yaml + negatives/ ───

export async function writeRejectedDirection(
  cwd: string,
  cardId: string,
  cardObjective: string,
  cardReason: string,
  note: string
): Promise<string> {
  const negDir = MetaPaths.negatives(cwd)

  // Generate NEG id
  if (!fs.existsSync(negDir)) fs.mkdirSync(negDir, { recursive: true })
  const negId = generateNegId()

  const negEntry = {
    id: negId,
    text: cardObjective,
    reason: note || cardReason,
    scope: { type: "conditional" as const, condition: undefined as string | undefined, until_phase: undefined as string | undefined },
    source_card: cardId,
    created_at: new Date().toISOString(),
    status: "active" as const,
  }

  // Write individual NEG file (includes lifted_at/lifted_note for negatives/ directory)
  const negFileEntry = { ...negEntry, lifted_at: null, lifted_note: null }
  const negPath = path.join(negDir, `${negId}.yaml`)
  fs.writeFileSync(negPath, yaml.dump(negFileEntry, { lineWidth: 100 }))

  // Update design.yaml with file lock protection
  await updateDesignYaml(cwd, (design) => {
    const rejected = design.rejected_directions ?? []
    rejected.push(negEntry)
    design.rejected_directions = rejected
    design.updated_at = new Date().toISOString()
    return design
  })

  return negId
}

// ── Update loop history in design.yaml ─────────────────────

export async function updateLoopHistory(
  cwd: string,
  loopId: string,
  status: string,
  cardsProposed: number,
  cardsAccepted: number,
  cardsRejected: number,
  summary: string
): Promise<void> {
  await updateDesignYaml(cwd, (design) => {
    if (!design.loop_history) {
      design.loop_history = {
        total_loops: 0,
        last_loop_id: "",
        last_loop_at: "",
        loops: [],
      }
    }

    const history = design.loop_history
    const loops = (history.loops ?? []).slice()
    const existingIndex = loops.findIndex((loop) => loop.loop_id === loopId)
    if (existingIndex === -1) {
      history.total_loops = (history.total_loops ?? 0) + 1
    } else {
      history.total_loops = Math.max(history.total_loops ?? 0, loops.length)
    }
    history.last_loop_id = loopId
    history.last_loop_at = new Date().toISOString()

    const nextLoop = {
      loop_id: loopId,
      status,
      cards_proposed: cardsProposed,
      cards_accepted: cardsAccepted,
      cards_rejected: cardsRejected,
      composite_score_delta: 0,
      summary,
    }
    if (existingIndex === -1) {
      loops.push(nextLoop)
    } else {
      loops[existingIndex] = {
        ...loops[existingIndex],
        ...nextLoop,
      }
    }
    history.loops = loops

    design.loop_history = history
    design.updated_at = new Date().toISOString()
    return design
  })
}

// ── Negative Space Intelligent Management ──────────────────

export interface NegativeAnalysis {
  negId: string
  status: string
  canUnlock: boolean
  unlockReason?: string
  suggestedScope?: {
    type: string
    condition?: string
    until_phase?: string
  }
}

/**
 * 分析Negative的解锁可能性
 */
export function analyzeNegativeUnlockability(
  design: MetaDesign,
  neg: RejectedDirection
): NegativeAnalysis {
  const analysis: NegativeAnalysis = {
    negId: neg.id,
    status: neg.status,
    canUnlock: false,
  }

  if (neg.status !== "active") {
    analysis.canUnlock = false
    return analysis
  }

  // 检查phase类型negative
  if (neg.scope?.type === "phase" && neg.scope.until_phase) {
    if (design.project.stage === neg.scope.until_phase) {
      analysis.canUnlock = true
      analysis.unlockReason = `项目已达到阶段 "${neg.scope.until_phase}"`
    }
  }

  // 检查conditional类型negative
  if (neg.scope?.type === "conditional" && neg.scope.condition) {
    const conditionMet = evaluateNegativeCondition(neg.scope.condition, design)
    if (conditionMet) {
      analysis.canUnlock = true
      analysis.unlockReason = `条件已满足: ${neg.scope.condition}`
    }
  }

  // 检查是否存在相关的成功卡片
  if (neg.source_card) {
    const hasSuccessfulAlternative = checkSuccessfulAlternative(design, neg.source_card)
    if (hasSuccessfulAlternative) {
      analysis.canUnlock = true
      analysis.unlockReason = "存在成功实现类似目标的替代方案"
    }
  }

  // 检查negative存在时间
  if (neg.created_at) {
    const createdAt = new Date(neg.created_at)
    const now = new Date()
    const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
    
    if (daysSinceCreation > 90) {
      analysis.canUnlock = true
      analysis.unlockReason = `已存在超过90天，建议重新评估`
      analysis.suggestedScope = {
        type: "conditional",
        condition: "re_evaluation_required"
      }
    }
  }

  return analysis
}

/**
 * 评估negative条件
 */
export function evaluateNegativeCondition(condition: string, design: MetaDesign): boolean {
  const stage = design.project.stage

  // 标准条件映射
  const standardConditions: Record<string, () => boolean> = {
    "always": () => true,
    "never": () => false,
    "prototype_complete": () => stage === "mvp" || stage === "growth" || stage === "mature",
    "mvp_complete": () => stage === "growth" || stage === "mature",
    "growth_complete": () => stage === "mature",
    "re_evaluation_required": () => true,
    "monthly_active_users > 1000": () => false,
    "total_loops > 10": () => {
      const totalLoops = design.loop_history?.total_loops ?? 0
      return totalLoops > 10
    },
    "acceptance_rate > 0.7": () => {
      const loops = design.loop_history?.loops ?? []
      if (loops.length < 5) return false
      const recentLoops = loops.slice(-5)
      const avgAcceptance = recentLoops.reduce((sum, l) =>
        sum + ((l.cards_accepted ?? 0) / (l.cards_proposed ?? 1)), 0
      ) / recentLoops.length
      return avgAcceptance > 0.7
    },
  }

  // 精确匹配标准条件
  if (standardConditions[condition]) {
    return standardConditions[condition]()
  }

  // 模糊匹配（兼容旧格式）
  for (const [pattern, evaluator] of Object.entries(standardConditions)) {
    if (condition.includes(pattern)) {
      return evaluator()
    }
  }

  // 支持参数化条件：total_loops > N
  const totalLoopsMatch = condition.match(/total_loops\s*>\s*(\d+)/)
  if (totalLoopsMatch) {
    const threshold = parseInt(totalLoopsMatch[1])
    const totalLoops = design.loop_history?.total_loops ?? 0
    return totalLoops > threshold
  }

  // 非标准条件 - 记录警告并返回 false
  console.warn(`[negatives] Unknown condition format: "${condition}". Returning false.`)
  console.warn(`[negatives] Valid conditions: ${Object.keys(standardConditions).join(", ")}`)

  return false
}

/**
 * 检查是否存在成功的替代方案
 */
function checkSuccessfulAlternative(design: MetaDesign, sourceCardId: string): boolean {
  // 这里需要检查是否有其他卡片实现了类似目标
  // 简化实现：检查循环历史中是否有成功的循环
  const loops = design.loop_history?.loops ?? []
  const recentSuccessfulLoops = loops.filter(l => 
    l.status === "completed" && (l.cards_accepted ?? 0) > 0
  ).slice(-3)
  
  return recentSuccessfulLoops.length >= 2
}

/**
 * 批量分析所有active negatives
 */
export function analyzeAllNegatives(design: MetaDesign): NegativeAnalysis[] {
  const negs = design.rejected_directions ?? []
  return negs
    .filter(neg => neg.status === "active")
    .map(neg => analyzeNegativeUnlockability(design, neg))
}

/**
 * 生成negative解锁建议
 */
export function generateNegativeUnlockSuggestions(
  design: MetaDesign,
  analyses: NegativeAnalysis[]
): string[] {
  const suggestions: string[] = []
  
  const unlockable = analyses.filter(a => a.canUnlock)
  
  if (unlockable.length === 0) {
    suggestions.push("当前没有可解锁的Negative")
    return suggestions
  }
  
  suggestions.push(`发现 ${unlockable.length} 个可解锁的Negative:`)
  
  for (const analysis of unlockable) {
    const neg = design.rejected_directions?.find(n => n.id === analysis.negId)
    if (neg) {
      suggestions.push(`- ${neg.id}: ${neg.text}`)
      suggestions.push(`  解锁原因: ${analysis.unlockReason}`)
    }
  }
  
  return suggestions
}

/**
 * 解锁negative
 */
export async function unlockNegative(
  cwd: string,
  negId: string,
  reason: string
): Promise<void> {
  const negDir = MetaPaths.negatives(cwd)
  
  // 更新design.yaml
  await updateDesignYaml(cwd, (design) => {
    const rejected = design.rejected_directions ?? []
    const negIndex = rejected.findIndex(n => n.id === negId)
    
    if (negIndex === -1) {
      throw new Error(`Negative not found: ${negId}`)
    }
    
    rejected[negIndex] = {
      ...rejected[negIndex],
      status: "lifted",
      lifted_at: new Date().toISOString(),
      lifted_note: reason,
    } as RejectedDirection & { lifted_at: string; lifted_note: string }
    
    design.rejected_directions = rejected
    design.updated_at = new Date().toISOString()
    return design
  })
  
  // 更新negatives目录中的文件
  const negPath = path.join(negDir, `${negId}.yaml`)
  if (fs.existsSync(negPath)) {
    const neg = readYamlStrict(negPath, NegativePassthroughSchema) as Record<string, unknown>
    
    neg.status = "lifted"
    neg.lifted_at = new Date().toISOString()
    neg.lifted_note = reason
    
    fs.writeFileSync(negPath, yaml.dump(neg, { lineWidth: 100 }))
  }
}

/**
 * 批量解锁negatives
 */
export async function batchUnlockNegatives(
  cwd: string,
  analyses: NegativeAnalysis[]
): Promise<string[]> {
  const unlocked: string[] = []
  
  for (const analysis of analyses) {
    if (analysis.canUnlock && analysis.unlockReason) {
      try {
        await unlockNegative(cwd, analysis.negId, analysis.unlockReason)
        unlocked.push(analysis.negId)
      } catch (error) {
        console.error(`Failed to unlock ${analysis.negId}:`, error)
      }
    }
  }
  
  return unlocked
}
