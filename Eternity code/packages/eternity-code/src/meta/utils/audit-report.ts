/**
 * AuditReport - 溯源审计报告生成器
 *
 * 生成人类可读的溯源审计报告，支持 Markdown 格式。
 * 基于 ProvenanceTracker 的证据数据。
 *
 * 功能：
 * - 生成完整的溯源审计报告
 * - 支持 Markdown 格式输出
 * - 包含信任链验证结果
 * - 支持按任务、代理、时间范围过滤
 */

import { promises as fs } from "node:fs"
import * as path from "node:path"
import type { ProvenanceEntry, EvidenceSource } from "../types.js"
import { TrustChain, type TrustChainValidationResult, type TrustChainConfig } from "./trust-chain.js"
import { createLogger } from "./logger.js"

/**
 * 审计报告配置
 */
export interface AuditReportConfig {
  /** 工作目录 */
  cwd: string
  /** 报告标题 */
  title?: string
  /** 是否包含详细证据内容 */
  includeEvidenceDetails?: boolean
  /** 是否包含信任链验证 */
  includeTrustChainValidation?: boolean
  /** 信任链配置 */
  trustChainConfig?: TrustChainConfig
  /** 最大证据条目数（0 表示无限制） */
  maxEntries?: number
  /** 是否包含统计信息 */
  includeStats?: boolean
  /** 是否包含时间线 */
  includeTimeline?: boolean
}

/**
 * 审计报告过滤器
 */
export interface AuditReportFilter {
  /** 按任务 ID 过滤 */
  taskIds?: string[]
  /** 按代理 ID 过滤 */
  agentIds?: string[]
  /** 按证据类型过滤 */
  evidenceTypes?: string[]
  /** 按时间范围过滤 */
  timeRange?: {
    start?: string
    end?: string
  }
  /** 按置信度过滤 */
  confidenceRange?: {
    min?: number
    max?: number
  }
}

/**
 * 审计报告数据
 */
export interface AuditReportData {
  /** 报告 ID */
  id: string
  /** 报告标题 */
  title: string
  /** 生成时间 */
  generatedAt: string
  /** Loop ID */
  loopId?: string
  /** 证据条目 */
  entries: ProvenanceEntry[]
  /** 信任链验证结果 */
  trustChainResult?: TrustChainValidationResult
  /** 统计信息 */
  stats: AuditReportStats
  /** 时间线 */
  timeline?: TimelineEntry[]
}

/**
 * 审计报告统计信息
 */
export interface AuditReportStats {
  /** 总证据数 */
  totalEvidence: number
  /** 按类型分布 */
  byType: Record<string, number>
  /** 按代理分布 */
  byAgent: Record<string, number>
  /** 按任务分布 */
  byTask: Record<string, number>
  /** 平均置信度 */
  averageConfidence: number
  /** 时间跨度 */
  timeSpan: {
    start: string
    end: string
    durationMs: number
  }
}

/**
 * 时间线条目
 */
export interface TimelineEntry {
  /** 时间戳 */
  timestamp: string
  /** 事件类型 */
  type: string
  /** 事件描述 */
  description: string
  /** 相关证据 ID */
  evidenceId?: string
  /** 相关代理 ID */
  agentId?: string
  /** 相关任务 ID */
  taskId?: string
  /** 置信度 */
  confidence?: number
}

/**
 * 溯源审计报告生成器
 *
 * 生成人类可读的溯源审计报告。
 */
export class AuditReportGenerator {
  private readonly config: Required<AuditReportConfig>
  private readonly trustChain: TrustChain
  private logger = createLogger("audit-report")

  constructor(config: AuditReportConfig) {
    this.config = {
      cwd: config.cwd,
      title: config.title ?? "溯源审计报告",
      includeEvidenceDetails: config.includeEvidenceDetails ?? true,
      includeTrustChainValidation: config.includeTrustChainValidation ?? true,
      trustChainConfig: config.trustChainConfig ?? {},
      maxEntries: config.maxEntries ?? 0,
      includeStats: config.includeStats ?? true,
      includeTimeline: config.includeTimeline ?? true,
    }

    this.trustChain = new TrustChain(this.config.trustChainConfig)
  }

