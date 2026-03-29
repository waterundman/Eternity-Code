import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { MetaDesign, RejectedDirection } from "./types.js"
import { listMetaEntryPaths, resolveMetaDesignPath } from "./paths.js"

export interface LoopStats {
  loopId: string
  status: string
  cardsProposed: number
  cardsAccepted: number
  cardsRejected: number
  acceptanceRate: number
}

export interface SourceStats {
  source: string
  totalCards: number
  acceptedCards: number
  acceptanceRate: number
}

export interface OptimizationResult {
  currentStats: {
    totalLoops: number
    averageAcceptanceRate: number
    sourceStats: SourceStats[]
    explorationRate: number
    coverageGaps: CoverageGap[]
  }
  recommendations: {
    source: string
    currentWeight: number
    recommendedWeight: number
    reason: string
  }[]
  explorationRateRecommendation: {
    current: number
    recommended: number
    reason: string
  }
  unlockedNegs: string[]
  insights: string[]
}

export interface CoverageGap {
  requirementId: string
  currentCoverage: number
  targetCoverage: number
  gap: number
  priority: number
}

/**
 * 分析历史 loop 统计
 */
export function analyzeLoopHistory(design: MetaDesign): LoopStats[] {
  const loops = design.loop_history?.loops ?? []
  
  return loops.map(loop => ({
    loopId: loop.loop_id,
    status: loop.status,
    cardsProposed: loop.cards_proposed ?? 0,
    cardsAccepted: loop.cards_accepted ?? 0,
    cardsRejected: loop.cards_rejected ?? 0,
    acceptanceRate: loop.cards_proposed 
      ? (loop.cards_accepted ?? 0) / loop.cards_proposed 
      : 0
  }))
}

/**
 * 分析候选来源的接受率
 */
export function analyzeSourceAcceptance(cwd: string, design: MetaDesign): SourceStats[] {
  const cardPaths = listMetaEntryPaths(cwd, "cards", ".yaml")

  if (cardPaths.length === 0) {
    return []
  }
  const sourceMap: Record<string, { total: number; accepted: number }> = {}

  for (const cardPath of cardPaths) {
    const card = yaml.load(fs.readFileSync(cardPath, "utf8")) as any
    
    // 从卡片的 req_refs 推断来源
    const source = inferCardSource(card)
    
    if (!sourceMap[source]) {
      sourceMap[source] = { total: 0, accepted: 0 }
    }
    
    sourceMap[source].total++
    
    if (card.decision?.status === "accepted") {
      sourceMap[source].accepted++
    }
  }
  
  return Object.entries(sourceMap).map(([source, stats]) => ({
    source,
    totalCards: stats.total,
    acceptedCards: stats.accepted,
    acceptanceRate: stats.total > 0 ? stats.accepted / stats.total : 0
  }))
}

/**
 * 分析覆盖率差距
 */
export function analyzeCoverageGaps(design: MetaDesign): CoverageGap[] {
  const requirements = design.requirements ?? []
  const gaps: CoverageGap[] = []
  
  for (const req of requirements) {
    const currentCoverage = req.coverage ?? 0
    const targetCoverage = 1.0 // 目标是100%覆盖
    const gap = targetCoverage - currentCoverage
    
    // 根据差距和优先级计算权重
    const priorityWeight = req.priority === "p0" ? 3 : req.priority === "p1" ? 2 : 1
    const priority = gap * priorityWeight
    
    gaps.push({
      requirementId: req.id,
      currentCoverage,
      targetCoverage,
      gap,
      priority
    })
  }
  
  // 按优先级排序
  return gaps.sort((a, b) => b.priority - a.priority)
}

/**
 * 计算推荐的exploration rate
 */
