/**
 * Prompt Feedback Loop
 *
 * 实现Prompt质量反馈环：
 * 1. 卡片评分 → 聚合为prompt模板评分
 * 2. 使用N次以上的均值作为信号（N ≥ 5）
 * 3. 区分噪音类型：内容噪音、结构噪音、Prompt质量信号
 *
 * 核心原则：
 * - 把"修改"前移到prompt生成阶段
 * - 让执行层永远在第一次、干净的context下工作
 */

import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { PromptTemplate, PromptMetrics } from "./types.js"

export interface FeedbackSignal {
  template_id: string
  timestamp: string
  card_id: string
  loop_id: string
  user_rating: number | null  // 用户评分（如果有）
  acceptance: boolean         // 是否被接受
  execution_success: boolean  // 执行是否成功
  noise_type: NoiseType
}

export type NoiseType = "content" | "structure" | "prompt_quality" | "none"

export interface TemplateQualityScore {
  template_id: string
  sample_count: number
  acceptance_rate: number
  avg_user_rating: number | null
  execution_success_rate: number
  quality_score: number
  last_updated: string
  noise_analysis: {
    content_noise: number
    structure_noise: number
    prompt_quality_signal: number
  }
}

export class PromptFeedbackLoop {
  private cwd: string
  private signals: Map<string, FeedbackSignal[]> = new Map()
  private qualityScores: Map<string, TemplateQualityScore> = new Map()

  constructor(cwd: string) {
    this.cwd = cwd
    this.loadSignals()
  }

  /**
   * 记录反馈信号
   */
  recordSignal(signal: FeedbackSignal): void {
    const signals = this.signals.get(signal.template_id) ?? []
    signals.push(signal)
    this.signals.set(signal.template_id, signals)

    // 保存到磁盘
    this.saveSignal(signal)

    // 更新质量分数
    if (signals.length >= 5) {
      this.updateQualityScore(signal.template_id)
    }
  }

  /**
   * 获取模板质量分数
   */
  getQualityScore(templateId: string): TemplateQualityScore | null {
    return this.qualityScores.get(templateId) ?? null
  }

  /**
   * 获取所有模板的质量分数
   */
  getAllQualityScores(): TemplateQualityScore[] {
    return Array.from(this.qualityScores.values())
  }

  /**
   * 获取需要优化的模板
   */
  getTemplatesNeedingOptimization(threshold: number = 0.6): TemplateQualityScore[] {
    return this.getAllQualityScores()
      .filter((score) => score.sample_count >= 5 && score.quality_score < threshold)
      .sort((a, b) => a.quality_score - b.quality_score)
  }

  /**
   * 更新模板质量分数
   */
  private updateQualityScore(templateId: string): void {
    const signals = this.signals.get(templateId) ?? []
    if (signals.length < 5) return

    // 过滤噪音
    const filteredSignals = this.filterNoise(signals)

    // 计算各项指标
    const acceptanceRate = this.calculateAcceptanceRate(filteredSignals)
    const avgUserRating = this.calculateAvgUserRating(filteredSignals)
    const executionSuccessRate = this.calculateExecutionSuccessRate(filteredSignals)

    // 计算综合质量分数
    const qualityScore = this.calculateQualityScore(
      acceptanceRate,
      avgUserRating,
      executionSuccessRate
    )

    // 噪音分析
    const noiseAnalysis = this.analyzeNoise(signals)

    const score: TemplateQualityScore = {
      template_id: templateId,
      sample_count: signals.length,
      acceptance_rate: acceptanceRate,
      avg_user_rating: avgUserRating,
      execution_success_rate: executionSuccessRate,
      quality_score: qualityScore,
      last_updated: new Date().toISOString(),
      noise_analysis: noiseAnalysis,
    }

    this.qualityScores.set(templateId, score)
    this.saveQualityScore(score)
  }

  /**
   * 过滤噪音
   */
  private filterNoise(signals: FeedbackSignal[]): FeedbackSignal[] {
    return signals.filter((signal) => signal.noise_type !== "content")
  }

  /**
   * 计算接受率
   */
  private calculateAcceptanceRate(signals: FeedbackSignal[]): number {
    if (signals.length === 0) return 0
    const accepted = signals.filter((s) => s.acceptance).length
    return accepted / signals.length
  }

  /**
   * 计算平均用户评分
   */
  private calculateAvgUserRating(signals: FeedbackSignal[]): number | null {
    const ratedSignals = signals.filter((s) => s.user_rating !== null)
    if (ratedSignals.length === 0) return null

    const sum = ratedSignals.reduce((acc, s) => acc + (s.user_rating ?? 0), 0)
    return sum / ratedSignals.length
  }

  /**
   * 计算执行成功率
   */
  private calculateExecutionSuccessRate(signals: FeedbackSignal[]): number {
    if (signals.length === 0) return 0
    const successful = signals.filter((s) => s.execution_success).length
    return successful / signals.length
  }