  /**
   * 生成审计报告
   *
   * @param entries 证据条目
   * @param filter 过滤器
   * @param loopId Loop ID（可选）
   * @returns 审计报告数据
   */
  generate(
    entries: ProvenanceEntry[],
    filter?: AuditReportFilter,
    loopId?: string,
  ): AuditReportData {
    // 应用过滤器
    let filteredEntries = this.applyFilter(entries, filter)

    // 限制条目数
    if (this.config.maxEntries > 0 && filteredEntries.length > this.config.maxEntries) {
      filteredEntries = filteredEntries.slice(-this.config.maxEntries)
    }

    // 生成统计信息
    const stats = this.calculateStats(filteredEntries)

    // 生成时间线
    const timeline = this.config.includeTimeline
      ? this.generateTimeline(filteredEntries)
      : undefined

    // 运行信任链验证
    let trustChainResult: TrustChainValidationResult | undefined
    if (this.config.includeTrustChainValidation) {
      trustChainResult = this.trustChain.validate(filteredEntries)
    }

    return {
      id: `audit-${Date.now().toString(36)}`,
      title: this.config.title,
      generatedAt: new Date().toISOString(),
      loopId,
      entries: filteredEntries,
      trustChainResult,
      stats,
      timeline,
    }
  }

  /**
   * 生成 Markdown 格式的报告
   *
   * @param data 审计报告数据
   * @returns Markdown 字符串
   */
  toMarkdown(data: AuditReportData): string {
    const lines: string[] = []

    // 标题
    lines.push(`# ${data.title}`)
    lines.push(``)
    lines.push(`**报告 ID**: ${data.id}`)
    lines.push(`**生成时间**: ${data.generatedAt}`)
    if (data.loopId) {
      lines.push(`**Loop ID**: ${data.loopId}`)
    }
    lines.push(``)

    // 目录
    lines.push(`## 目录`)
    lines.push(``)
    lines.push(`1. [概览](#概览)`)
    if (data.trustChainResult) {
      lines.push(`2. [信任链验证](#信任链验证)`)
    }
    if (this.config.includeStats) {
      lines.push(`3. [统计信息](#统计信息)`)
    }
    if (this.config.includeTimeline && data.timeline) {
      lines.push(`4. [时间线](#时间线)`)
    }
    if (this.config.includeEvidenceDetails) {
      lines.push(`5. [证据详情](#证据详情)`)
    }
    lines.push(``)

    // 概览
    lines.push(`## 概览`)
    lines.push(``)
    lines.push(`本报告包含 ${data.entries.length} 条证据记录，涵盖以下类型：`)
    lines.push(``)
    for (const [type, count] of Object.entries(data.stats.byType)) {
      lines.push(`- **${this.formatEvidenceType(type)}**: ${count} 条`)
    }
    lines.push(``)

    // 信任链验证
    if (data.trustChainResult) {
      lines.push(`## 信任链验证`)
      lines.push(``)
      lines.push(this.trustChain.getSummary(data.trustChainResult))
      lines.push(``)
    }

    // 统计信息
    if (this.config.includeStats) {
      lines.push(`## 统计信息`)
      lines.push(``)
      lines.push(`### 证据分布`)
      lines.push(``)
      lines.push(`| 类型 | 数量 | 占比 |`)
      lines.push(`|------|------|------|`)
      for (const [type, count] of Object.entries(data.stats.byType)) {
        const percentage = ((count / data.stats.totalEvidence) * 100).toFixed(1)
        lines.push(`| ${this.formatEvidenceType(type)} | ${count} | ${percentage}% |`)
      }
      lines.push(``)

      lines.push(`### 代理分布`)
      lines.push(``)
      lines.push(`| 代理 | 数量 | 占比 |`)
      lines.push(`|------|------|------|`)
      for (const [agent, count] of Object.entries(data.stats.byAgent)) {
        const percentage = ((count / data.stats.totalEvidence) * 100).toFixed(1)
        lines.push(`| ${agent} | ${count} | ${percentage}% |`)
      }
      lines.push(``)

      lines.push(`### 任务分布`)
      lines.push(``)
      lines.push(`| 任务 | 数量 | 占比 |`)
      lines.push(`|------|------|------|`)
      for (const [task, count] of Object.entries(data.stats.byTask)) {
        const percentage = ((count / data.stats.totalEvidence) * 100).toFixed(1)
        lines.push(`| ${task} | ${count} | ${percentage}% |`)
      }
      lines.push(``)

      lines.push(`### 置信度统计`)
      lines.push(``)
      lines.push(`- **平均置信度**: ${(data.stats.averageConfidence * 100).toFixed(1)}%`)
      lines.push(``)

      lines.push(`### 时间统计`)
      lines.push(``)
      lines.push(`- **开始时间**: ${data.stats.timeSpan.start}`)
      lines.push(`- **结束时间**: ${data.stats.timeSpan.end}`)
      lines.push(`- **持续时间**: ${this.formatDuration(data.stats.timeSpan.durationMs)}`)
      lines.push(``)
    }

    // 时间线
    if (this.config.includeTimeline && data.timeline && data.timeline.length > 0) {
      lines.push(`## 时间线`)
      lines.push(``)
      lines.push(`| 时间 | 类型 | 描述 | 代理 | 任务 | 置信度 |`)
      lines.push(`|------|------|------|------|------|--------|`)
      for (const entry of data.timeline) {
        const time = new Date(entry.timestamp).toLocaleTimeString()
        const confidence = entry.confidence !== undefined
          ? `${(entry.confidence * 100).toFixed(0)}%`
          : "-"
        lines.push(`| ${time} | ${this.formatEvidenceType(entry.type)} | ${entry.description} | ${entry.agentId ?? "-"} | ${entry.taskId ?? "-"} | ${confidence} |`)
      }
      lines.push(``)
    }

    // 证据详情
    if (this.config.includeEvidenceDetails) {
      lines.push(`## 证据详情`)
      lines.push(``)

      for (const entry of data.entries) {
        lines.push(`### 证据: ${entry.evidence.id}`)
        lines.push(``)
        lines.push(`- **类型**: ${this.formatEvidenceType(entry.evidence.type)}`)
        lines.push(`- **来源**: ${entry.evidence.source}`)
        lines.push(`- **代理**: ${entry.agentId}`)
        lines.push(`- **任务**: ${entry.taskId}`)
        lines.push(`- **置信度**: ${(entry.evidence.confidence * 100).toFixed(1)}%`)
        lines.push(`- **时间**: ${entry.createdAt}`)
        if (entry.parentEvidenceId) {
          lines.push(`- **父级证据**: ${entry.parentEvidenceId}`)
        }
        if (entry.childEvidenceIds && entry.childEvidenceIds.length > 0) {
          lines.push(`- **子级证据**: ${entry.childEvidenceIds.join(", ")}`)
        }
        lines.push(``)

        // 证据内容
        if (entry.evidence.content) {
          lines.push(`**内容**:`)
          lines.push(``)
          lines.push("```json")
          lines.push(JSON.stringify(entry.evidence.content, null, 2))
          lines.push("```")
          lines.push(``)
        }

        // 元数据
        if (entry.evidence.metadata && Object.keys(entry.evidence.metadata).length > 0) {
          lines.push(`**元数据**:`)
          lines.push(``)
          lines.push("```json")
          lines.push(JSON.stringify(entry.evidence.metadata, null, 2))
          lines.push("```")
          lines.push(``)
        }

        lines.push(`---`)
        lines.push(``)
      }
    }

    // 页脚
    lines.push(`## 生成信息`)
    lines.push(``)
    lines.push(`- **生成器**: Eternity Code AuditReportGenerator`)
    lines.push(`- **版本**: 1.5.0`)
    lines.push(`- **生成时间**: ${data.generatedAt}`)
    lines.push(``)

    return lines.join("\n")
  }

