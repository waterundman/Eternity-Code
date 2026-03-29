/**
 * Prompt Meta Layer
 *
 * 负责生成子prompt，内化甜点密度原则
 *
 * 核心原则：
 * 1. 核心任务用1-2句话说清楚
 * 2. 约束只写影响输出质量的必要项
 * 3. 给模型留出填充细节的自由度
 * 4. 输出格式只规定结构，不规定措辞
 */

import type { AgentRole } from "../agents/types.js"
import type { PromptMetaConfig, PromptTemplate } from "./types.js"
import { DEFAULT_PROMPT_CONFIG } from "./index.js"

export class PromptMeta {
  private config: PromptMetaConfig
  private templates: Map<string, PromptTemplate> = new Map()

  constructor(config: Partial<PromptMetaConfig> = {}) {
    this.config = { ...DEFAULT_PROMPT_CONFIG, ...config }
  }

  /**
   * 生成子prompt
   *
   * 根据角色定义和上下文，生成优化后的prompt
   */
  generatePrompt(role: AgentRole, context: string, input: Record<string, unknown>): string {
    // 1. 构建基础prompt
    const basePrompt = this.buildBasePrompt(role, context)

    // 2. 构建user message
    const userMessage = this.buildUserMessage(input, role.output_format)

    // 3. 应用甜点密度原则
    const optimizedPrompt = this.applySweetSpotPrinciple(basePrompt)

    // 4. 返回完整prompt
    return `${optimizedPrompt}\n\n${userMessage}`
  }

  /**
   * 构建基础prompt
   */
  private buildBasePrompt(role: AgentRole, context: string): string {
    const parts: string[] = []

    // 添加MetaDesign上下文（如果有）
    if (context) {
      parts.push(context)
    }

    // 添加角色系统prompt
    parts.push(role.system_prompt)

    // 添加输出格式要求
    if (role.output_format) {
      parts.push(`\nOutput format:\n${role.output_format}`)
    }

    return parts.join("\n\n")
  }

  /**
   * 构建user message
   */
  private buildUserMessage(input: Record<string, unknown>, outputFormat: string): string {
    const inputSection = Object.entries(input)
      .map(([k, v]) => {
        if (typeof v === "string") {
          return `${k}:\n${v}`
        }
        return `${k}:\n${JSON.stringify(v, null, 2)}`
      })
      .join("\n\n")

    return inputSection
  }

  /**
   * 应用甜点密度原则
   *
   * 甜点区间：核心任务清晰 + 必要约束 + 足够留白
   */
  private applySweetSpotPrinciple(prompt: string): string {
    // 计算当前密度
    const metrics = this.calculateMetrics(prompt)

    // 如果密度适中，直接返回
    if (metrics.density_score <= this.config.density_threshold) {
      return prompt
    }

    // 否则进行优化
    const lines = prompt.split("\n")
    const optimizedLines: string[] = []

    for (const line of lines) {
      // 跳过空行（保留一个）
      if (line.trim() === "") {
        if (optimizedLines.length > 0 && optimizedLines[optimizedLines.length - 1].trim() !== "") {
          optimizedLines.push("")
        }
        continue
      }

      // 检查是否是核心意图行
      if (this.isCoreIntent(line)) {
        optimizedLines.push(line)
        continue
      }

      // 检查是否是必要约束
      if (this.isNecessaryConstraint(line)) {
        optimizedLines.push(line)
        continue
      }

      // 检查是否是留白字段
      if (this.isFreeformField(line)) {
        optimizedLines.push(line)
        continue
      }

      // 其他行，根据密度决定是否保留
      const currentDensity = this.calculateMetrics(optimizedLines.join("\n")).density_score
      if (currentDensity < this.config.density_threshold * 0.8) {
        optimizedLines.push(line)
      }
    }

    return optimizedLines.join("\n")
  }

  /**
   * 检查是否是核心意图行
   */
  private isCoreIntent(line: string): boolean {
    const trimmed = line.trim().toLowerCase()
    return (
      trimmed.startsWith("you are") ||
      trimmed.startsWith("your task") ||
      trimmed.startsWith("your job") ||
      trimmed.startsWith("objective") ||
      trimmed.startsWith("goal") ||
      trimmed.startsWith("任务") ||
      trimmed.startsWith("目标")
    )
  }

  /**
   * 检查是否是必要约束
   */
  private isNecessaryConstraint(line: string): boolean {
    const trimmed = line.trim().toLowerCase()
    return (
      trimmed.startsWith("rules:") ||
      trimmed.startsWith("constraints:") ||
      trimmed.startsWith("must") ||
      trimmed.startsWith("must not") ||
      trimmed.startsWith("do not") ||
      trimmed.startsWith("don't") ||
      trimmed.startsWith("never") ||
      trimmed.startsWith("always") ||
      trimmed.startsWith("规则") ||
      trimmed.startsWith("约束")
    )
  }

  /**
   * 检查是否是留白字段
   */
  private isFreeformField(line: string): boolean {
    const trimmed = line.trim().toLowerCase()
    for (const field of this.config.freeform_fields) {
      if (trimmed.startsWith(field.toLowerCase())) {
        return true
      }
    }
    return false
  }

  /**
   * 计算prompt指标
   */
  calculateMetrics(prompt: string): import("./types.js").PromptMetrics {
    const tokens = this.estimateTokenCount(prompt)
    const intents = this.countIntents(prompt)
    const conflicts = this.detectConflicts(prompt)

    return {
      original_token_count: tokens,
      optimized_token_count: tokens,
      intent_count: intents,
      density_score: intents > 0 ? tokens / intents : 0,
      conflict_count: conflicts.length,
      pruned_count: 0,
    }
  }

  /**
   * 估算token数量（简化实现）
   */
  private estimateTokenCount(text: string): number {
    // 简化：按单词数的1.3倍估算
    const words = text.split(/\s+/).length
    return Math.ceil(words * 1.3)
  }

  /**
   * 计算意图数量
   */
  private countIntents(text: string): number {
    const lines = text.split("\n")
    let count = 0

    for (const line of lines) {
      if (this.isCoreIntent(line)) {
        count++
      }
    }

    return Math.max(1, count)
  }

  /**
   * 检测冲突
   */
  detectConflicts(prompt: string): import("./types.js").ConflictPair[] {
    const conflicts: import("./types.js").ConflictPair[] = []
    const lowerPrompt = prompt.toLowerCase()

    for (const pair of this.config.conflict_pairs) {
      const [first, second] = pair.keywords
      if (lowerPrompt.includes(first) && lowerPrompt.includes(second)) {
        conflicts.push(pair)
      }
    }

    return conflicts
  }

  /**
   * 注册prompt模板
   */
  registerTemplate(template: PromptTemplate): void {
    this.templates.set(template.id, template)
  }

  /**
   * 获取prompt模板
   */
  getTemplate(id: string): PromptTemplate | undefined {
    return this.templates.get(id)
  }

  /**
   * 列出所有模板
   */
  listTemplates(): PromptTemplate[] {
    return Array.from(this.templates.values())
  }

  /**
   * 更新模板质量分数
   */
  updateTemplateScore(id: string, score: number): void {
    const template = this.templates.get(id)
    if (template) {
      template.quality_score = score
      template.usage_count++
      template.last_used = new Date().toISOString()
    }
  }
}
