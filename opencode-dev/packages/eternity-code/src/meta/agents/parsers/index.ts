/**
 * Parser Registry
 *
 * 管理所有输出解析器的注册和获取
 */

import { parseCardReview } from "./card-review.js"
import { parseCoverage } from "./coverage.js"
import { parsePlan } from "./plan.js"
import { parseEvalScore } from "./eval-score.js"
import { parsePredictionAudit } from "./prediction-audit.js"
import { parseInsight } from "./insight.js"
import { parseRestructurePlan } from "./restructure-plan.js"
import { parseContractDraft } from "./contract-draft.js"
import { parseContractValidation } from "./contract-validation.js"

const parsers: Record<string, (text: string) => unknown> = {
  "card-review": parseCardReview,
  coverage: parseCoverage,
  plan: parsePlan,
  "eval-score": parseEvalScore,
  "prediction-audit": parsePredictionAudit,
  insight: parseInsight,
  "restructure-plan": parseRestructurePlan,
  "contract-draft": parseContractDraft,
  "contract-validation": parseContractValidation,
}

export function getParser(id: string): (text: string) => unknown {
  const p = parsers[id]
  if (!p) throw new Error(`Unknown parser: ${id}`)
  return p
}
