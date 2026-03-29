import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { EvalFactor, MetaDesign, Session } from "./types.js"
import { Dispatcher } from "./agents/dispatcher.js"
import { parseEvalScore } from "./agents/parsers/eval-score.js"
import { MetaPaths, resolveMetaDesignPath, resolveMetaEntryPath } from "./paths.js"

export interface EvalResult {
  factorId: string
  factorName: string
  valueBefore: string
  valueAfter: string
  normalizedScore: number
  passedFloor: boolean
  delta: number
}

export interface EvaluationOutput {
  results: EvalResult[]
  compositeScoreBefore: number
  compositeScoreAfter: number
  compositeDelta: number
  forcedRollback: boolean
  rollbackReason?: string
}

/**
 * 运行单个评估因子
 */
export async function runEvalFactor(
  cwd: string,
  factor: EvalFactor,
  session?: Session
): Promise<EvalResult> {
  const valueBefore = factor.threshold.baseline
  let valueAfter: string
  let normalizedScore: number

  switch (factor.measurement.type) {
    case "metric":
      valueAfter = await runMetricEval(cwd, factor.measurement.spec)
      normalizedScore = calculateNormalizedScore(valueAfter, factor.threshold)
      break

    case "llm_eval":
      valueAfter = await runLlmEval(cwd, factor.measurement, session)
      normalizedScore = calculateNormalizedScore(valueAfter, factor.threshold)
      break

    case "human_eval":
      // 人类评估需要交互，暂时返回 baseline
      valueAfter = valueBefore
      normalizedScore = 0.5
      break

    default:
      valueAfter = valueBefore
      normalizedScore = 0.5
  }

  const passedFloor = checkFloor(valueAfter, factor.threshold.floor)
  const delta = normalizedScore - calculateNormalizedScore(valueBefore, factor.threshold)

  return {
    factorId: factor.id,
    factorName: factor.name,
    valueBefore,
    valueAfter,
    normalizedScore,
    passedFloor,
    delta
  }
}

/**
 * 运行 metric 类型的评估
 */
