/**
 * TrustChain - 信任链验证器
 *
 * 验证证据链的完整性和一致性，检测异常行为。
 * 基于 arXiv:2606.04990 的信任验证理论。
 *
 * 功能：
 * - 验证证据链的完整性（无断裂）
 * - 验证证据链的一致性（时间顺序、因果关系）
 * - 检测异常行为（低置信度、异常时间间隔）
 * - 计算信任分数
 */

import type { ProvenanceEntry, EvidenceSource } from "../types.js"
import { createLogger } from "./logger.js"

/**
 * 信任链验证配置
 */
export interface TrustChainConfig {
  /** 最小置信度阈值（低于此值视为异常） */
  minConfidenceThreshold?: number
  /** 最大时间间隔（毫秒，超过此值视为异常间隔） */
  maxTimeIntervalMs?: number
  /** 最小时间间隔（毫秒，低于此值视为异常间隔） */
  minTimeIntervalMs?: number
  /** 最大链长度（超过此值视为异常） */
  maxChainLength?: number
  /** 是否启用深度验证 */
  enableDeepValidation?: boolean
}

/**
 * 验证严重级别
 */
export type ValidationSeverity = "info" | "warning" | "error" | "critical"

/**
 * 验证问题
 */
export interface ValidationIssue {
  /** 问题类型 */
  type: string
  /** 严重级别 */
  severity: ValidationSeverity
  /** 问题描述 */
  message: string
  /** 相关证据 ID */
  evidenceId?: string
  /** 相关条目 ID */
  entryId?: string
  /** 附加元数据 */
  metadata?: Record<string, unknown>
}

/**
 * 信任链验证结果
 */
export interface TrustChainValidationResult {
  /** 是否通过验证 */
  isValid: boolean
  /** 信任分数 (0.0-1.0) */
  trustScore: number
  /** 验证问题列表 */
  issues: ValidationIssue[]
  /** 链长度 */
  chainLength: number
  /** 验证时间戳 */
  validatedAt: string
  /** 验证统计 */
  stats: {
    totalEntries: number
    validEntries: number
    invalidEntries: number
    averageConfidence: number
    timeSpanMs: number
  }
}

/**
 * 异常检测结果
 */
export interface AnomalyDetectionResult {
  /** 是否检测到异常 */
  hasAnomalies: boolean
  /** 异常列表 */
  anomalies: ValidationIssue[]
  /** 异常分数 (0.0-1.0, 越高越异常) */
  anomalyScore: number
}

/**
 * 信任链验证器
 *
 * 验证证据链的完整性和一致性，检测异常行为。
 */
export class TrustChain {
  private readonly config: Required<TrustChainConfig>
  private logger = createLogger("trust-chain")

  constructor(config: TrustChainConfig = {}) {
    this.config = {
      minConfidenceThreshold: config.minConfidenceThreshold ?? 0.3,
      maxTimeIntervalMs: config.maxTimeIntervalMs ?? 300000, // 5 分钟
      minTimeIntervalMs: config.minTimeIntervalMs ?? 100, // 100 毫秒
      maxChainLength: config.maxChainLength ?? 100,
      enableDeepValidation: config.enableDeepValidation ?? true,
    }
  }

  /**
   * 验证证据链
   *
   * @param entries 证据条目列表
   * @returns 验证结果
   */
  validate(entries: ProvenanceEntry[]): TrustChainValidationResult {
    const issues: ValidationIssue[] = []
    const validatedAt = new Date().toISOString()

    // 1. 验证基本完整性
    const integrityIssues = this.validateIntegrity(entries)
    issues.push(...integrityIssues)

    // 2. 验证一致性
    const consistencyIssues = this.validateConsistency(entries)
    issues.push(...consistencyIssues)

    // 3. 检测异常
    const anomalyResult = this.detectAnomalies(entries)
    issues.push(...anomalyResult.anomalies)

    // 4. 深度验证（如果启用）
    if (this.config.enableDeepValidation) {
      const deepIssues = this.validateDeep(entries)
      issues.push(...deepIssues)
    }

    // 5. 计算统计信息
    const stats = this.calculateStats(entries)

    // 6. 计算信任分数
    const trustScore = this.calculateTrustScore(entries, issues)

    // 7. 判断是否通过验证
    const criticalIssues = issues.filter(i => i.severity === "critical")
    const errorIssues = issues.filter(i => i.severity === "error")
    const isValid = criticalIssues.length === 0 && errorIssues.length === 0

    return {
      isValid,
      trustScore,
      issues,
      chainLength: entries.length,
      validatedAt,
      stats,
    }
  }

