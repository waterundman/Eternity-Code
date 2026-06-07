import { describe, test, expect } from "bun:test"
import type { MetaDesign } from "../../types.js"

// 从 optimizer.ts 提取的纯函数

interface LoopStats {
  loopId: string
  status: string
  cardsProposed: number
  cardsAccepted: number
  cardsRejected: number
  acceptanceRate: number
}

interface SourceStats {
  source: string
  totalCards: number
  acceptedCards: number
  acceptanceRate: number
}

interface CoverageGap {
  requirementId: string
  currentCoverage: number
  targetCoverage: number
  gap: number
  priority: number
}

/**
 * 分析历史 loop 统计 - 从 optimizer.ts 提取
 */
function analyzeLoopHistory(design: MetaDesign): LoopStats[] {
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
 * 分析覆盖率差距 - 从 optimizer.ts 提取
 */
function analyzeCoverageGaps(design: MetaDesign): CoverageGap[] {
  const requirements = design.requirements ?? []
  const gaps: CoverageGap[] = []
  
  for (const req of requirements) {
    const currentCoverage = req.coverage ?? 0
    const targetCoverage = 1.0
    const gap = targetCoverage - currentCoverage
    
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
  
  return gaps.sort((a, b) => b.priority - a.priority)
}

/**
 * 计算推荐的exploration rate - 从 optimizer.ts 提取
 */
function calculateExplorationRateRecommendation(
  design: MetaDesign,
  loopStats: LoopStats[],
  sourceStats: SourceStats[]
): { current: number; recommended: number; reason: string } {
  const currentRate = design.search_policy?.exploration_rate ?? 0.2
  const totalLoops = loopStats.length
  
  let recommendedRate = currentRate
  let reason = ""
  
  if (totalLoops < 5) {
    recommendedRate = Math.max(0.3, currentRate)
    reason = "早期阶段，建议保持较高探索率以发现更多可能性"
  } else {
    const recentLoops = loopStats.slice(-5)
    const recentAcceptanceRate = recentLoops.reduce((sum, s) => sum + s.acceptanceRate, 0) / recentLoops.length
    
    const sourceDiversity = sourceStats.length > 0 
      ? 1 - Math.max(...sourceStats.map(s => s.acceptanceRate))
      : 0.5
    
    if (recentAcceptanceRate < 0.3) {
      recommendedRate = Math.min(0.5, currentRate * 1.3)
      reason = `最近接受率较低 (${(recentAcceptanceRate * 100).toFixed(0)}%)，建议增加探索率`
    } else if (recentAcceptanceRate > 0.7) {
      recommendedRate = Math.max(0.1, currentRate * 0.8)
      reason = `最近接受率较高 (${(recentAcceptanceRate * 100).toFixed(0)}%)，建议减少探索率`
    } else if (sourceDiversity < 0.3) {
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
 * 生成优化洞察 - 从 optimizer.ts 提取
 */
function generateOptimizationInsights(
  design: MetaDesign,
  loopStats: LoopStats[],
  sourceStats: SourceStats[],
  coverageGaps: CoverageGap[]
): string[] {
  const insights: string[] = []
  
  if (loopStats.length >= 3) {
    const recentLoops = loopStats.slice(-3)
    const trend = recentLoops[2].acceptanceRate - recentLoops[0].acceptanceRate
    
    if (trend > 0.2) {
      insights.push("接受率呈上升趋势，当前策略有效")
    } else if (trend < -0.2) {
      insights.push("接受率呈下降趋势，建议调整搜索策略")
    }
  }
  
  const bestSource = sourceStats.reduce((best, s) => 
    s.acceptanceRate > best.acceptanceRate ? s : best, 
    { source: "none", acceptanceRate: 0 }
  )
  
  if (bestSource.source !== "none" && bestSource.acceptanceRate > 0.6) {
    insights.push(`来源 "${bestSource.source}" 表现最佳 (${(bestSource.acceptanceRate * 100).toFixed(0)}% 接受率)`)
  }
  
  const criticalGaps = coverageGaps.filter(g => g.gap > 0.5)
  if (criticalGaps.length > 0) {
    insights.push(`${criticalGaps.length} 个需求覆盖率严重不足，建议优先处理`)
  }
  
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

function createMinimalDesign(overrides?: Partial<MetaDesign>): MetaDesign {
  return {
    project: {
      id: "test",
      name: "Test Project",
      stage: "mvp",
      core_value: "test",
      anti_value: "test"
    },
    requirements: [],
    ...overrides
  }
}

describe("optimizer", () => {
  describe("analyzeLoopHistory", () => {
    test("should return empty array for no loop history", () => {
      const design = createMinimalDesign()
      expect(analyzeLoopHistory(design)).toEqual([])
    })

    test("should calculate acceptance rate correctly", () => {
      const design = createMinimalDesign({
        loop_history: {
          total_loops: 2,
          loops: [
            {
              loop_id: "loop-1",
              status: "completed",
              cards_proposed: 10,
              cards_accepted: 6,
              cards_rejected: 4
            },
            {
              loop_id: "loop-2",
              status: "completed",
              cards_proposed: 5,
              cards_accepted: 2,
              cards_rejected: 3
            }
          ]
        }
      })

      const result = analyzeLoopHistory(design)
      expect(result).toHaveLength(2)
      expect(result[0].acceptanceRate).toBe(0.6)
      expect(result[1].acceptanceRate).toBe(0.4)
    })

    test("should handle zero proposed cards", () => {
      const design = createMinimalDesign({
        loop_history: {
          total_loops: 1,
          loops: [
            {
              loop_id: "loop-1",
              status: "completed",
              cards_proposed: 0,
              cards_accepted: 0,
              cards_rejected: 0
            }
          ]
        }
      })

      const result = analyzeLoopHistory(design)
      expect(result[0].acceptanceRate).toBe(0)
    })

    test("should handle missing optional fields", () => {
      const design = createMinimalDesign({
        loop_history: {
          total_loops: 1,
          loops: [
            {
              loop_id: "loop-1",
              status: "completed"
            }
          ]
        }
      })

      const result = analyzeLoopHistory(design)
      expect(result[0].cardsProposed).toBe(0)
      expect(result[0].cardsAccepted).toBe(0)
      expect(result[0].cardsRejected).toBe(0)
      expect(result[0].acceptanceRate).toBe(0)
    })

    test("should preserve loop metadata", () => {
      const design = createMinimalDesign({
        loop_history: {
          total_loops: 1,
          loops: [
            {
              loop_id: "loop-42",
              status: "in_progress",
              cards_proposed: 3,
              cards_accepted: 1,
              cards_rejected: 2
            }
          ]
        }
      })

      const result = analyzeLoopHistory(design)
      expect(result[0].loopId).toBe("loop-42")
      expect(result[0].status).toBe("in_progress")
    })
  })

  describe("analyzeCoverageGaps", () => {
    test("should return empty array for no requirements", () => {
      const design = createMinimalDesign()
      expect(analyzeCoverageGaps(design)).toEqual([])
    })

    test("calculate gap correctly", () => {
      const design = createMinimalDesign({
        requirements: [
          { id: "REQ-1", text: "Test", priority: "p0", coverage: 0.3 }
        ]
      })

      const gaps = analyzeCoverageGaps(design)
      expect(gaps[0].gap).toBeCloseTo(0.7)
      expect(gaps[0].targetCoverage).toBe(1.0)
    })

    test("should prioritize p0 over p1 over p2", () => {
      const design = createMinimalDesign({
        requirements: [
          { id: "REQ-p2", text: "Test", priority: "p2", coverage: 0.0 },
          { id: "REQ-p0", text: "Test", priority: "p0", coverage: 0.0 },
          { id: "REQ-p1", text: "Test", priority: "p1", coverage: 0.0 }
        ]
      })

      const gaps = analyzeCoverageGaps(design)
      expect(gaps[0].requirementId).toBe("REQ-p0")
      expect(gaps[1].requirementId).toBe("REQ-p1")
      expect(gaps[2].requirementId).toBe("REQ-p2")
    })

    test("should calculate priority weight based on gap and priority", () => {
      const design = createMinimalDesign({
        requirements: [
          { id: "REQ-1", text: "Test", priority: "p0", coverage: 0.0 }, // gap=1.0, weight=3, priority=3.0
          { id: "REQ-2", text: "Test", priority: "p1", coverage: 0.5 }  // gap=0.5, weight=2, priority=1.0
        ]
      })

      const gaps = analyzeCoverageGaps(design)
      expect(gaps[0].requirementId).toBe("REQ-1")
      expect(gaps[0].priority).toBeCloseTo(3.0)
      expect(gaps[1].requirementId).toBe("REQ-2")
      expect(gaps[1].priority).toBeCloseTo(1.0)
    })

    test("should handle full coverage", () => {
      const design = createMinimalDesign({
        requirements: [
          { id: "REQ-1", text: "Test", priority: "p0", coverage: 1.0 }
        ]
      })

      const gaps = analyzeCoverageGaps(design)
      expect(gaps[0].gap).toBe(0)
      expect(gaps[0].priority).toBe(0)
    })

    test("should handle missing coverage field", () => {
      const design = createMinimalDesign({
        requirements: [
          { id: "REQ-1", text: "Test", priority: "p0", coverage: 0 }
        ]
      })

      const gaps = analyzeCoverageGaps(design)
      expect(gaps[0].currentCoverage).toBe(0)
      expect(gaps[0].gap).toBe(1.0)
    })
  })

  describe("calculateExplorationRateRecommendation", () => {
    test("should recommend higher rate for early stage (< 5 loops)", () => {
      const design = createMinimalDesign({
        search_policy: { exploration_rate: 0.2, mode: "balanced", max_cards_per_loop: 5 }
      })
      const loopStats: LoopStats[] = [
        { loopId: "1", status: "completed", cardsProposed: 5, cardsAccepted: 2, cardsRejected: 3, acceptanceRate: 0.4 }
      ]

      const result = calculateExplorationRateRecommendation(design, loopStats, [])
      expect(result.recommended).toBeGreaterThanOrEqual(0.3)
      expect(result.reason).toContain("早期阶段")
    })

    test("should increase rate when acceptance rate is low", () => {
      const design = createMinimalDesign({
        search_policy: { exploration_rate: 0.2, mode: "balanced", max_cards_per_loop: 5 }
      })
      const loopStats: LoopStats[] = Array(5).fill(null).map((_, i) => ({
        loopId: `${i}`,
        status: "completed",
        cardsProposed: 10,
        cardsAccepted: 2,
        cardsRejected: 8,
        acceptanceRate: 0.2
      }))

      const result = calculateExplorationRateRecommendation(design, loopStats, [])
      expect(result.recommended).toBeGreaterThan(0.2)
      expect(result.reason).toContain("接受率较低")
    })

    test("should decrease rate when acceptance rate is high", () => {
      const design = createMinimalDesign({
        search_policy: { exploration_rate: 0.4, mode: "balanced", max_cards_per_loop: 5 }
      })
      const loopStats: LoopStats[] = Array(5).fill(null).map((_, i) => ({
        loopId: `${i}`,
        status: "completed",
        cardsProposed: 10,
        cardsAccepted: 8,
        cardsRejected: 2,
        acceptanceRate: 0.8
      }))

      const result = calculateExplorationRateRecommendation(design, loopStats, [])
      expect(result.recommended).toBeLessThan(0.4)
      expect(result.reason).toContain("接受率较高")
    })

    test("should increase rate when source diversity is low", () => {
      const design = createMinimalDesign({
        search_policy: { exploration_rate: 0.2, mode: "balanced", max_cards_per_loop: 5 }
      })
      const loopStats: LoopStats[] = Array(5).fill(null).map((_, i) => ({
        loopId: `${i}`,
        status: "completed",
        cardsProposed: 10,
        cardsAccepted: 5,
        cardsRejected: 5,
        acceptanceRate: 0.5
      }))
      const sourceStats: SourceStats[] = [
        { source: "only_source", totalCards: 50, acceptedCards: 25, acceptanceRate: 0.9 }
      ]

      const result = calculateExplorationRateRecommendation(design, loopStats, sourceStats)
      expect(result.recommended).toBeGreaterThan(0.2)
      expect(result.reason).toContain("来源多样性")
    })

    test("should keep rate stable when metrics are balanced", () => {
      const design = createMinimalDesign({
        search_policy: { exploration_rate: 0.25, mode: "balanced", max_cards_per_loop: 5 }
      })
      const loopStats: LoopStats[] = Array(5).fill(null).map((_, i) => ({
        loopId: `${i}`,
        status: "completed",
        cardsProposed: 10,
        cardsAccepted: 5,
        cardsRejected: 5,
        acceptanceRate: 0.5
      }))
      const sourceStats: SourceStats[] = [
        { source: "s1", totalCards: 25, acceptedCards: 12, acceptanceRate: 0.5 },
        { source: "s2", totalCards: 25, acceptedCards: 13, acceptanceRate: 0.5 }
      ]

      const result = calculateExplorationRateRecommendation(design, loopStats, sourceStats)
      expect(result.reason).toContain("保持不变")
    })

    test("should use default rate when not configured", () => {
      const design = createMinimalDesign()
      const result = calculateExplorationRateRecommendation(design, [], [])
      expect(result.current).toBe(0.2)
    })
  })

  describe("generateOptimizationInsights", () => {
    test("should detect upward trend", () => {
      const loopStats: LoopStats[] = [
        { loopId: "1", status: "completed", cardsProposed: 5, cardsAccepted: 1, cardsRejected: 4, acceptanceRate: 0.2 },
        { loopId: "2", status: "completed", cardsProposed: 5, cardsAccepted: 2, cardsRejected: 3, acceptanceRate: 0.4 },
        { loopId: "3", status: "completed", cardsProposed: 5, cardsAccepted: 4, cardsRejected: 1, acceptanceRate: 0.8 }
      ]

      const insights = generateOptimizationInsights(createMinimalDesign(), loopStats, [], [])
      expect(insights.some(i => i.includes("上升趋势"))).toBe(true)
    })

    test("should detect downward trend", () => {
      const loopStats: LoopStats[] = [
        { loopId: "1", status: "completed", cardsProposed: 5, cardsAccepted: 4, cardsRejected: 1, acceptanceRate: 0.8 },
        { loopId: "2", status: "completed", cardsProposed: 5, cardsAccepted: 2, cardsRejected: 3, acceptanceRate: 0.4 },
        { loopId: "3", status: "completed", cardsProposed: 5, cardsAccepted: 1, cardsRejected: 4, acceptanceRate: 0.2 }
      ]

      const insights = generateOptimizationInsights(createMinimalDesign(), loopStats, [], [])
      expect(insights.some(i => i.includes("下降趋势"))).toBe(true)
    })

    test("should identify best source", () => {
      const sourceStats: SourceStats[] = [
        { source: "coverage_gap", totalCards: 20, acceptedCards: 15, acceptanceRate: 0.75 },
        { source: "free_exploration", totalCards: 20, acceptedCards: 5, acceptanceRate: 0.25 }
      ]

      const insights = generateOptimizationInsights(createMinimalDesign(), [], sourceStats, [])
      expect(insights.some(i => i.includes("coverage_gap") && i.includes("75%"))).toBe(true)
    })

    test("should detect critical coverage gaps", () => {
      const coverageGaps: CoverageGap[] = [
        { requirementId: "REQ-1", currentCoverage: 0.2, targetCoverage: 1.0, gap: 0.8, priority: 2.4 }
      ]

      const insights = generateOptimizationInsights(createMinimalDesign(), [], [], coverageGaps)
      expect(insights.some(i => i.includes("覆盖率严重不足"))).toBe(true)
    })

    test("should detect too many cards per loop", () => {
      const loopStats: LoopStats[] = [
        { loopId: "1", status: "completed", cardsProposed: 10, cardsAccepted: 5, cardsRejected: 5, acceptanceRate: 0.5 }
      ]

      const insights = generateOptimizationInsights(createMinimalDesign(), loopStats, [], [])
      expect(insights.some(i => i.includes("卡片数较多"))).toBe(true)
    })

    test("should detect too few cards per loop", () => {
      const loopStats: LoopStats[] = [
        { loopId: "1", status: "completed", cardsProposed: 1, cardsAccepted: 0, cardsRejected: 1, acceptanceRate: 0 }
      ]

      const insights = generateOptimizationInsights(createMinimalDesign(), loopStats, [], [])
      expect(insights.some(i => i.includes("卡片数较少"))).toBe(true)
    })

    test("should return empty array when no insights", () => {
      const loopStats: LoopStats[] = [
        { loopId: "1", status: "completed", cardsProposed: 3, cardsAccepted: 1, cardsRejected: 2, acceptanceRate: 0.33 }
      ]

      const insights = generateOptimizationInsights(createMinimalDesign(), loopStats, [], [])
      expect(insights).toEqual([])
    })

    test("should not report best source when rate is low", () => {
      const sourceStats: SourceStats[] = [
        { source: "coverage_gap", totalCards: 20, acceptedCards: 5, acceptanceRate: 0.25 }
      ]

      const insights = generateOptimizationInsights(createMinimalDesign(), [], sourceStats, [])
      expect(insights.some(i => i.includes("表现最佳"))).toBe(false)
    })
  })
})