async function runMetricEval(cwd: string, spec: string): Promise<string> {
  // 尝试运行评估脚本
  if (spec.includes("scripts/") || spec.includes("scripts\\")) {
    const scriptRelPath = spec.split(" ")[0]
    const scriptPath = path.resolve(cwd, scriptRelPath)

    // 安全检查：确保脚本路径在工作目录内
    if (!scriptPath.startsWith(path.resolve(cwd))) {
      console.warn(`[Evaluator] Script path outside working directory: ${scriptRelPath}`)
      return "0"
    }

    if (!fs.existsSync(scriptPath)) {
      console.warn(`[Evaluator] Script not found: ${scriptPath}`)
      return "0"
    }

    try {
      // 使用异步执行，避免阻塞事件循环
      const proc = Bun.spawn(["bun", scriptPath], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      })

      // 设置超时
      const timeoutMs = 30000
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          proc.kill()
          reject(new Error(`Script execution timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      })

      const outputPromise = (async () => {
        const output = await new Response(proc.stdout).text()
        const exitCode = await proc.exited
        if (exitCode !== 0) {
          const stderr = await new Response(proc.stderr).text()
          throw new Error(`Script exited with code ${exitCode}: ${stderr}`)
        }
        return output.trim()
      })()

      return await Promise.race([outputPromise, timeoutPromise])
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.warn(`[Evaluator] Failed to run metric script: ${spec}`, errorMsg)
      return "0"
    }
  }

  // 默认返回 baseline
  return "0"
}

/**
 * 运行 LLM 类型的评估
 */
async function runLlmEval(cwd: string, measurement: any, session?: Session): Promise<string> {
  if (!measurement.llm_prompt) {
    console.warn("[Evaluator] No llm_prompt provided for llm_eval")
    return measurement.llm_scale?.includes("1-5") ? "3.5" : "0"
  }

  if (!session?.prompt) {
    console.warn("[Evaluator] No session available for llm_eval")
    return measurement.llm_scale?.includes("1-5") ? "3.5" : "0"
  }

  try {
    // 使用 dispatcher 调用 eval-scorer 角色
    const dispatcher = new Dispatcher({ cwd, session })
    const result = await dispatcher.dispatch<{ score: number }>(
      "eval-scorer",
      {
        prompt: measurement.llm_prompt,
        scale: measurement.llm_scale || "1-5",
        output: "Current implementation output",
      },
      "evaluation"
    )

    if (result && typeof result.score === "number") {
      return String(result.score)
    }
  } catch (error) {
    console.warn("[Evaluator] Dispatcher call failed, falling back to direct call:", error)
  }

  // 回退到直接调用
  try {
    const prompt = measurement.llm_prompt.replace("{output}", "Current implementation output")
    const response = await session.prompt({
      system: "You are an evaluation agent. Score the given output based on the criteria.",
      message: prompt,
    })

    const text = extractText(response)
    const score = extractScoreFromResponse(text, measurement.llm_scale)

    if (score !== null) {
      return String(score)
    }

    console.warn("[Evaluator] Could not extract score from LLM response")
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.warn("[Evaluator] LLM evaluation failed:", errorMsg)
  }

  // 默认返回中等分数
  return measurement.llm_scale?.includes("1-5") ? "3.5" : "0"
}

function extractText(response: unknown): string {
  if (typeof response === "string") return response
  const value = response as any
  if (typeof value?.text === "string") return value.text
  if (Array.isArray(value?.content)) return value.content.map((part: any) => part?.text ?? "").join("\n")
  return String(response)
}

function extractScoreFromResponse(text: string, scale?: string): number | null {
  // 尝试从响应中提取分数
  const patterns = [
    /score[:\s]*(\d+\.?\d*)/i,
    /(\d+\.?\d*)\s*\/\s*\d+/,
    /(\d+\.?\d*)\s*out\s*of\s*\d+/i,
    /^(\d+\.?\d*)$/m,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const score = parseFloat(match[1])
      if (!isNaN(score)) {
        // 根据scale规范化分数
        if (scale?.includes("1-5")) {
          return Math.min(5, Math.max(1, score))
        }
        return score
      }
    }
  }

  return null
}

/**
 * 计算标准化分数
 */
function calculateNormalizedScore(value: string, threshold: any): number {
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
 * 解析数值
 */
function parseNumericValue(value: string): number {
  const cleaned = value.replace(/[^0-9.\-]/g, "")
  return parseFloat(cleaned)
}

/**
 * 检查是否达到 floor
 */
function checkFloor(value: string, floor: string): boolean {
  const numericValue = parseNumericValue(value)
  const floorValue = parseNumericValue(floor)

  if (isNaN(numericValue) || isNaN(floorValue)) {
    return true
  }

  // 检查是否满足 floor 条件
  if (floor.includes("<")) {
    return numericValue < floorValue
  } else if (floor.includes(">")) {
    return numericValue > floorValue
  } else if (floor.includes("≥")) {
    return numericValue >= floorValue
  } else if (floor.includes("≤")) {
    return numericValue <= floorValue
  } else {
    return numericValue >= floorValue
  }
}

/**
 * 计算综合分数
 */
function calculateCompositeScore(
  design: MetaDesign,
  results: EvalResult[]
): number {
  const factors = design.eval_factors ?? []
  let totalWeight = 0
  let weightedSum = 0

  for (const factor of factors) {
    if (factor.role.type === "guardrail" || factor.role.type === "diagnostic") {
      continue
    }

    const weight = factor.relations?.weight ?? 0.5
    const result = results.find(r => r.factorId === factor.id)
    const score = result?.normalizedScore ?? 0.5

    weightedSum += score * weight
    totalWeight += weight
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0
}

/**
 * 运行所有评估
 */
export async function runEvaluation(
  cwd: string,
  design: MetaDesign,
  session?: Session
): Promise<EvaluationOutput> {
  const factors = design.eval_factors ?? []
  const results: EvalResult[] = []

  for (const factor of factors) {
    // 检查因子是否激活
    if (factor.lifecycle?.active_until) {
      const currentStage = design.project.stage
      if (currentStage === factor.lifecycle.active_until) {
        continue
      }
    }

    const result = await runEvalFactor(cwd, factor, session)
    results.push(result)
  }

  // 计算综合分数
  const compositeScoreBefore = calculateCompositeScore(design, results.map(r => ({
    ...r,
    normalizedScore: calculateNormalizedScore(r.valueBefore, 
      factors.find(f => f.id === r.factorId)?.threshold ?? { target: "0", floor: "0", baseline: "0" })
  })))
  
  const compositeScoreAfter = calculateCompositeScore(design, results)
  const compositeDelta = compositeScoreAfter - compositeScoreBefore

  // 检查是否需要强制回滚
  const forcedRollback = results.some(r => !r.passedFloor)
  const rollbackReason = forcedRollback 
    ? `Floor breached: ${results.filter(r => !r.passedFloor).map(r => r.factorName).join(", ")}`
    : undefined

  return {
    results,
    compositeScoreBefore,
    compositeScoreAfter,
    compositeDelta,
    forcedRollback,
    rollbackReason
  }
}

/**
 * 更新卡片的 outcome
 */
export async function updateCardOutcome(
  cwd: string,
  cardId: string,
  evaluation: EvaluationOutput
): Promise<void> {
  const cardPath = resolveMetaEntryPath(cwd, "cards", `${cardId}.yaml`)
  
  if (!fs.existsSync(cardPath)) {
    throw new Error(`Card not found: ${cardId}`)
  }

  const card = yaml.load(fs.readFileSync(cardPath, "utf8")) as any

  // 更新 outcome
  card.outcome = {
    status: evaluation.forcedRollback ? "rolled_back" : "success",
    actual_eval_deltas: evaluation.results.map(r => ({
      eval_id: r.factorId,
      before: r.valueBefore,
      after: r.valueAfter,
      delta: r.delta >= 0 ? `+${r.delta.toFixed(2)}` : r.delta.toFixed(2)
    })),
    prediction_accuracy: calculatePredictionAccuracy(card, evaluation.results),
    deviation_explanation: evaluation.forcedRollback ? evaluation.rollbackReason : "",
    lessons: [],
    constraint_breaches: [],
    committed_at: new Date().toISOString()
  }

  fs.writeFileSync(cardPath, yaml.dump(card, { lineWidth: 100 }))
}

/**
 * 计算预测准确度
 */
function calculatePredictionAccuracy(card: any, results: EvalResult[]): number {
  if (!card.prediction?.eval_deltas?.length) {
    return 0
  }

  let totalAccuracy = 0
  let count = 0

  for (const predicted of card.prediction.eval_deltas) {
    const actual = results.find(r => r.factorId === predicted.eval_id)
    
    if (!actual) continue

    const predictedMagnitude = parseMagnitude(predicted.magnitude)
    const actualMagnitude = actual.delta

    if (isNaN(predictedMagnitude)) continue

    const error = Math.abs(predictedMagnitude - actualMagnitude)
    const maxError = Math.abs(predictedMagnitude) || 1
    const accuracy = Math.max(0, 1 - error / maxError)

    totalAccuracy += accuracy
    count++
  }

  return count > 0 ? totalAccuracy / count : 0
}

/**
 * 解析幅度
 */
function parseMagnitude(magnitude: string): number {
  const match = magnitude.match(/([+-]?\d+\.?\d*)/g)
  
  if (!match || match.length === 0) {
    return NaN
  }

  const values = match.map(v => parseFloat(v))
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * 更新 design.yaml 的 baseline
 */
export async function updateBaselines(
  cwd: string,
  results: EvalResult[]
): Promise<void> {
  const designPath = resolveMetaDesignPath(cwd)
  
  if (!fs.existsSync(designPath)) {
    throw new Error("design.yaml not found")
  }

  const design = yaml.load(fs.readFileSync(designPath, "utf8")) as any
  const factors = design.eval_factors ?? []

  for (const result of results) {
    const factor = factors.find((f: any) => f.id === result.factorId)
    
    if (factor) {
      factor.threshold.baseline = result.valueAfter
    }
  }

  design.updated_at = new Date().toISOString()
  fs.writeFileSync(designPath, yaml.dump(design, { lineWidth: 100 }))
}

/**
 * 生成评估报告
 */
export function generateEvaluationReport(output: EvaluationOutput): string {
  const lines: string[] = []
  
  lines.push("# Evaluation Report")
  lines.push("")
  lines.push(`## Summary`)
  lines.push(`- Composite Score: ${output.compositeScoreBefore.toFixed(2)} → ${output.compositeScoreAfter.toFixed(2)}`)
  lines.push(`- Delta: ${output.compositeDelta >= 0 ? "+" : ""}${output.compositeDelta.toFixed(2)}`)
  lines.push(`- Status: ${output.forcedRollback ? "ROLLED BACK" : "PASSED"}`)
  
  if (output.rollbackReason) {
    lines.push(`- Rollback Reason: ${output.rollbackReason}`)
  }
  
  lines.push("")
  lines.push("## Factor Results")
  lines.push("")
  
  for (const result of output.results) {
    const status = result.passedFloor ? "✓" : "✗"
    const deltaStr = result.delta >= 0 ? `+${result.delta.toFixed(2)}` : result.delta.toFixed(2)
    
    lines.push(`### ${status} ${result.factorName} (${result.factorId})`)
    lines.push(`- Before: ${result.valueBefore}`)
    lines.push(`- After: ${result.valueAfter}`)
    lines.push(`- Score: ${result.normalizedScore.toFixed(2)}`)
    lines.push(`- Delta: ${deltaStr}`)
    lines.push(`- Floor: ${result.passedFloor ? "Passed" : "FAILED"}`)
    lines.push("")
  }
  
  return lines.join("\n")
}

/**
 * 保存评估报告到文件
 */
export async function saveEvaluationReport(
  cwd: string,
  loopId: string,
  output: EvaluationOutput
): Promise<string> {
  const reportDir = MetaPaths.reports(cwd)
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true })
  }
  
  const report = generateEvaluationReport(output)
  const reportPath = path.join(reportDir, `eval-${loopId}.md`)
  fs.writeFileSync(reportPath, report)
  
  return reportPath
}