  /**
   * 验证单个证据链（从指定证据追溯到根）
   *
   * @param entries 所有证据条目
   * @param startEvidenceId 起始证据 ID
   * @returns 验证结果
   */
  validateChain(entries: ProvenanceEntry[], startEvidenceId: string): TrustChainValidationResult {
    // 构建证据链
    const chain = this.buildChain(entries, startEvidenceId)
    return this.validate(chain)
  }

  /**
   * 构建证据链（从指定证据追溯到根）
   */
  private buildChain(entries: ProvenanceEntry[], startEvidenceId: string): ProvenanceEntry[] {
    const chain: ProvenanceEntry[] = []
    const visited = new Set<string>()
    let currentId: string | undefined = startEvidenceId

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const entry = entries.find(e => e.evidence.id === currentId)
      if (!entry) break

      chain.unshift(entry)
      currentId = entry.parentEvidenceId
    }

    return chain
  }

  /**
   * 验证完整性
   */
  private validateIntegrity(entries: ProvenanceEntry[]): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    // 检查空链
    if (entries.length === 0) {
      issues.push({
        type: "empty_chain",
        severity: "warning",
        message: "证据链为空",
      })
      return issues
    }

    // 检查链长度
    if (entries.length > this.config.maxChainLength) {
      issues.push({
        type: "chain_too_long",
        severity: "warning",
        message: `证据链过长: ${entries.length} > ${this.config.maxChainLength}`,
      })
    }

    // 检查父级引用完整性
    for (const entry of entries) {
      if (entry.parentEvidenceId) {
        const parentExists = entries.some(e => e.evidence.id === entry.parentEvidenceId)
        if (!parentExists) {
          issues.push({
            type: "broken_parent_reference",
            severity: "error",
            message: `父级证据引用断裂: ${entry.parentEvidenceId}`,
            evidenceId: entry.evidence.id,
            entryId: entry.id,
          })
        }
      }
    }

    // 检查子级引用完整性
    for (const entry of entries) {
      if (entry.childEvidenceIds && entry.childEvidenceIds.length > 0) {
        for (const childId of entry.childEvidenceIds) {
          const childExists = entries.some(e => e.evidence.id === childId)
          if (!childExists) {
            issues.push({
              type: "broken_child_reference",
              severity: "warning",
              message: `子级证据引用断裂: ${childId}`,
              evidenceId: entry.evidence.id,
              entryId: entry.id,
            })
          }
        }
      }
    }

    // 检查证据 ID 唯一性
    const evidenceIds = new Set<string>()
    for (const entry of entries) {
      if (evidenceIds.has(entry.evidence.id)) {
        issues.push({
          type: "duplicate_evidence_id",
          severity: "error",
          message: `重复的证据 ID: ${entry.evidence.id}`,
          evidenceId: entry.evidence.id,
          entryId: entry.id,
        })
      }
      evidenceIds.add(entry.evidence.id)
    }

    // 检查条目 ID 唯一性
    const entryIds = new Set<string>()
    for (const entry of entries) {
      if (entryIds.has(entry.id)) {
        issues.push({
          type: "duplicate_entry_id",
          severity: "error",
          message: `重复的条目 ID: ${entry.id}`,
          entryId: entry.id,
        })
      }
      entryIds.add(entry.id)
    }

    return issues
  }

  /**
   * 验证一致性
   */
  private validateConsistency(entries: ProvenanceEntry[]): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    // 检查时间顺序
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]
      const curr = entries[i]

      const prevTime = new Date(prev.createdAt).getTime()
      const currTime = new Date(curr.createdAt).getTime()

      if (currTime < prevTime) {
        issues.push({
          type: "time_order_violation",
          severity: "error",
          message: `时间顺序违反: 条目 ${curr.id} 早于前一条目 ${prev.id}`,
          evidenceId: curr.evidence.id,
          entryId: curr.id,
          metadata: {
            prevTime: prev.createdAt,
            currTime: curr.createdAt,
          },
        })
      }
    }

    // 检查时间间隔
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]
      const curr = entries[i]

      const prevTime = new Date(prev.createdAt).getTime()
      const currTime = new Date(curr.createdAt).getTime()
      const interval = currTime - prevTime

      if (interval < this.config.minTimeIntervalMs) {
        issues.push({
          type: "suspicious_short_interval",
          severity: "warning",
          message: `异常短时间间隔: ${interval}ms < ${this.config.minTimeIntervalMs}ms`,
          evidenceId: curr.evidence.id,
          entryId: curr.id,
          metadata: { intervalMs: interval },
        })
      }

      if (interval > this.config.maxTimeIntervalMs) {
        issues.push({
          type: "suspicious_long_interval",
          severity: "info",
          message: `异常长时间间隔: ${interval}ms > ${this.config.maxTimeIntervalMs}ms`,
          evidenceId: curr.evidence.id,
          entryId: curr.id,
          metadata: { intervalMs: interval },
        })
      }
    }

    // 检查代理 ID 一致性
    const agentIds = new Set(entries.map(e => e.agentId))
    if (agentIds.size > 1) {
      // 多个代理是正常的，但记录下来
      issues.push({
        type: "multiple_agents",
        severity: "info",
        message: `证据链涉及多个代理: ${Array.from(agentIds).join(", ")}`,
        metadata: { agentIds: Array.from(agentIds) },
      })
    }

    // 检查任务 ID 一致性
    const taskIds = new Set(entries.map(e => e.taskId))
    if (taskIds.size > 1) {
      issues.push({
        type: "multiple_tasks",
        severity: "warning",
        message: `证据链涉及多个任务: ${Array.from(taskIds).join(", ")}`,
        metadata: { taskIds: Array.from(taskIds) },
      })
    }

    return issues
  }

  /**
   * 检测异常
   */
  detectAnomalies(entries: ProvenanceEntry[]): AnomalyDetectionResult {
    const anomalies: ValidationIssue[] = []

    // 检测低置信度证据
    for (const entry of entries) {
      if (entry.evidence.confidence < this.config.minConfidenceThreshold) {
        anomalies.push({
          type: "low_confidence",
          severity: "warning",
          message: `低置信度证据: ${entry.evidence.confidence.toFixed(2)} < ${this.config.minConfidenceThreshold}`,
          evidenceId: entry.evidence.id,
          entryId: entry.id,
          metadata: { confidence: entry.evidence.confidence },
        })
      }
    }

    // 检测异常证据类型分布
    const typeDistribution = this.calculateTypeDistribution(entries)
    const typeAnomalies = this.detectTypeDistributionAnomalies(typeDistribution, entries.length)
    anomalies.push(...typeAnomalies)

    // 检测异常时间模式
    const timeAnomalies = this.detectTimePatternAnomalies(entries)
    anomalies.push(...timeAnomalies)

    // 计算异常分数
    const anomalyScore = anomalies.length > 0
      ? Math.min(1, anomalies.length / entries.length)
      : 0

    return {
      hasAnomalies: anomalies.length > 0,
      anomalies,
      anomalyScore,
    }
  }

  /**
   * 深度验证
   */
  private validateDeep(entries: ProvenanceEntry[]): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    // 验证证据内容完整性
    for (const entry of entries) {
      if (!entry.evidence.content) {
        issues.push({
          type: "missing_content",
          severity: "error",
          message: "证据内容缺失",
          evidenceId: entry.evidence.id,
          entryId: entry.id,
        })
      }

      // 检查内容大小
      const contentSize = JSON.stringify(entry.evidence.content).length
      if (contentSize > 10000) {
        issues.push({
          type: "large_content",
          severity: "warning",
          message: `证据内容过大: ${contentSize} 字节`,
          evidenceId: entry.evidence.id,
          entryId: entry.id,
          metadata: { contentSize },
        })
      }
    }

    // 验证证据类型与内容的一致性
    for (const entry of entries) {
      const typeIssues = this.validateEvidenceTypeConsistency(entry)
      issues.push(...typeIssues)
    }

    return issues
  }

  /**
   * 验证证据类型与内容的一致性
   */
  private validateEvidenceTypeConsistency(entry: ProvenanceEntry): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const { evidence } = entry

    if (typeof evidence.content !== "object" || evidence.content === null) {
      return issues
    }

    const content = evidence.content as Record<string, unknown>

    switch (evidence.type) {
      case "llm_call":
        if (!content.prompt && !content.response) {
          issues.push({
            type: "inconsistent_type_content",
            severity: "warning",
            message: "LLM 调用证据缺少 prompt 或 response",
            evidenceId: evidence.id,
            entryId: entry.id,
          })
        }
        break

      case "file_modification":
        if (!content.filePath && !content.diff) {
          issues.push({
            type: "inconsistent_type_content",
            severity: "warning",
            message: "文件修改证据缺少 filePath 或 diff",
            evidenceId: evidence.id,
            entryId: entry.id,
          })
        }
        break

      case "tool_invocation":
        if (!content.toolName) {
          issues.push({
            type: "inconsistent_type_content",
            severity: "warning",
            message: "工具调用证据缺少 toolName",
            evidenceId: evidence.id,
            entryId: entry.id,
          })
        }
        break

      case "system_decision":
        if (!content.decision && !content.reason) {
          issues.push({
            type: "inconsistent_type_content",
            severity: "warning",
            message: "系统决策证据缺少 decision 或 reason",
            evidenceId: evidence.id,
            entryId: entry.id,
          })
        }
        break
    }

    return issues
  }

  /**
   * 计算类型分布
   */
  private calculateTypeDistribution(entries: ProvenanceEntry[]): Map<string, number> {
    const distribution = new Map<string, number>()

    for (const entry of entries) {
      const type = entry.evidence.type
      distribution.set(type, (distribution.get(type) ?? 0) + 1)
    }

    return distribution
  }

  /**
   * 检测类型分布异常
   */
  private detectTypeDistributionAnomalies(
    distribution: Map<string, number>,
    totalEntries: number,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    // 检查是否有某种类型占比过高
    for (const [type, count] of Array.from(distribution.entries())) {
      const ratio = count / totalEntries
      if (ratio > 0.8) {
        issues.push({
          type: "type_dominance",
          severity: "warning",
          message: `证据类型 "${type}" 占比过高: ${(ratio * 100).toFixed(1)}%`,
          metadata: { type, count, ratio },
        })
      }
    }

    return issues
  }

  /**
   * 检测时间模式异常
   */
  private detectTimePatternAnomalies(entries: ProvenanceEntry[]): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    if (entries.length < 3) {
      return issues
    }

    // 计算时间间隔的标准差
    const intervals: number[] = []
    for (let i = 1; i < entries.length; i++) {
      const prevTime = new Date(entries[i - 1].createdAt).getTime()
      const currTime = new Date(entries[i].createdAt).getTime()
      intervals.push(currTime - prevTime)
    }

    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const variance = intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length
    const stdDev = Math.sqrt(variance)

    // 检测异常间隔（超过 3 个标准差）
    for (let i = 0; i < intervals.length; i++) {
      if (Math.abs(intervals[i] - mean) > 3 * stdDev) {
        issues.push({
          type: "anomalous_time_pattern",
          severity: "warning",
          message: `异常时间模式: 间隔 ${intervals[i]}ms 偏离均值 ${mean.toFixed(0)}ms 超过 3 个标准差`,
          evidenceId: entries[i + 1].evidence.id,
          entryId: entries[i + 1].id,
          metadata: {
            interval: intervals[i],
            mean,
            stdDev,
            deviations: Math.abs(intervals[i] - mean) / stdDev,
          },
        })
      }
    }

    return issues
  }

  /**
   * 计算统计信息
   */
  private calculateStats(entries: ProvenanceEntry[]): TrustChainValidationResult["stats"] {
    if (entries.length === 0) {
      return {
        totalEntries: 0,
        validEntries: 0,
        invalidEntries: 0,
        averageConfidence: 0,
        timeSpanMs: 0,
      }
    }

    const confidences = entries.map(e => e.evidence.confidence)
    const averageConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length

    const times = entries.map(e => new Date(e.createdAt).getTime())
    const timeSpanMs = Math.max(...times) - Math.min(...times)

    // 统计有效条目（置信度 >= 阈值）
    const validEntries = entries.filter(e => e.evidence.confidence >= this.config.minConfidenceThreshold).length

    return {
      totalEntries: entries.length,
      validEntries,
      invalidEntries: entries.length - validEntries,
      averageConfidence,
      timeSpanMs,
    }
  }

  /**
   * 计算信任分数
   */
  private calculateTrustScore(entries: ProvenanceEntry[], issues: ValidationIssue[]): number {
    if (entries.length === 0) {
      return 0
    }

    let score = 1.0

    // 根据问题严重级别扣分
    for (const issue of issues) {
      switch (issue.severity) {
        case "critical":
          score -= 0.3
          break
        case "error":
          score -= 0.15
          break
        case "warning":
          score -= 0.05
          break
        case "info":
          score -= 0.01
          break
      }
    }

    // 根据平均置信度调整
    const avgConfidence = entries.reduce((a, b) => a + b.evidence.confidence, 0) / entries.length
    score *= avgConfidence

    // 根据链长度调整（过长的链可能不可靠）
    if (entries.length > this.config.maxChainLength * 0.8) {
      score *= 0.9
    }

    return Math.max(0, Math.min(1, score))
  }

  /**
   * 获取信任链摘要
   */
  getSummary(result: TrustChainValidationResult): string {
    const lines: string[] = []

    lines.push(`# 信任链验证摘要`)
    lines.push(``)
    lines.push(`- **验证状态**: ${result.isValid ? "✅ 通过" : "❌ 未通过"}`)
    lines.push(`- **信任分数**: ${(result.trustScore * 100).toFixed(1)}%`)
    lines.push(`- **链长度**: ${result.chainLength}`)
    lines.push(`- **验证时间**: ${result.validatedAt}`)
    lines.push(``)

    lines.push(`## 统计信息`)
    lines.push(``)
    lines.push(`- **总条目数**: ${result.stats.totalEntries}`)
    lines.push(`- **有效条目数**: ${result.stats.validEntries}`)
    lines.push(`- **无效条目数**: ${result.stats.invalidEntries}`)
    lines.push(`- **平均置信度**: ${(result.stats.averageConfidence * 100).toFixed(1)}%`)
    lines.push(`- **时间跨度**: ${this.formatDuration(result.stats.timeSpanMs)}`)
    lines.push(``)

    if (result.issues.length > 0) {
      lines.push(`## 验证问题 (${result.issues.length})`)
      lines.push(``)

      const groupedIssues = this.groupIssuesBySeverity(result.issues)
      for (const [severity, issues] of Object.entries(groupedIssues)) {
        if (issues.length > 0) {
          lines.push(`### ${this.getSeverityEmoji(severity)} ${severity.toUpperCase()} (${issues.length})`)
          lines.push(``)
          for (const issue of issues) {
            lines.push(`- ${issue.message}`)
            if (issue.evidenceId) {
              lines.push(`  - 证据 ID: ${issue.evidenceId}`)
            }
          }
          lines.push(``)
        }
      }
    }

    return lines.join("\n")
  }

  /**
   * 按严重级别分组问题
   */
  private groupIssuesBySeverity(issues: ValidationIssue[]): Record<string, ValidationIssue[]> {
    const grouped: Record<string, ValidationIssue[]> = {
      critical: [],
      error: [],
      warning: [],
      info: [],
    }

    for (const issue of issues) {
      grouped[issue.severity].push(issue)
    }

    return grouped
  }

  /**
   * 获取严重级别表情符号
   */
  private getSeverityEmoji(severity: string): string {
    switch (severity) {
      case "critical": return "🔴"
      case "error": return "🟠"
      case "warning": return "🟡"
      case "info": return "🔵"
      default: return "⚪"
    }
  }

  /**
   * 格式化持续时间
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`
  }
}

/**
 * 创建默认信任链验证器
 */
export function createTrustChain(config?: TrustChainConfig): TrustChain {
  return new TrustChain(config)
}

/**
 * 快速验证证据链
 */
export function validateTrustChain(
  entries: ProvenanceEntry[],
  config?: TrustChainConfig,
): TrustChainValidationResult {
  const chain = new TrustChain(config)
  return chain.validate(entries)
}