  /**
   * 保存审计报告到文件
   *
   * @param data 审计报告数据
   * @param filename 文件名（可选，默认使用报告 ID）
   * @returns 保存的文件路径
   */
  async save(data: AuditReportData, filename?: string): Promise<string> {
    const auditDir = path.join(this.config.cwd, ".meta", "audit")
    await fs.mkdir(auditDir, { recursive: true })

    const reportFilename = filename ?? `${data.id}.md`
    const filePath = path.join(auditDir, reportFilename)

    const markdown = this.toMarkdown(data)
    await fs.writeFile(filePath, markdown, "utf-8")

    this.logger.info(`审计报告已保存到: ${filePath}`)
    return filePath
  }

  /**
   * 生成并保存审计报告
   *
   * @param entries 证据条目
   * @param loopId Loop ID
   * @param filter 过滤器
   * @returns 保存的文件路径
   */
  async generateAndSave(
    entries: ProvenanceEntry[],
    loopId?: string,
    filter?: AuditReportFilter,
  ): Promise<string> {
    const data = this.generate(entries, filter, loopId)
    return this.save(data, loopId ? `audit-${loopId}.md` : undefined)
  }

  /**
   * 应用过滤器
   */
  private applyFilter(entries: ProvenanceEntry[], filter?: AuditReportFilter): ProvenanceEntry[] {
    if (!filter) {
      return entries
    }

    let filtered = entries

    // 按任务 ID 过滤
    if (filter.taskIds && filter.taskIds.length > 0) {
      filtered = filtered.filter(e => filter.taskIds!.includes(e.taskId))
    }

    // 按代理 ID 过滤
    if (filter.agentIds && filter.agentIds.length > 0) {
      filtered = filtered.filter(e => filter.agentIds!.includes(e.agentId))
    }

    // 按证据类型过滤
    if (filter.evidenceTypes && filter.evidenceTypes.length > 0) {
      filtered = filtered.filter(e => filter.evidenceTypes!.includes(e.evidence.type))
    }

    // 按时间范围过滤
    if (filter.timeRange) {
      if (filter.timeRange.start) {
        const startTime = new Date(filter.timeRange.start).getTime()
        filtered = filtered.filter(e => new Date(e.createdAt).getTime() >= startTime)
      }
      if (filter.timeRange.end) {
        const endTime = new Date(filter.timeRange.end).getTime()
        filtered = filtered.filter(e => new Date(e.createdAt).getTime() <= endTime)
      }
    }

    // 按置信度过滤
    if (filter.confidenceRange) {
      if (filter.confidenceRange.min !== undefined) {
        filtered = filtered.filter(e => e.evidence.confidence >= filter.confidenceRange!.min!)
      }
      if (filter.confidenceRange.max !== undefined) {
        filtered = filtered.filter(e => e.evidence.confidence <= filter.confidenceRange!.max!)
      }
    }

    return filtered
  }

