/**
 * Prediction Audit Parser
 *
 * 解析prediction-auditor角色的输出
 */

import yaml from "js-yaml"

export interface FactorError {
  eval_id: string
  predicted: string
  actual: string
  error_type: "over_optimistic" | "assumption_failed" | "measurement_mismatch" | "other"
  reason: string
}

export interface PredictionAuditOutput {
  prediction_accuracy: number
  factor_errors: FactorError[]
  lessons: string[]
}

export function parsePredictionAudit(text: string): PredictionAuditOutput {
  const block = text.match(/---AUDIT START---([\s\S]*?)---AUDIT END---/)
  if (!block) {
    throw new Error("No AUDIT block found in output")
  }

  try {
    const parsed = yaml.load(block[1].trim()) as any

    return {
      prediction_accuracy: Number(parsed.prediction_accuracy ?? 0),
      factor_errors: (parsed.factor_errors ?? []).map((e: any) => ({
        eval_id: String(e.eval_id ?? ""),
        predicted: String(e.predicted ?? ""),
        actual: String(e.actual ?? ""),
        error_type: e.error_type ?? "other",
        reason: String(e.reason ?? ""),
      })),
      lessons: parseStringList(parsed.lessons),
    }
  } catch (err) {
    throw new Error(`Failed to parse prediction audit: ${err}`)
  }
}

function parseStringList(val: unknown): string[] {
  if (!val || val === "none") return []
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === "string") return val.split(",").map((s) => s.trim()).filter(Boolean)
  return []
}
