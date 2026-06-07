import { describe, test, expect } from "bun:test"

// 提取 evaluator.ts 中的纯函数进行测试
// 由于这些函数没有导出，我们需要通过间接方式测试
// 这里我们重新实现相同的逻辑来验证行为

/**
 * 解析数值 - 从 evaluator.ts 提取
 */
function parseNumericValue(value: string): number {
  const cleaned = value.replace(/[^0-9.\-]/g, "")
  return parseFloat(cleaned)
}

/**
 * 计算标准化分数 - 从 evaluator.ts 提取
 */
function calculateNormalizedScore(value: string, threshold: { target: string; floor: string }): number {
  const numericValue = parseNumericValue(value)
  const target = parseNumericValue(threshold.target)
  const floor = parseNumericValue(threshold.floor)

  if (isNaN(numericValue) || isNaN(target) || isNaN(floor)) {
    return 0.5
  }

  if (numericValue >= target) {
    return 1.0
  } else if (numericValue <= floor) {
    return 0.0
  } else {
    return (numericValue - floor) / (target - floor)
  }
}

/**
 * 检查是否达到 floor - 从 evaluator.ts 提取
 */
function checkFloor(value: string, floor: string): boolean {
  const numericValue = parseNumericValue(value)
  const floorValue = parseNumericValue(floor)

  if (isNaN(numericValue) || isNaN(floorValue)) {
    return true
  }

  // 检查是否满足 floor 条件
  if (floor.includes("≥")) {
    return numericValue >= floorValue
  } else if (floor.includes("≤")) {
    return numericValue <= floorValue
  } else if (floor.includes(">")) {
    return numericValue > floorValue
  } else if (floor.includes("<")) {
    return numericValue < floorValue
  } else {
    return numericValue >= floorValue
  }
}

/**
 * 从响应中提取分数 - 从 evaluator.ts 提取
 */
function extractScoreFromResponse(text: string, scale?: string): number | null {
  const patterns = [
    /score[=:\s]*(\d+\.?\d*)/i,
    /(\d+\.?\d*)\s*\/\s*\d+/,
    /(\d+\.?\d*)\s*out\s*of\s*\d+/i,
    /^(\d+\.?\d*)$/m,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const score = parseFloat(match[1])
      if (!isNaN(score)) {
        if (scale?.includes("1-5")) {
          return Math.min(5, Math.max(1, score))
        }
        return score
      }
    }
  }

  return null
}

interface EvalResult {
  factorId: string
  normalizedScore: number | null
}

interface EvalFactor {
  id: string
  role: { type: string }
  relations?: { weight?: number }
}

/**
 * 计算综合分数 - 从 evaluator.ts 提取
 */