  /**
   * 计算统计信息
   */
  private calculateStats(entries: ProvenanceEntry[]): AuditReportStats {
    const byType: Record<string, number> = {}
    const byAgent: Record<string, number> = {}
    const byTask: Record<string, number> = {}

    let totalConfidence = 0
    let minTime = Infinity
    let maxTime = -Infinity

    for (const entry of entries) {
      // 按类型统计
      byType[entry.evidence.type] = (byType[entry.evidence.type] ?? 0) + 1

      // 按代理统计
      byAgent[entry.agentId] = (byAgent[entry.agentId] ?? 0) + 1

      // 按任务统计
      byTask[entry.taskId] = (byTask[entry.taskId] ?? 0) + 1

      // 累计置信度
      totalConfidence += entry.evidence.confidence

      // 时间范围
      const time = new Date(entry.createdAt).getTime()
      if (time < minTime) minTime = time
      if (time > maxTime) maxTime = time
    }

    const averageConfidence = entries.length > 0 ? totalConfidence / entries.length : 0

    return {
      totalEvidence: entries.length,
      byType,
      byAgent,
      byTask,
      averageConfidence,
      timeSpan: {
        start: entries.length > 0 ? new Date(minTime).toISOString() : new Date().toISOString(),
        end: entries.length > 0 ? new Date(maxTime).toISOString() : new Date().toISOString(),
        durationMs: entries.length > 0 ? maxTime - minTime : 0,
      },
    }
  }

  /**
   * 生成时间线
   */
  private generateTimeline(entries: ProvenanceEntry[]): TimelineEntry[] {
    const timeline: TimelineEntry[] = []

    for (const entry of entries) {
      timeline.push({
        timestamp: entry.createdAt,
        type: entry.evidence.type,
        description: this.getEvidenceDescription(entry.evidence),
        evidenceId: entry.evidence.id,
        agentId: entry.agentId,
        taskId: entry.taskId,
        confidence: entry.evidence.confidence,
      })
    }

    // 按时间排序
    timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return timeline
  }

  /**
   * 获取证据描述
   */
  private getEvidenceDescription(evidence: EvidenceSource): string {
    if (typeof evidence.content === "string") {
      return evidence.content.slice(0, 100)
    }

    if (typeof evidence.content === "object" && evidence.content !== null) {
      const content = evidence.content as Record<string, unknown>

      switch (evidence.type) {
        case "llm_call":
          return `LLM 调用: ${(content.prompt as string)?.slice(0, 50) ?? "无提示"}`
        case "file_modification":
          return `文件修改: ${content.filePath ?? "未知文件"}`
        case "tool_invocation":
          return `工具调用: ${content.toolName ?? "未知工具"}`
        case "system_decision":
          return `系统决策: ${(content.decision as string)?.slice(0, 50) ?? "无决策"}`
        default:
          return `证据: ${evidence.source}`
      }
    }

    return `证据: ${evidence.source}`
  }

  /**
   * 格式化证据类型
   */
  private formatEvidenceType(type: string): string {
    const typeMap: Record<string, string> = {
      llm_call: "LLM 调用",
      file_modification: "文件修改",
      tool_invocation: "工具调用",
      human_input: "人工输入",
      system_decision: "系统决策",
      external_data: "外部数据",
    }
    return typeMap[type] ?? type
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
 * 创建审计报告生成器
 */
export function createAuditReportGenerator(config: AuditReportConfig): AuditReportGenerator {
  return new AuditReportGenerator(config)
}

/**
 * 快速生成审计报告
 */
export async function generateAuditReport(
  entries: ProvenanceEntry[],
  config: AuditReportConfig,
  loopId?: string,
): Promise<string> {
  const generator = new AuditReportGenerator(config)
  return generator.generateAndSave(entries, loopId)
}