export function calculateExplorationRateRecommendation(
  design: MetaDesign,
  loopStats: LoopStats[],
  sourceStats: SourceStats[]
): OptimizationResult["explorationRateRecommendation"] {
  const currentRate = design.search_policy?.exploration_rate ?? 0.2
  const totalLoops = loopStats.length
  
  let recommendedRate = currentRate
  let reason = ""
  
  if (totalLoops < 5) {
    // 早期阶段，保持较高的exploration
    recommendedRate = Math.max(0.3, currentRate)
    reason = "早期阶段，建议保持较高探索率以发现更多可能性"
  } else {
    // 计算最近的接受率趋势
    const recentLoops = loopStats.slice(-5)
    const recentAcceptanceRate = recentLoops.reduce((sum, s) => sum + s.acceptanceRate, 0) / recentLoops.length
    
    // 计算来源多样性
    const sourceDiversity = sourceStats.length > 0 
      ? 1 - Math.max(...sourceStats.map(s => s.acceptanceRate))
      : 0.5
    
    if (recentAcceptanceRate < 0.3) {
      // 接受率低，增加exploration以寻找新的方向
      recommendedRate = Math.min(0.5, currentRate * 1.3)
      reason = `最近接受率较低 (${(recentAcceptanceRate * 100).toFixed(0)}%)，建议增加探索率`
    } else if (recentAcceptanceRate > 0.7) {
      // 接受率高，可以减少exploration，专注于已验证的方向
      recommendedRate = Math.max(0.1, currentRate * 0.8)
      reason = `最近接受率较高 (${(recentAcceptanceRate * 100).toFixed(0)}%)，建议减少探索率`
    } else if (sourceDiversity < 0.3) {
      // 来源多样性低，增加exploration
      recommendedRate = Math.min(0.4, currentRate * 1.2)
      reason = "来源多样性较低，建议增加探索率以扩大候选来源"
    } else {
      reason = "当前探索率适中，保持不变"
    }
  }
  
  return {
    current: currentRate,
    recommended: recommendedRate,
    reason
  }
}

/**
 * 生成优化洞察
 */
export function generateOptimizationInsights(
  design: MetaDesign,
  loopStats: LoopStats[],
  sourceStats: SourceStats[],
  coverageGaps: CoverageGap[]
): string[] {
  const insights: string[] = []
  
  // 分析接受率趋势
  if (loopStats.length >= 3) {
    const recentLoops = loopStats.slice(-3)
    const trend = recentLoops[2].acceptanceRate - recentLoops[0].acceptanceRate
    
    if (trend > 0.2) {
      insights.push("接受率呈上升趋势，当前策略有效")
    } else if (trend < -0.2) {
      insights.push("接受率呈下降趋势，建议调整搜索策略")
    }
  }
  
  // 分析来源表现
  const bestSource = sourceStats.reduce((best, s) => 
    s.acceptanceRate > best.acceptanceRate ? s : best, 
    { source: "none", acceptanceRate: 0 }
  )
  
  if (bestSource.source !== "none" && bestSource.acceptanceRate > 0.6) {
    insights.push(`来源 "${bestSource.source}" 表现最佳 (${(bestSource.acceptanceRate * 100).toFixed(0)}% 接受率)`)
  }
  
  // 分析覆盖率差距
  const criticalGaps = coverageGaps.filter(g => g.gap > 0.5)
  if (criticalGaps.length > 0) {
    insights.push(`${criticalGaps.length} 个需求覆盖率严重不足，建议优先处理`)
  }
  
  // 分析循环效率
  const avgCardsPerLoop = loopStats.length > 0
    ? loopStats.reduce((sum, s) => sum + s.cardsProposed, 0) / loopStats.length
    : 0
  
  if (avgCardsPerLoop > 5) {
    insights.push("每次循环生成卡片数较多，建议减少以提高质量")
  } else if (avgCardsPerLoop < 2) {
    insights.push("每次循环生成卡片数较少，建议增加以提高效率")
  }
  
  return insights
}

/**
 * 推断卡片来源
 */
function inferCardSource(card: any): string {
  const reqRefs = card.req_refs ?? []
  
  // 简单推断：根据 req_refs 的第一个推断来源
  if (reqRefs.length > 0) {
    const firstRef = reqRefs[0]
    
    if (firstRef.includes("REQ")) {
      return "coverage_gap"
    }
    if (firstRef.includes("EVAL")) {
      return "eval_regression"
    }
    if (firstRef.includes("TECH")) {
      return "tech_debt"
    }
  }
  
  return "free_exploration"
}

