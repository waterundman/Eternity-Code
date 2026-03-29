/**
 * Prompt Optimizer
 *
 * 优化Pass实现，负责：
 * 1. 剪枝冗余约束
 * 2. 检测指令冲突
 * 3. 输出标准化
 *
 * 核心原则：
 * - 把"修改"前移到prompt生成阶段
 * - 让执行层永远在第一次、干净的context下工作
 */

import type {
  PromptMetaConfig,
  PromptOptimizationResult,
  PromptChange,
  PromptMetrics,
} from "./types.js"

// 语义相似度阈值
const SIMILARITY_THRESHOLD = 0.8

export class PromptOptimizer {
  private config: PromptMetaConfig

  constructor(config: PromptMetaConfig) {
    this.config = config
  }

  /**
   * 优化prompt
   */
  optimize(prompt: string): PromptOptimizationResult {
    const originalMetrics = this.calculateMetrics(prompt)
    const changes: PromptChange[] = []

    // 1. 检测并解决冲突
    let optimized = this.resolveConflicts(prompt, changes)

    // 2. 剪枝冗余约束
    optimized = this.pruneRedundancy(optimized, changes)

    // 3. 添加必要留白
    optimized = this.addWhitespace(optimized, changes)

    // 4. 标准化输出
    optimized = this.standardize(optimized, changes)

    const optimizedMetrics = this.calculateMetrics(optimized)

    return {
      original_prompt: prompt,
      optimized_prompt: optimized,
      changes,
      metrics: {
        ...optimizedMetrics,
        original_token_count: originalMetrics.original_token_count,
        pruned_count: originalMetrics.original_token_count - optimizedMetrics.optimized_token_count,
      },
    }
  }

  /**
   * 解决冲突
   */
  private resolveConflicts(prompt: string, changes: PromptChange[]): string {
    const lines = prompt.split("\n")
    const result: string[] = []
    const processedPairs = new Set<string>()

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      let shouldKeep = true

      for (const pair of this.config.conflict_pairs) {
        const pairKey = pair.keywords.join(",")
        if (processedPairs.has(pairKey)) continue

        const [first, second] = pair.keywords
        const lineLower = line.toLowerCase()

        if (lineLower.includes(first)) {
          // 找到第一个关键词，检查后续行是否有第二个关键词
          for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
            if (lines[j].toLowerCase().includes(second)) {
              // 发现冲突
              changes.push({
                type: "conflict_resolved",
                location: `lines ${i + 1}-${j + 1}`,
                description: `Resolved conflict between "${first}" and "${second}"`,
                before: `${line}\n${lines[j]}`,
                after: pair.priority === "first" ? line : lines[j],
              })

              // 根据优先级决定保留哪个
              if (pair.priority === "second") {
                shouldKeep = false
              }
              processedPairs.add(pairKey)
              break
            }
          }
        }
      }