  /**
   * 计算综合质量分数
   */
  private calculateQualityScore(
    acceptanceRate: number,
    avgUserRating: number | null,
    executionSuccessRate: number
  ): number {
    // 权重配置
    const weights = {
      acceptance: 0.5,
      userRating: 0.3,
      execution: 0.2,
    }

    let score = acceptanceRate * weights.acceptance
    score += executionSuccessRate * weights.execution

    if (avgUserRating !== null) {
      // 假设评分范围是1-5，归一化到0-1
      const normalizedRating = (avgUserRating - 1) / 4
      score += normalizedRating * weights.userRating
    } else {
      // 没有用户评分时，重新分配权重
      score = (acceptanceRate * 0.7 + executionSuccessRate * 0.3)
    }

    return Math.min(1, Math.max(0, score))
  }

  /**
   * 分析噪音类型
   */
  private analyzeNoise(signals: FeedbackSignal[]): {
    content_noise: number
    structure_noise: number
    prompt_quality_signal: number
  } {
    const noiseCounts = {
      content: 0,
      structure: 0,
      prompt_quality: 0,
      none: 0,
    }

    for (const signal of signals) {
      noiseCounts[signal.noise_type]++
    }

    const total = signals.length
    return {
      content_noise: total > 0 ? noiseCounts.content / total : 0,
      structure_noise: total > 0 ? noiseCounts.structure / total : 0,
      prompt_quality_signal: total > 0 ? noiseCounts.prompt_quality / total : 0,
    }
  }

  /**
   * 保存信号到磁盘
   */
  private saveSignal(signal: FeedbackSignal): void {
    const dir = path.join(this.cwd, ".meta", "feedback")
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const filePath = path.join(dir, `signal-${Date.now()}.yaml`)
    fs.writeFileSync(filePath, yaml.dump(signal, { lineWidth: 100 }))
  }

  /**
   * 保存质量分数到磁盘
   */
  private saveQualityScore(score: TemplateQualityScore): void {
    const dir = path.join(this.cwd, ".meta", "feedback")
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const filePath = path.join(dir, `quality-${score.template_id}.yaml`)
    fs.writeFileSync(filePath, yaml.dump(score, { lineWidth: 100 }))
  }

  /**
   * 从磁盘加载信号
   */
  private loadSignals(): void {
    const dir = path.join(this.cwd, ".meta", "feedback")
    if (!fs.existsSync(dir)) return

    const files = fs.readdirSync(dir).filter((f) => f.startsWith("signal-") && f.endsWith(".yaml"))

    for (const file of files) {
      try {
        const filePath = path.join(dir, file)
        const signal = yaml.load(fs.readFileSync(filePath, "utf8")) as FeedbackSignal

        if (signal.template_id) {
          const signals = this.signals.get(signal.template_id) ?? []
          signals.push(signal)
          this.signals.set(signal.template_id, signals)
        }
      } catch {
        // Ignore malformed files
      }
    }

    // 加载质量分数
    const qualityFiles = fs.readdirSync(dir).filter((f) => f.startsWith("quality-") && f.endsWith(".yaml"))
    for (const file of qualityFiles) {
      try {
        const filePath = path.join(dir, file)
        const score = yaml.load(fs.readFileSync(filePath, "utf8")) as TemplateQualityScore

        if (score.template_id) {
          this.qualityScores.set(score.template_id, score)
        }
      } catch {
        // Ignore malformed files
      }
    }
  }

  /**
   * 生成优化建议
   */
  generateOptimizationSuggestions(): string[] {
    const suggestions: string[] = []
    const needsOptimization = this.getTemplatesNeedingOptimization(0.6)

    if (needsOptimization.length === 0) {
      suggestions.push("所有模板质量良好，无需优化")
      return suggestions
    }

    suggestions.push(`发现 ${needsOptimization.length} 个需要优化的模板：`)

    for (const score of needsOptimization) {
      suggestions.push(`\n模板: ${score.template_id}`)
      suggestions.push(`  质量分数: ${(score.quality_score * 100).toFixed(0)}%`)
      suggestions.push(`  接受率: ${(score.acceptance_rate * 100).toFixed(0)}%`)
      suggestions.push(`  执行成功率: ${(score.execution_success_rate * 100).toFixed(0)}%`)

      // 分析主要问题
      if (score.noise_analysis.prompt_quality_signal > 0.3) {
        suggestions.push(`  主要问题: Prompt质量问题 (${(score.noise_analysis.prompt_quality_signal * 100).toFixed(0)}%)`)
      }
      if (score.acceptance_rate < 0.5) {
        suggestions.push(`  主要问题: 接受率过低 (${(score.acceptance_rate * 100).toFixed(0)}%)`)
      }
      if (score.execution_success_rate < 0.7) {
        suggestions.push(`  主要问题: 执行成功率低 (${(score.execution_success_rate * 100).toFixed(0)}%)`)
      }
    }

    return suggestions
  }
}
