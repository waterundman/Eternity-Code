/**
 * Eval Score Parser
 *
 * 解析eval-scorer角色的输出
 * 支持真实工具调用的结果解析
 */

import yaml from "js-yaml"

export interface EvalScoreOutput {
  factor_id?: string
  command_run?: string
  raw_output?: string
  measured_value?: number | string
  passed_floor?: boolean
  // 兼容旧格式
  score?: number
}

export function parseEvalScore(text: string): EvalScoreOutput {
  // 尝试解析新的 EVAL 块格式
  const block = text.match(/---EVAL START---([\s\S]*?)---EVAL END---/)
  if (block) {
    try {
      const parsed = yaml.load(block[1].trim()) as any
      return {
        factor_id: parsed.factor_id,
        command_run: parsed.command_run,
        raw_output: parsed.raw_output,
        measured_value: parsed.measured_value,
        passed_floor: parsed.passed_floor === true || parsed.passed_floor === "true",
      }
    } catch {
      // 解析失败，尝试旧格式
    }
  }

  // 尝试提取数字（兼容旧格式）
  const patterns = [
    /score[:\s]*(\d+\.?\d*)/i,
    /^(\d+\.?\d*)$/m,
    /(\d+\.?\d*)/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const score = parseFloat(match[1])
      if (!isNaN(score)) {
        return { score }
      }
    }
  }

  // 默认返回中间分数
  return { score: 3 }
}