      if (shouldKeep) {
        result.push(line)
      }
    }

    return result.join("\n")
  }

  /**
   * 剪枝冗余约束
   */
  private pruneRedundancy(prompt: string, changes: PromptChange[]): string {
    const lines = prompt.split("\n")
    const result: string[] = []
    const seenSemantics = new Set<string>()

    for (const line of lines) {
      const trimmed = line.trim()

      // 跳过空行
      if (trimmed === "") {
        result.push(line)
        continue
      }

      // 检查是否是白名单字段
      if (this.isWhitelistField(trimmed)) {
        result.push(line)
        continue
      }

      // 检查语义相似度
      const semantic = this.extractSemantic(trimmed)
      if (semantic && seenSemantics.has(semantic)) {
        // 发现冗余
        changes.push({
          type: "prune",
          location: `line containing "${trimmed.substring(0, 30)}..."`,
          description: "Pruned redundant constraint",
          before: trimmed,
        })
        continue
      }

      if (semantic) {
        seenSemantics.add(semantic)
      }

      result.push(line)
    }

    return result.join("\n")
  }

  /**
   * 检查是否是白名单字段
   */
  private isWhitelistField(line: string): boolean {
    const lineLower = line.toLowerCase()
    for (const field of this.config.whitelist_fields) {
      if (lineLower.startsWith(field.toLowerCase())) {
        return true
      }
    }
    return false
  }

  /**
   * 提取语义（简化实现）
   */
  private extractSemantic(line: string): string | null {
    // 简化：提取关键词作为语义标识
    const words = line
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5)
      .sort()
      .join(",")

    return words.length > 0 ? words : null
  }

  /**
   * 添加必要留白
   */
  private addWhitespace(prompt: string, changes: PromptChange[]): string {
    const lines = prompt.split("\n")
    const result: string[] = []

    for (let i = 0; i < lines.length; i++) {
      result.push(lines[i])

      // 在主要部分之间添加空行
      if (
        i < lines.length - 1 &&
        lines[i].trim() !== "" &&
        lines[i + 1].trim() !== "" &&
        this.isMajorSection(lines[i]) &&
        this.isMajorSection(lines[i + 1])
      ) {
        result.push("")
        changes.push({
          type: "whitespace_added",
          location: `after line ${i + 1}`,
          description: "Added whitespace between major sections",
        })
      }
    }

    return result.join("\n")
  }

  /**
   * 检查是否是主要部分
   */
  private isMajorSection(line: string): boolean {
    const trimmed = line.trim()
    return (
      trimmed.startsWith("#") ||
      trimmed.startsWith("===") ||
      trimmed.endsWith(":") ||
      trimmed.startsWith("You are") ||
      trimmed.startsWith("Your task") ||
      trimmed.startsWith("Rules:") ||
      trimmed.startsWith("Output format:")
    )
  }

  /**
   * 标准化输出
   */
  private standardize(prompt: string, changes: PromptChange[]): string {
    let result = prompt

    // 1. 规范化空行（最多连续两个空行）
    result = result.replace(/\n{3,}/g, "\n\n")

    // 2. 规范化列表符号
    result = result.replace(/^[\-\*]\s+/gm, "- ")

    // 3. 规范化缩进
    result = result.replace(/^( {2,})/gm, "  ")

    // 4. 移除尾部空白
    result = result.trim()

    return result
  }

  /**
   * 计算prompt指标
   */
  calculateMetrics(prompt: string): PromptMetrics {
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
   * 估算token数量
   */
  private estimateTokenCount(text: string): number {
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
      const trimmed = line.trim().toLowerCase()
      if (
        trimmed.startsWith("you are") ||
        trimmed.startsWith("your task") ||
        trimmed.startsWith("your job") ||
        trimmed.startsWith("rules:") ||
        trimmed.startsWith("constraints:") ||
        trimmed.startsWith("output format:")
      ) {
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
   * 批量优化多个prompt
   */
  batchOptimize(prompts: string[]): PromptOptimizationResult[] {
    return prompts.map((prompt) => this.optimize(prompt))
  }

  /**
   * 分析prompt质量
   */
  analyzeQuality(prompt: string): {
    score: number
    issues: string[]
    suggestions: string[]
  } {
    const issues: string[] = []
    const suggestions: string[] = []
    let score = 100

    const metrics = this.calculateMetrics(prompt)

    // 检查密度
    if (metrics.density_score > this.config.density_threshold) {
      issues.push(`Prompt too dense (${metrics.density_score.toFixed(1)} > ${this.config.density_threshold})`)
      suggestions.push("Reduce redundant constraints and allow more freedom for the model")
      score -= 20
    }

    // 检查冲突
    if (metrics.conflict_count > 0) {
      issues.push(`Found ${metrics.conflict_count} potential conflicts`)
      suggestions.push("Resolve conflicting instructions")
      score -= 10 * metrics.conflict_count
    }

    // 检查长度
    if (metrics.original_token_count > this.config.max_tokens) {
      issues.push(`Prompt too long (${metrics.original_token_count} tokens > ${this.config.max_tokens})`)
      suggestions.push("Shorten the prompt by removing non-essential content")
      score -= 15
    }

    // 检查意图数量
    if (metrics.intent_count < this.config.min_intents) {
      issues.push(`Too few intents (${metrics.intent_count} < ${this.config.min_intents})`)
      suggestions.push("Clarify the core task of the prompt")
      score -= 10
    }

    return {
      score: Math.max(0, score),
      issues,
      suggestions,
    }
  }
}