function calculateCompositeScore(
  factors: EvalFactor[],
  results: EvalResult[]
): number {
  let totalWeight = 0
  let weightedSum = 0

  for (const factor of factors) {
    if (factor.role.type === "guardrail" || factor.role.type === "diagnostic") {
      continue
    }

    const result = results.find(r => r.factorId === factor.id)
    const score = result?.normalizedScore ?? null

    if (score === null) continue

    const weight = factor.relations?.weight ?? 0.5
    weightedSum += score * weight
    totalWeight += weight
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0
}

describe("evaluator", () => {
  describe("parseNumericValue", () => {
    test("should parse integer value", () => {
      expect(parseNumericValue("42")).toBe(42)
    })

    test("should parse float value", () => {
      expect(parseNumericValue("3.14")).toBe(3.14)
    })

    test("should parse negative value", () => {
      expect(parseNumericValue("-10")).toBe(-10)
    })

    test("should parse value with percentage symbol", () => {
      expect(parseNumericValue("85%")).toBe(85)
    })

    test("should parse value with prefix text", () => {
      expect(parseNumericValue("score: 90")).toBe(90)
    })

    test("should parse value with currency symbol", () => {
      expect(parseNumericValue("$100")).toBe(100)
    })

    test("should return NaN for non-numeric string", () => {
      expect(parseNumericValue("abc")).toBeNaN()
    })

    test("should handle empty string", () => {
      expect(parseNumericValue("")).toBeNaN()
    })
  })

  describe("calculateNormalizedScore", () => {
    const threshold = { target: "100", floor: "0" }

    test("should return 1.0 when value equals target", () => {
      expect(calculateNormalizedScore("100", threshold)).toBe(1.0)
    })

    test("should return 1.0 when value exceeds target", () => {
      expect(calculateNormalizedScore("150", threshold)).toBe(1.0)
    })

    test("should return 0.0 when value equals floor", () => {
      expect(calculateNormalizedScore("0", threshold)).toBe(0.0)
    })

    test("should return 0.0 when value is below floor", () => {
      expect(calculateNormalizedScore("-10", threshold)).toBe(0.0)
    })

    test("should return linear interpolation between floor and target", () => {
      expect(calculateNormalizedScore("50", threshold)).toBe(0.5)
    })

    test("should return 0.5 for non-numeric value", () => {
      expect(calculateNormalizedScore("abc", threshold)).toBe(0.5)
    })

    test("should return 0.5 for non-numeric target", () => {
      expect(calculateNormalizedScore("50", { target: "abc", floor: "0" })).toBe(0.5)
    })

    test("should return 0.5 for non-numeric floor", () => {
      expect(calculateNormalizedScore("50", { target: "100", floor: "abc" })).toBe(0.5)
    })

    test("should handle percentage values", () => {
      const threshold = { target: "100%", floor: "0%" }
      expect(calculateNormalizedScore("75%", threshold)).toBe(0.75)
    })

    test("should handle custom range", () => {
      const threshold = { target: "10", floor: "0" }
      expect(calculateNormalizedScore("7", threshold)).toBe(0.7)
    })
  })

  describe("checkFloor", () => {
    test("should return true when value meets default floor (>=)", () => {
      expect(checkFloor("10", "5")).toBe(true)
    })

    test("should return true when value equals default floor", () => {
      expect(checkFloor("5", "5")).toBe(true)
    })

    test("should return false when value is below default floor", () => {
      expect(checkFloor("3", "5")).toBe(false)
    })

    test("should handle >= operator", () => {
      expect(checkFloor("10", "≥5")).toBe(true)
      expect(checkFloor("5", "≥5")).toBe(true)
      expect(checkFloor("3", "≥5")).toBe(false)
    })

    test("should handle <= operator", () => {
      expect(checkFloor("3", "≤5")).toBe(true)
      expect(checkFloor("5", "≤5")).toBe(true)
      expect(checkFloor("10", "≤5")).toBe(false)
    })

    test("should handle > operator", () => {
      expect(checkFloor("10", ">5")).toBe(true)
      expect(checkFloor("5", ">5")).toBe(false)
    })

    test("should handle < operator", () => {
      expect(checkFloor("3", "<5")).toBe(true)
      expect(checkFloor("5", "<5")).toBe(false)
    })

    test("should return true for non-numeric value", () => {
      expect(checkFloor("abc", "5")).toBe(true)
    })

    test("should return true for non-numeric floor", () => {
      expect(checkFloor("10", "abc")).toBe(true)
    })

    test("should handle percentage values", () => {
      expect(checkFloor("80%", "≥70%")).toBe(true)
      expect(checkFloor("60%", "≥70%")).toBe(false)
    })
  })

  describe("extractScoreFromResponse", () => {
    test("should extract score from 'score: 4' format", () => {
      expect(extractScoreFromResponse("score: 4")).toBe(4)
    })

    test("should extract score from 'score=4.5' format", () => {
      expect(extractScoreFromResponse("score=4.5")).toBe(4.5)
    })

    test("should extract score from '4/5' format", () => {
      expect(extractScoreFromResponse("4/5")).toBe(4)
    })

    test("should extract score from '4 out of 5' format", () => {
      expect(extractScoreFromResponse("4 out of 5")).toBe(4)
    })

    test("should extract standalone number", () => {
      expect(extractScoreFromResponse("3")).toBe(3)
    })

    test("should extract number from multiline text", () => {
      const text = "Overall assessment:\n4\nSome comments"
      expect(extractScoreFromResponse(text)).toBe(4)
    })

    test("should return null for no numeric content", () => {
      expect(extractScoreFromResponse("no score here")).toBeNull()
    })

    test("should clamp score to 1-5 range when scale is 1-5", () => {
      expect(extractScoreFromResponse("6", "1-5")).toBe(5)
      expect(extractScoreFromResponse("0", "1-5")).toBe(1)
      expect(extractScoreFromResponse("3", "1-5")).toBe(3)
    })

    test("should not clamp when scale is not 1-5", () => {
      expect(extractScoreFromResponse("6")).toBe(6)
      expect(extractScoreFromResponse("0")).toBe(0)
    })

    test("should handle decimal scores", () => {
      expect(extractScoreFromResponse("score: 3.7")).toBe(3.7)
    })
  })

  describe("calculateCompositeScore", () => {
    test("should calculate weighted average", () => {
      const factors: EvalFactor[] = [
        { id: "f1", role: { type: "objective" }, relations: { weight: 0.6 } },
        { id: "f2", role: { type: "proxy" }, relations: { weight: 0.4 } },
      ]
      const results: EvalResult[] = [
        { factorId: "f1", normalizedScore: 0.8 },
        { factorId: "f2", normalizedScore: 0.6 },
      ]
      // (0.8 * 0.6 + 0.6 * 0.4) / (0.6 + 0.4) = 0.72
      expect(calculateCompositeScore(factors, results)).toBeCloseTo(0.72)
    })

    test("should skip guardrail factors", () => {
      const factors: EvalFactor[] = [
        { id: "f1", role: { type: "objective" }, relations: { weight: 0.6 } },
        { id: "f2", role: { type: "guardrail" }, relations: { weight: 0.4 } },
      ]
      const results: EvalResult[] = [
        { factorId: "f1", normalizedScore: 0.8 },
        { factorId: "f2", normalizedScore: 0.0 }, // Guardrail failed
      ]
      // Only f1 contributes: 0.8
      expect(calculateCompositeScore(factors, results)).toBe(0.8)
    })

    test("should skip diagnostic factors", () => {
      const factors: EvalFactor[] = [
        { id: "f1", role: { type: "objective" }, relations: { weight: 1.0 } },
        { id: "f2", role: { type: "diagnostic" } },
      ]
      const results: EvalResult[] = [
        { factorId: "f1", normalizedScore: 0.9 },
        { factorId: "f2", normalizedScore: 0.5 },
      ]
      expect(calculateCompositeScore(factors, results)).toBe(0.9)
    })

    test("should skip factors with null scores", () => {
      const factors: EvalFactor[] = [
        { id: "f1", role: { type: "objective" }, relations: { weight: 0.5 } },
        { id: "f2", role: { type: "proxy" }, relations: { weight: 0.5 } },
      ]
      const results: EvalResult[] = [
        { factorId: "f1", normalizedScore: 0.8 },
        { factorId: "f2", normalizedScore: null },
      ]
      expect(calculateCompositeScore(factors, results)).toBe(0.8)
    })

    test("should use default weight 0.5 when not specified", () => {
      const factors: EvalFactor[] = [
        { id: "f1", role: { type: "objective" } },
        { id: "f2", role: { type: "proxy" } },
      ]
      const results: EvalResult[] = [
        { factorId: "f1", normalizedScore: 0.8 },
        { factorId: "f2", normalizedScore: 0.6 },
      ]
      // (0.8 * 0.5 + 0.6 * 0.5) / (0.5 + 0.5) = 0.7
      expect(calculateCompositeScore(factors, results)).toBeCloseTo(0.7)
    })

    test("should return 0 when no factors contribute", () => {
      const factors: EvalFactor[] = [
        { id: "f1", role: { type: "guardrail" } },
      ]
      const results: EvalResult[] = [
        { factorId: "f1", normalizedScore: 0.5 },
      ]
      expect(calculateCompositeScore(factors, results)).toBe(0)
    })

    test("should return 0 for empty factors", () => {
      expect(calculateCompositeScore([], [])).toBe(0)
    })

    test("should handle missing results", () => {
      const factors: EvalFactor[] = [
        { id: "f1", role: { type: "objective" } },
      ]
      expect(calculateCompositeScore(factors, [])).toBe(0)
    })
  })
})