/**
 * 生成权重调整建议
 */
export function generateWeightRecommendations(
  design: MetaDesign,
  sourceStats: SourceStats[],
  coverageGaps: CoverageGap[] = []
): OptimizationResult["recommendations"] {
  const currentSources = design.search_policy?.candidate_sources ?? []
  const recommendations: OptimizationResult["recommendations"] = []
  
  // 计算平均接受率
  const avgAcceptanceRate = sourceStats.length > 0
    ? sourceStats.reduce((sum, s) => sum + s.acceptanceRate, 0) / sourceStats.length
    : 0.5
  
  // 计算覆盖率差距的影响
  const hasCriticalGaps = coverageGaps.some(g => g.gap > 0.5)
  const totalGap = coverageGaps.reduce((sum, g) => sum + g.gap, 0)
  
  for (const stat of sourceStats) {
    const currentSource = currentSources.find(s => s.source === stat.source)
    const currentWeight = currentSource?.weight ?? 0.25
    
    let recommendedWeight = currentWeight
    let reason = ""
    
    // 如果接受率高于平均，增加权重
    if (stat.acceptanceRate > avgAcceptanceRate * 1.2) {
      recommendedWeight = Math.min(0.6, currentWeight * 1.3)
      reason = `高接受率 (${(stat.acceptanceRate * 100).toFixed(0)}%)，建议增加权重`
    }
    // 如果接受率低于平均，减少权重
    else if (stat.acceptanceRate < avgAcceptanceRate * 0.8) {
      recommendedWeight = Math.max(0.05, currentWeight * 0.7)
      reason = `低接受率 (${(stat.acceptanceRate * 100).toFixed(0)}%)，建议减少权重`
    } else {
      reason = `接受率接近平均 (${(stat.acceptanceRate * 100).toFixed(0)}%)，保持权重`
    }
    
    // 根据覆盖率差距调整权重
    if (hasCriticalGaps && stat.source === "coverage_gap") {
      recommendedWeight = Math.min(0.7, recommendedWeight * 1.5)
      reason += "，因存在严重覆盖率差距"
    }
    
    recommendations.push({
      source: stat.source,
      currentWeight,
      recommendedWeight,
      reason
    })
  }
  
  return recommendations
}

/**
 * 检查可解锁的 NEG
 */
export function checkUnlockableNegs(design: MetaDesign): string[] {
  const negs = design.rejected_directions ?? []
  const unlocked: string[] = []
  
  for (const neg of negs) {
    if (neg.status !== "active") continue
    
    // 检查条件性 NEG
    if (neg.scope?.type === "conditional" && neg.scope.condition) {
      // 简单条件评估
      if (evaluateCondition(neg.scope.condition, design)) {
        unlocked.push(neg.id)
      }
    }
    
    // 检查阶段性 NEG
    if (neg.scope?.type === "phase" && neg.scope.until_phase) {
      if (design.project.stage === neg.scope.until_phase) {
        unlocked.push(neg.id)
      }
    }
  }
  
  return unlocked
}

/**
 * 评估条件
 */
function evaluateCondition(condition: string, design: MetaDesign): boolean {
  // 简单条件评估
  // 在实际实现中，这里会解析条件表达式
  
  // 示例条件: "monthly_active_users > 1000"
  // 示例条件: "total_loops > 10"
  
  if (condition.includes("total_loops")) {
    const match = condition.match(/total_loops\s*>\s*(\d+)/)
    if (match) {
      const threshold = parseInt(match[1])
      const totalLoops = design.loop_history?.total_loops ?? 0
      return totalLoops > threshold
    }
  }
  
  return false
}

/**
 * 更新需求覆盖度
 */
