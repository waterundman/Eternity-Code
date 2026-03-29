/**
 * Card Review Parser
 *
 * 解析card-reviewer角色的输出
 * 支持四维 Rubric 加权评分
 */

import yaml from "js-yaml"

export interface CardReviewOutput {
  // 四维评分
  req_alignment_score: number
  req_alignment_reason: string
  neg_conflict_score: number
  neg_conflict_reason: string
  cost_honesty_score: number
  cost_honesty_reason: string
  feasibility_score: number
  feasibility_reason: string
  // 加权总分
  weighted_score: number
  // 审查备注
  reviewer_note: string
  // 兼容旧格式
  alignment_score?: number
  feasibility_score_legacy?: number
  risk_score?: number
  confidence_calibration?: "over" | "fair" | "under"
  hidden_risks?: string[]
  neg_conflicts?: string[]
}

export function parseCardReview(text: string): CardReviewOutput {
  const block = text.match(/---REVIEW START---([\s\S]*?)---REVIEW END---/)
  if (!block) {
    throw new Error("No REVIEW block found in output")
  }

  try {
    const parsed = yaml.load(block[1].trim()) as any

    // 解析四维评分
    const reqAlignment = Number(parsed.req_alignment_score ?? 5)
    const negConflict = Number(parsed.neg_conflict_score ?? 5)
    const costHonesty = Number(parsed.cost_honesty_score ?? 5)
    const feasibility = Number(parsed.feasibility_score ?? 5)

    // 计算加权总分（如果解析器中没有提供）
    const weightedScore = parsed.weighted_score
      ? Number(parsed.weighted_score)
      : reqAlignment * 0.35 + negConflict * 0.30 + costHonesty * 0.20 + feasibility * 0.15

    return {
      req_alignment_score: reqAlignment,
      req_alignment_reason: String(parsed.req_alignment_reason ?? ""),
      neg_conflict_score: negConflict,
      neg_conflict_reason: String(parsed.neg_conflict_reason ?? ""),
      cost_honesty_score: costHonesty,
      cost_honesty_reason: String(parsed.cost_honesty_reason ?? ""),
      feasibility_score: feasibility,
      feasibility_reason: String(parsed.feasibility_reason ?? ""),
      weighted_score: Math.round(weightedScore * 100) / 100,
      reviewer_note: String(parsed.reviewer_note ?? ""),
      // 兼容旧格式
      alignment_score: reqAlignment,
      feasibility_score_legacy: feasibility,
      risk_score: Number(parsed.risk_score ?? 5),
      confidence_calibration: parsed.confidence_calibration ?? "fair",
      hidden_risks: parseStringList(parsed.hidden_risks),
      neg_conflicts: parseStringList(parsed.neg_conflicts),
    }
  } catch (err) {
    throw new Error(`Failed to parse card review: ${err}`)
  }
}

function parseStringList(val: unknown): string[] {
  if (!val || val === "none") return []
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === "string") return val.split(",").map((s) => s.trim()).filter(Boolean)
  return []
}
