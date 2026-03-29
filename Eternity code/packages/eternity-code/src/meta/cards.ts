import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { RawCard, CardDecision, RejectedDirection, MetaDesign } from "./types.js"
import { MetaPaths, resolveMetaDesignPath, resolveMetaDirectory, resolveMetaEntryPath } from "./paths.js"

export const DEFAULT_CARD_TEMPLATE_ID = "meta-default-card-template"

// ── Card ID management ──────────────────────────────────────

function nextId(dir: string, prefix: string): string {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".yaml"))
  const nums = files.map((f) => parseInt(f.replace(prefix, "").replace(".yaml", ""), 10)).filter((n) => !isNaN(n))
  const next = nums.length ? Math.max(...nums) + 1 : 1
  return `${prefix}${String(next).padStart(3, "0")}`
}

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
    } catch {
      // malformed card block: skip
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
  const id = nextId(dir, "CARD-")
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

  const card = yaml.load(fs.readFileSync(cardPath, "utf8")) as Record<string, unknown>
  const currentDecision = (card.decision as Record<string, unknown> | undefined) ?? {}
  ;(card as Record<string, unknown>).decision = {
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
  const designPath = resolveMetaDesignPath(cwd)
  const negDir = MetaPaths.negatives(cwd)

  // Load current design
  const designRaw = fs.readFileSync(designPath, "utf8")
  const design = yaml.load(designRaw) as Record<string, unknown>

  // Generate NEG id
  if (!fs.existsSync(negDir)) fs.mkdirSync(negDir, { recursive: true })
  const negId = nextId(negDir, "NEG-")

  const negEntry = {
    id: negId,
    text: cardObjective,
    reason: note || cardReason,
    scope: { type: "conditional", condition: null, until_phase: null },
    source_card: cardId,
    created_at: new Date().toISOString(),
    status: "active",
    lifted_at: null,
    lifted_note: null,
  }

  // Write individual NEG file
  const negPath = path.join(negDir, `${negId}.yaml`)
  fs.writeFileSync(negPath, yaml.dump(negEntry, { lineWidth: 100 }))

  // Append to design.yaml rejected_directions
  const rejected = (design.rejected_directions as unknown[]) ?? []
  rejected.push(negEntry)
  design.rejected_directions = rejected
  design.updated_at = new Date().toISOString()

  fs.writeFileSync(designPath, yaml.dump(design, { lineWidth: 100 }))

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
  const designPath = resolveMetaDesignPath(cwd)
  
  // Load current design
  const designRaw = fs.readFileSync(designPath, "utf8")
  const design = yaml.load(designRaw) as Record<string, unknown>
  
  // Initialize loop_history if not exists
  if (!design.loop_history) {
    design.loop_history = {
      total_loops: 0,
      last_loop_id: "",
      last_loop_at: "",
      loops: [],
    }
  }
  
  const history = design.loop_history as Record<string, unknown>

  // Update history, but avoid duplicating the same loop on repeated writes.
  const loops = ((history.loops as Record<string, unknown>[]) ?? []).slice()
  const existingIndex = loops.findIndex((loop) => loop.loop_id === loopId)
  if (existingIndex === -1) {
    history.total_loops = Number(history.total_loops ?? 0) + 1
  } else {
    history.total_loops = Math.max(Number(history.total_loops ?? 0), loops.length)
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
  
  fs.writeFileSync(designPath, yaml.dump(design, { lineWidth: 100 }))
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
function evaluateNegativeCondition(condition: string, design: MetaDesign): boolean {
  // 解析简单条件表达式
  const conditions: Record<string, () => boolean> = {
    "monthly_active_users > 1000": () => {
      // 假设有用户指标
      return false // 默认不满足
    },
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
    "re_evaluation_required": () => true, // 总是满足
  }

  // 尝试匹配条件
  for (const [pattern, evaluator] of Object.entries(conditions)) {
    if (condition.includes(pattern) || condition === pattern) {
      return evaluator()
    }
  }

  // 默认不满足
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
  const designPath = MetaPaths.design(cwd)
  const negDir = MetaPaths.negatives(cwd)
  
  // 更新design.yaml
  const designRaw = fs.readFileSync(designPath, "utf8")
  const design = yaml.load(designRaw) as Record<string, unknown>
  
  const rejected = (design.rejected_directions as any[]) ?? []
  const negIndex = rejected.findIndex(n => n.id === negId)
  
  if (negIndex === -1) {
    throw new Error(`Negative not found: ${negId}`)
  }
  
  rejected[negIndex] = {
    ...rejected[negIndex],
    status: "lifted",
    lifted_at: new Date().toISOString(),
    lifted_note: reason,
  }
  
  design.rejected_directions = rejected
  design.updated_at = new Date().toISOString()
  
  fs.writeFileSync(designPath, yaml.dump(design, { lineWidth: 100 }))
  
  // 更新negatives目录中的文件
  const negPath = path.join(negDir, `${negId}.yaml`)
  if (fs.existsSync(negPath)) {
    const negRaw = fs.readFileSync(negPath, "utf8")
    const neg = yaml.load(negRaw) as Record<string, unknown>
    
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