export async function updateRequirementCoverage(
  cwd: string,
  design: MetaDesign
): Promise<void> {
  const designPath = resolveMetaDesignPath(cwd)
  
  if (!fs.existsSync(designPath)) {
    throw new Error("design.yaml not found")
  }
  
  const requirements = design.requirements ?? []
  
  // 分析已接受的卡片对需求的影响
  const cardPaths = listMetaEntryPaths(cwd, "cards", ".yaml")

  if (cardPaths.length === 0) {
    return
  }
  
  for (const req of requirements) {
    let coverageBoost = 0
    
    for (const cardPath of cardPaths) {
      const card = yaml.load(fs.readFileSync(cardPath, "utf8")) as any
      
      // 检查卡片是否关联到这个需求
      if (card.req_refs?.includes(req.id) && card.decision?.status === "accepted") {
        // 如果卡片被执行且成功，增加覆盖度
        if (card.outcome?.status === "success") {
          coverageBoost += 0.1 // 每个成功执行的卡片增加 10% 覆盖度
        }
      }
    }
    
    // 更新覆盖度（上限 1.0）
    req.coverage = Math.min(1.0, (req.coverage ?? 0) + coverageBoost)
    req.last_checked = new Date().toISOString()
  }
  
  // 保存更新
  const updatedDesign = { ...design, requirements, updated_at: new Date().toISOString() }
  fs.writeFileSync(designPath, yaml.dump(updatedDesign, { lineWidth: 100 }))
}

/**
 * 运行完整优化
 */
export async function runOptimization(
  cwd: string,
  design: MetaDesign
): Promise<OptimizationResult> {
  // 分析历史统计
  const loopStats = analyzeLoopHistory(design)
  const sourceStats = analyzeSourceAcceptance(cwd, design)
  
  // 计算平均接受率
  const avgAcceptanceRate = loopStats.length > 0
    ? loopStats.reduce((sum, s) => sum + s.acceptanceRate, 0) / loopStats.length
    : 0
  
  // 分析覆盖率差距
  const coverageGaps = analyzeCoverageGaps(design)
  
  // 生成权重调整建议
  const recommendations = generateWeightRecommendations(design, sourceStats, coverageGaps)
  
  // 计算exploration rate建议
  const explorationRateRecommendation = calculateExplorationRateRecommendation(design, loopStats, sourceStats)
  
  // 检查可解锁的 NEG
  const unlockedNegs = checkUnlockableNegs(design)
  
  // 生成优化洞察
  const insights = generateOptimizationInsights(design, loopStats, sourceStats, coverageGaps)
  
  // 更新需求覆盖度
  await updateRequirementCoverage(cwd, design)
  
  return {
    currentStats: {
      totalLoops: loopStats.length,
      averageAcceptanceRate: avgAcceptanceRate,
      sourceStats,
      explorationRate: design.search_policy?.exploration_rate ?? 0.2,
      coverageGaps
    },
    recommendations,
    explorationRateRecommendation,
    unlockedNegs,
    insights
  }
}

/**
 * 应用优化建议
 */
export async function applyOptimizations(
  cwd: string,
  design: MetaDesign,
  result: OptimizationResult
): Promise<void> {
  const designPath = resolveMetaDesignPath(cwd)
  
  if (!fs.existsSync(designPath)) {
    throw new Error("design.yaml not found")
  }
  
  // 更新 search_policy 权重
  if (design.search_policy?.candidate_sources) {
    for (const rec of result.recommendations) {
      const source = design.search_policy.candidate_sources.find(s => s.source === rec.source)
      if (source) {
        source.weight = rec.recommendedWeight
      }
    }
  }
  
  // 更新 exploration_rate
  if (design.search_policy) {
    design.search_policy.exploration_rate = result.explorationRateRecommendation.recommended
  }
  
  // 解锁 NEG
  if (design.rejected_directions) {
    for (const negId of result.unlockedNegs) {
      const neg = design.rejected_directions.find(n => n.id === negId)
      if (neg) {
        neg.status = "pending_review"
      }
    }
  }
  
  // 保存更新
  design.updated_at = new Date().toISOString()
  fs.writeFileSync(designPath, yaml.dump(design, { lineWidth: 100 }))
}
