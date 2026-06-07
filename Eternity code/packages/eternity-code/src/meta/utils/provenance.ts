/**
 * ProvenanceTracker - 证据来源追踪器
 *
 * 记录代理输出的证据来源，支持溯源和信任验证。
 * 每个证据都关联到一个 traceId，用于跨模块追踪。
 *
 * 功能：
 * - 记录 LLM 调用的证据链
 * - 记录文件修改的证据链
 * - 记录工具调用的证据链
 * - 持久化到 .meta/provenance/
 *
 * @see arXiv:2606.04990 - 代理溯源与信任验证
 */

import { randomUUID } from "crypto"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import type {
  EvidenceSource,
  EvidenceSourceType,
  ProvenanceEntry,
} from "../types.js"
import type { TraceContext } from "./trace-context.js"
import { createLogger } from "./logger.js"

/**
 * ProvenanceTracker 配置
 */
export interface ProvenanceTrackerConfig {
  /** 工作目录 */
  cwd: string
  /** 最大条目数（内存中保留） */
  maxEntries?: number
  /** 是否启用自动持久化 */
  enablePersistence?: boolean
  /** 持久化间隔（毫秒），0 表示立即 */
  persistenceIntervalMs?: number
}

/**
 * 证据来源追踪器
 *
 * 记录代理输出的证据来源，支持溯源和信任验证。
 */
export class ProvenanceTracker {
  private entries: ProvenanceEntry[] = []
  private readonly cwd: string
  private readonly maxEntries: number
  private readonly enablePersistence: boolean
  private readonly persistenceIntervalMs: number
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private pendingSave = false
  private logger = createLogger("provenance")

  constructor(config: ProvenanceTrackerConfig) {
    this.cwd = config.cwd
    this.maxEntries = config.maxEntries ?? 1000
    this.enablePersistence = config.enablePersistence ?? true
    this.persistenceIntervalMs = config.persistenceIntervalMs ?? 0
  }

  /**
   * 记录证据
   *
   * @param evidence 证据来源
   * @param agentId 产生证据的代理 ID
   * @param taskId 任务 ID
   * @param parentEvidenceId 父级证据 ID（可选）
   * @param traceContext 追踪上下文（可选）
   * @returns 创建的证据条目
   */
  record(
    evidence: Omit<EvidenceSource, "id" | "timestamp">,
    agentId: string,
    taskId: string,
    parentEvidenceId?: string,
    traceContext?: TraceContext,
  ): ProvenanceEntry {
    const evidenceId = `ev-${randomUUID().slice(0, 12)}`
    const now = new Date().toISOString()

    const fullEvidence: EvidenceSource = {
      ...evidence,
      id: evidenceId,
      timestamp: now,
      traceId: traceContext?.traceId ?? evidence.traceId,
      spanId: traceContext?.spanId ?? evidence.spanId,
    }

    const entry: ProvenanceEntry = {
      id: `pe-${randomUUID().slice(0, 12)}`,
      evidence: fullEvidence,
      agentId,
      taskId,
      parentEvidenceId,
      childEvidenceIds: [],
      createdAt: now,
    }

    // 更新父级条目的子级列表
    if (parentEvidenceId) {
      const parentEntry = this.entries.find(
        (e) => e.evidence.id === parentEvidenceId,
      )
      if (parentEntry) {
        parentEntry.childEvidenceIds = [
          ...(parentEntry.childEvidenceIds ?? []),
          evidenceId,
        ]
      }
    }

    this.entries.push(entry)

    // 保持最大数量限制
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries)
    }

    this.scheduleSave()

    return entry
  }

  /**
   * 记录 LLM 调用证据
   *
   * @param agentId 代理 ID
   * @param taskId 任务 ID
   * @param prompt 提示词
   * @param response LLM 响应
   * @param confidence 置信度
   * @param traceContext 追踪上下文
   * @param parentEvidenceId 父级证据 ID
   * @returns 创建的证据条目
   */
  recordLLMCall(
    agentId: string,
    taskId: string,
    prompt: string,
    response: string,
    confidence: number,
    traceContext?: TraceContext,
    parentEvidenceId?: string,
  ): ProvenanceEntry {
    return this.record(
      {
        type: "llm_call",
        source: agentId,
        content: {
          prompt: prompt.slice(0, 1000), // 截断以避免数据膨胀
          response: response.slice(0, 2000),
        },
        confidence,
        metadata: {
          promptLength: prompt.length,
          responseLength: response.length,
        },
      },
      agentId,
      taskId,
      parentEvidenceId,
      traceContext,
    )
  }

  /**
   * 记录文件修改证据
   *
   * @param agentId 代理 ID
   * @param taskId 任务 ID
   * @param filePath 文件路径
   * @param diff 文件差异
   * @param confidence 置信度
   * @param traceContext 追踪上下文
   * @param parentEvidenceId 父级证据 ID
   * @returns 创建的证据条目
   */
  recordFileModification(
    agentId: string,
    taskId: string,
    filePath: string,
    diff: string,
    confidence: number,
    traceContext?: TraceContext,
    parentEvidenceId?: string,
  ): ProvenanceEntry {
    return this.record(
      {
        type: "file_modification",
        source: filePath,
        content: {
          filePath,
          diff: diff.slice(0, 5000), // 截断以避免数据膨胀
        },
        confidence,
        metadata: {
          diffLength: diff.length,
        },
      },
      agentId,
      taskId,
      parentEvidenceId,
      traceContext,
    )
  }

  /**
   * 记录工具调用证据
   *
   * @param agentId 代理 ID
   * @param taskId 任务 ID
   * @param toolName 工具名称
   * @param params 工具参数
   * @param result 工具结果
   * @param confidence 置信度
   * @param traceContext 追踪上下文
   * @param parentEvidenceId 父级证据 ID
   * @returns 创建的证据条目
   */
  recordToolInvocation(
    agentId: string,
    taskId: string,
    toolName: string,
    params: Record<string, unknown>,
    result: unknown,
    confidence: number,
    traceContext?: TraceContext,
    parentEvidenceId?: string,
  ): ProvenanceEntry {
    return this.record(
      {
        type: "tool_invocation",
        source: toolName,
        content: {
          toolName,
          params,
          result: typeof result === "string" ? result.slice(0, 2000) : JSON.stringify(result).slice(0, 2000),
        },
        confidence,
        metadata: {
          resultType: typeof result,
        },
      },
      agentId,
      taskId,
      parentEvidenceId,
      traceContext,
    )
  }

  /**
   * 记录系统决策证据
   *
   * @param agentId 代理 ID
   * @param taskId 任务 ID
   * @param decision 决策内容
   * @param reason 决策原因
   * @param confidence 置信度
   * @param traceContext 追踪上下文
   * @param parentEvidenceId 父级证据 ID
   * @returns 创建的证据条目
   */
  recordSystemDecision(
    agentId: string,
    taskId: string,
    decision: string,
    reason: string,
    confidence: number,
    traceContext?: TraceContext,
    parentEvidenceId?: string,
  ): ProvenanceEntry {
    return this.record(
      {
        type: "system_decision",
        source: agentId,
        content: {
          decision,
          reason,
        },
        confidence,
      },
      agentId,
      taskId,
      parentEvidenceId,
      traceContext,
    )
  }

  /**
   * 获取证据链
   *
   * 从指定证据开始，向上追溯到根证据。
   *
   * @param evidenceId 证据 ID
   * @returns 证据链（从根到指定证据）
   */
  getEvidenceChain(evidenceId: string): ProvenanceEntry[] {
    const chain: ProvenanceEntry[] = []
    let currentId: string | undefined = evidenceId

    while (currentId) {
      const entry = this.entries.find((e) => e.evidence.id === currentId)
      if (!entry) break

      chain.unshift(entry)
      currentId = entry.parentEvidenceId
    }

    return chain
  }

  /**
   * 获取任务的所有证据
   *
   * @param taskId 任务 ID
   * @returns 该任务的所有证据条目
   */
  getTaskEvidence(taskId: string): ProvenanceEntry[] {
    return this.entries.filter((e) => e.taskId === taskId)
  }

  /**
   * 获取代理的所有证据
   *
   * @param agentId 代理 ID
   * @returns 该代理的所有证据条目
   */
  getAgentEvidence(agentId: string): ProvenanceEntry[] {
    return this.entries.filter((e) => e.agentId === agentId)
  }

  /**
   * 获取指定 traceId 的所有证据
   *
   * @param traceId 追踪 ID
   * @returns 该追踪 ID 的所有证据条目
   */
  getTraceEvidence(traceId: string): ProvenanceEntry[] {
    return this.entries.filter((e) => e.evidence.traceId === traceId)
  }

  /**
   * 获取所有证据条目
   */
  getAllEntries(): ProvenanceEntry[] {
    return [...this.entries]
  }

  /**
   * 清除所有证据
   */
  clear(): void {
    this.entries = []
  }

  /**
   * 导出为 JSONL 格式
   *
   * @param filePath 输出文件路径
   */
  async exportJSONL(filePath: string): Promise<void> {
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const lines = this.entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
    await fs.writeFile(filePath, lines, "utf-8")
  }

  /**
   * 持久化到 .meta/provenance/
   */
  async persist(): Promise<void> {
    if (!this.enablePersistence) return

    try {
      const provenanceDir = path.join(this.cwd, ".meta", "provenance")
      await fs.mkdir(provenanceDir, { recursive: true })

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      const filePath = path.join(provenanceDir, `provenance-${timestamp}.jsonl`)

      await this.exportJSONL(filePath)

      this.logger.info(`Persisted ${this.entries.length} provenance entries to ${filePath}`)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(`Failed to persist provenance entries: ${errMsg}`)
    }
  }

  /**
   * 调度自动保存
   */
  private scheduleSave(): void {
    if (!this.enablePersistence) return

    const intervalMs = this.persistenceIntervalMs

    if (intervalMs === 0) {
      // 立即保存（异步）
      this.performSave()
      return
    }

    // 防抖保存
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }

    this.pendingSave = true
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.pendingSave = false
      this.performSave()
    }, intervalMs)
  }

  /**
   * 执行保存操作
   */
  private async performSave(): Promise<void> {
    if (!this.enablePersistence) return

    try {
      await this.persist()
    } catch (error) {
      // 保存失败不应影响主流程
      console.error("[ProvenanceTracker] Failed to save entries:", error)
    }
  }

  /**
   * 立即刷新待保存的数据
   */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }

    if (this.pendingSave) {
      this.pendingSave = false
      await this.performSave()
    }
  }
}

/**
 * 全局 ProvenanceTracker 实例
 */
let globalTracker: ProvenanceTracker | null = null

/**
 * 获取全局 ProvenanceTracker
 */
export function getGlobalTracker(): ProvenanceTracker {
  if (!globalTracker) {
    throw new Error("Global ProvenanceTracker not initialized. Call initGlobalTracker() first.")
  }
  return globalTracker
}

/**
 * 初始化全局 ProvenanceTracker
 */
export function initGlobalTracker(config: ProvenanceTrackerConfig): ProvenanceTracker {
  globalTracker = new ProvenanceTracker(config)
  return globalTracker
}

/**
 * 设置全局 ProvenanceTracker
 */
export function setGlobalTracker(tracker: ProvenanceTracker): void {
  globalTracker = tracker
}
