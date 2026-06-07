/**
 * Agent Dispatcher
 *
 * Unified sub-agent dispatch entry.
 * All sub-agent invocations go through this class so context injection,
 * prompt optimization, tracing, and persistence stay consistent.
 *
 * Supports Handoff routing: when an agent returns a HandoffResult,
 * the dispatcher routes control to the target agent automatically.
 */

import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import { randomUUID } from "crypto"
import { extractText } from "../utils/extract-text.js"
import { getRole, loadAllRoles, canHandoffTo } from "./registry.js"
import { buildAgentContext, injectHandoffIntoPrompt } from "./context-builder.js"
import { getParser } from "./parsers/index.js"
import { isHandoffResult, HandoffTrace } from "./handoff.js"
import type { HandoffResult } from "./handoff.js"
import { loadMetaDesign } from "../design.js"
import { PromptOptimizer, DEFAULT_PROMPT_CONFIG } from "../prompt/index.js"
import {
  ContextMixer,
  createContextMixer,
  estimateTokens,
  saveContextMixSnapshot,
  truncateToTokens,
} from "../context-mixer.js"
import type { ContextMixSnapshot } from "../context-mixer.js"
import type { Session } from "../types.js"
import type { AgentTask, DispatcherOptions } from "./types.js"
import { resolveMetaDirectory } from "../paths.js"
import { Watchdog } from "../watchdog/index.js"
import type { WatchdogConfig, WatchdogStatus } from "../watchdog/types.js"
import { PerformanceMonitor, getGlobalMonitor } from "../utils/performance.js"
import { MAX_HANDOFF_DEPTH, MAX_VISITS_PER_ROLE } from "../utils/handoff.js"
import { createLogger } from "../utils/logger.js"
import {
  createTraceContext,
  createChildTraceContext,
  propagateTraceContext,
  extractTraceContext,
  hasTraceContext,
} from "../utils/trace-context.js"
import type { TraceContext } from "../utils/trace-context.js"
import { ProvenanceTracker } from "../utils/provenance.js"
import type { ProvenanceTrackerConfig } from "../utils/provenance.js"

const MAX_CONSECUTIVE_WRITE_FAILURES = 5

export interface DispatcherEnhancedOptions extends DispatcherOptions {
  enablePromptOptimization?: boolean
  promptConfig?: Partial<import("../prompt/types.js").PromptMetaConfig>
  enableContextMixer?: boolean
  enableWatchdog?: boolean
  watchdogConfig?: Partial<WatchdogConfig>
  performanceMonitor?: PerformanceMonitor
  enableProvenanceTracking?: boolean
  provenanceConfig?: Partial<ProvenanceTrackerConfig>
}

export interface DispatchResult<T> {
  value: T
  handed_off: boolean
  handoff_trace: HandoffTrace | null
}

export class Dispatcher {
  private cwd: string
  private session: Session
  private onTaskStart?: (task: AgentTask) => void
  private onTaskComplete?: (task: AgentTask) => void
  private onTaskFail?: (task: AgentTask, error: string) => void
  private optimizer: PromptOptimizer | null
  private contextMixer: ContextMixer | null
  private watchdog: Watchdog | null
  private perfMonitor: PerformanceMonitor
  private provenanceTracker: ProvenanceTracker | null
  private consecutiveWriteFailures = 0
  private logger = createLogger("dispatcher")

  constructor(options: DispatcherEnhancedOptions) {
    this.cwd = options.cwd
    this.session = options.session
    this.onTaskStart = options.onTaskStart
    this.onTaskComplete = options.onTaskComplete
    this.onTaskFail = options.onTaskFail

    if (options.enablePromptOptimization !== false) {
      const config = { ...DEFAULT_PROMPT_CONFIG, ...options.promptConfig }
      this.optimizer = new PromptOptimizer(config)
    } else {
      this.optimizer = null
    }

    if (options.enableContextMixer !== false) {
      this.contextMixer = createContextMixer()
    } else {
      this.contextMixer = null
    }

    if (options.enableWatchdog !== false) {
      this.watchdog = new Watchdog(options.cwd, options.watchdogConfig)
    } else {
      this.watchdog = null
    }

    if (options.enableProvenanceTracking !== false) {
      const provenanceConfig: ProvenanceTrackerConfig = {
        cwd: options.cwd,
        ...options.provenanceConfig,
      }
      this.provenanceTracker = new ProvenanceTracker(provenanceConfig)
    } else {
      this.provenanceTracker = null
    }

    this.perfMonitor = options.performanceMonitor ?? getGlobalMonitor()
  }

  async dispatch<T>(roleId: string, input: Record<string, unknown>, triggeredBy: string = "manual"): Promise<T> {
    return this.perfMonitor.measure(
      `dispatch:${roleId}`,
      async () => {
        await loadAllRoles()

        const role = getRole(roleId)
        if (!role) throw new Error(`Unknown agent role: ${roleId}`)

        const taskId = `task-${randomUUID().slice(0, 8)}`

        // 创建或提取 TraceContext
        let traceContext: TraceContext
        if (hasTraceContext(input)) {
          // 从输入中提取已有的 TraceContext
          traceContext = extractTraceContext(input)!
        } else {
          // 创建新的 TraceContext
          traceContext = createTraceContext()
        }

        // 将 TraceContext 传播到 input 中
        const tracedInput = propagateTraceContext(traceContext, input)

        // 如果 watchdog 启用，使用 watchdog.guard 包裹
        if (this.watchdog) {
          return this.watchdog.guard<T>(roleId, triggeredBy, async (signal, onToolCall) => {
            return this.executeWithHandoff<T>(roleId, tracedInput, triggeredBy, taskId, signal, onToolCall, undefined, undefined, 0, undefined, traceContext)
          })
        }

        // 否则直接执行
        return this.executeWithHandoff<T>(roleId, tracedInput, triggeredBy, taskId, undefined, undefined, undefined, undefined, 0, undefined, traceContext)
      },
      { triggeredBy, inputSize: JSON.stringify(input).length }
    )
  }

  /**
   * 支持 handoff 路由的 dispatch 入口
   *
   * 返回 DispatchResult，包含最终值和 handoff 追踪信息。
   * 调用方可以据此判断是否发生了 handoff。
   */
  async dispatchWithTrace<T>(roleId: string, input: Record<string, unknown>, triggeredBy: string = "manual"): Promise<DispatchResult<T>> {
    await loadAllRoles()

    const trace = new HandoffTrace()
    const visited = new Map<string, number>()

    // 创建或提取 TraceContext
    let traceContext: TraceContext
    if (hasTraceContext(input)) {
      traceContext = extractTraceContext(input)!
    } else {
      traceContext = createTraceContext()
    }

    // 将 TraceContext 传播到 input 中
    const tracedInput = propagateTraceContext(traceContext, input)

    const value = await this.executeWithHandoff<T>(
      roleId,
      tracedInput,
      triggeredBy,
      `task-${randomUUID().slice(0, 8)}`,
      undefined,
      undefined,
      trace,
      visited,
      0,
      roleId,
      traceContext,
    )

    return {
      value,
      handed_off: trace.getEntries().length > 0,
      handoff_trace: trace.getEntries().length > 0 ? trace : null,
    }
  }

  /**
   * 内部 handoff 循环执行器
   *
   * 递归地执行 agent dispatch，当检测到 HandoffResult 时自动路由到目标 agent。
   * 支持深度限制、循环检测和链路追踪。
   */
  private async executeWithHandoff<T>(
    roleId: string,
    input: Record<string, unknown>,
    triggeredBy: string,
    taskId: string,
    signal?: AbortSignal,
    onToolCall?: (tool: string, params: unknown) => void,
    trace?: HandoffTrace,
    visited?: Map<string, number>,
    depth: number = 0,
    originRoleId?: string,
    traceContext?: TraceContext,
  ): Promise<T> {
    if (depth >= MAX_HANDOFF_DEPTH) {
      throw new Error(`Handoff depth exceeded maximum (${MAX_HANDOFF_DEPTH}). Chain: ${trace?.getChain().join(" → ")}`)
    }

    const effectiveVisited = visited ?? new Map<string, number>()
    const visitCount = effectiveVisited.get(roleId) ?? 0
    if (visitCount >= MAX_VISITS_PER_ROLE) {
      throw new Error(`Handoff cycle detected: ${roleId} visited ${visitCount} times. Chain: ${trace?.getChain().join(" → ")}`)
    }
    effectiveVisited.set(roleId, visitCount + 1)

    const role = getRole(roleId)
    if (!role) throw new Error(`Unknown agent role: ${roleId}`)

    // 执行 agent
    const output = await this.executeDispatch<T>(roleId, input, triggeredBy, taskId, role, signal, onToolCall, trace, originRoleId, traceContext)

    // 检测 HandoffResult
    if (isHandoffResult(output)) {
      const handoffResult = output as unknown as HandoffResult
      const targetRoleId = handoffResult.target_role_id
      const targetRole = getRole(targetRoleId)

      if (!targetRole) {
        throw new Error(`Handoff target role not found: ${targetRoleId}`)
      }

      // 验证 handoff 路由合法性
      if (!canHandoffTo(roleId, targetRoleId)) {
        throw new Error(`Role ${roleId} is not allowed to handoff to ${targetRoleId}`)
      }

      // 记录 handoff 链路
      trace?.record({
        handoff_id: handoffResult.handoff_id,
        from_role_id: roleId,
        to_role_id: targetRoleId,
        context_variables: handoffResult.context_variables,
        reason: handoffResult.reason,
      })

      this.logger.info(`Handoff: ${roleId} → ${targetRoleId} (reason: ${handoffResult.reason || "none"})`)

      // 合并 context_variables 到 input
      const mergedInput: Record<string, unknown> = {
        ...input,
        ...handoffResult.context_variables,
        _handoff_from: roleId,
        _handoff_reason: handoffResult.reason,
        _handoff_id: handoffResult.handoff_id,
      }

      // 创建子级 TraceContext（继承 traceId）
      const childTraceContext = traceContext
        ? createChildTraceContext(traceContext, { handoffId: handoffResult.handoff_id })
        : createTraceContext()

      // 将子级 TraceContext 传播到 mergedInput
      const tracedMergedInput = propagateTraceContext(childTraceContext, mergedInput)

      const nextTaskId = `task-${randomUUID().slice(0, 8)}`

      // 递归执行目标 agent
      return this.executeWithHandoff<T>(
        targetRoleId,
        tracedMergedInput,
        `handoff:${roleId}`,
        nextTaskId,
        signal,
        onToolCall,
        trace,
        effectiveVisited,
        depth + 1,
        originRoleId ?? roleId,
        childTraceContext,
      )
    }

    return output
  }

  private async executeDispatch<T>(
    roleId: string,
    input: Record<string, unknown>,
    triggeredBy: string,
    taskId: string,
    role: import("./types.js").AgentRole,
    signal?: AbortSignal,
    onToolCall?: (tool: string, params: unknown) => void,
    trace?: HandoffTrace,
    originRoleId?: string,
    traceContext?: TraceContext,
  ): Promise<T> {
    const design = await loadMetaDesign(this.cwd)
    let systemPrompt = role.system_prompt
    let contextSnapshot: Omit<ContextMixSnapshot, "finalSystemPromptTokens" | "preview"> | null = null

    if (this.contextMixer && design) {
      const metaContext = buildAgentContext(design, role.context_needs)
      const midTerm = this.contextMixer.buildMidTermMemory(design)
      const taskDescription = typeof input.task === "string" ? input.task : JSON.stringify(input)
      const targetFiles = Array.isArray(input.files) ? (input.files as string[]) : []
      const shortTerm = this.contextMixer.buildShortTermContext(taskDescription, targetFiles)
      const query = taskDescription.slice(0, 200)
      const longTerm = await this.contextMixer.buildLongTermMemory(query, this.cwd)
      const mixedContext = await this.contextMixer.mixDetailed(shortTerm, midTerm, longTerm, metaContext)

      systemPrompt = `${mixedContext.text}\n\n${role.system_prompt}`

      contextSnapshot = {
        taskId,
        roleId,
        triggeredBy,
        createdAt: new Date().toISOString(),
        task: taskDescription,
        targetFiles,
        rolePromptTokens: estimateTokens(role.system_prompt),
        diagnostics: mixedContext.diagnostics,
        layers: {
          shortTerm,
          midTerm,
          longTerm,
        },
      }
    } else {
      const metaContext = buildAgentContext(design, role.context_needs)
      systemPrompt = metaContext ? `${metaContext}\n\n${role.system_prompt}` : role.system_prompt
    }

    // 如果是 handoff 场景，注入 handoff context
    if (trace && trace.getEntries().length > 0 && originRoleId) {
      const lastEntry = trace.getEntries()[trace.getEntries().length - 1]!
      systemPrompt = injectHandoffIntoPrompt(
        systemPrompt,
        lastEntry.from_role_id,
        lastEntry.context_variables,
        lastEntry.reason,
        trace.getChain(),
      )
    }

    if (this.optimizer) {
      const optimizationResult = this.optimizer.optimize(systemPrompt)
      systemPrompt = optimizationResult.optimized_prompt

      if (optimizationResult.changes.length > 0) {
        this.logger.info(`Prompt optimized for ${roleId}: ${optimizationResult.changes.length} changes`)
      }
    }

    if (contextSnapshot) {
      saveContextMixSnapshot(this.cwd, {
        ...contextSnapshot,
        finalSystemPromptTokens: estimateTokens(systemPrompt),
        preview: truncateToTokens(systemPrompt, 2000),
      })
    }

    const userMessage = buildUserMessage(input, role.output_format)

    const task: AgentTask = {
      id: taskId,
      role_id: roleId,
      triggered_by: triggeredBy,
      input,
      status: "running",
      started_at: new Date().toISOString(),
      trace_id: traceContext?.traceId,
      span_id: traceContext?.spanId,
    }
    this.writeTask(task)
    this.onTaskStart?.(task)

    // 记录 LLM 调用开始的证据
    let parentEvidenceId: string | undefined
    if (this.provenanceTracker) {
      const startEntry = this.provenanceTracker.recordSystemDecision(
        roleId,
        taskId,
        "llm_call_start",
        `Starting LLM call for role ${roleId}`,
        1.0,
        traceContext,
      )
      parentEvidenceId = startEntry.evidence.id
    }

    const startMs = Date.now()
    // 使用 AbortController 支持取消挂起的操作
    const abortController = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    try {
      const timeoutMs = role.timeout_ms ?? 60000
      
      // 创建可取消的超时 Promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          abortController.abort() // 取消挂起的请求
          reject(new Error(`${roleId} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      })

      const response = await Promise.race([
        this.session.createSubtask?.({ 
          systemPrompt, 
          userMessage, 
          signal: abortController.signal, 
          onToolCall 
        }) ?? this.session.prompt({ 
          system: systemPrompt, 
          message: userMessage, 
          signal: abortController.signal, 
          onToolCall 
        }),
        timeoutPromise,
      ])

      // 清除超时定时器
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      const rawOutput = extractText(response)
      const parser = getParser(role.output_parser)
      const output = parser(rawOutput) as T

      // 记录 LLM 调用完成的证据
      if (this.provenanceTracker) {
        this.provenanceTracker.recordLLMCall(
          roleId,
          taskId,
          userMessage,
          rawOutput,
          1.0, // 成功调用置信度为 1.0
          traceContext,
          parentEvidenceId,
        )
      }

      // 如果解析结果是 HandoffResult，直接返回（不写 done，交给 executeWithHandoff 处理）
      if (isHandoffResult(output)) {
        task.status = "done"
        task.output = { type: "handoff", target: (output as unknown as HandoffResult).target_role_id }
        task.raw_output = rawOutput
        task.completed_at = new Date().toISOString()
        task.duration_ms = Date.now() - startMs
        this.writeTask(task)
        this.onTaskComplete?.(task)
        return output
      }

      task.status = "done"
      task.output = output
      task.raw_output = rawOutput
      task.completed_at = new Date().toISOString()
      task.duration_ms = Date.now() - startMs
      this.writeTask(task)
      this.onTaskComplete?.(task)

      return output
    } catch (err) {
      // 确保清除超时定时器
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      
      // 确保取消任何挂起的操作
      if (!abortController.signal.aborted) {
        abortController.abort()
      }

      const errorMsg = err instanceof Error ? err.message : String(err)

      // 记录 LLM 调用失败的证据
      if (this.provenanceTracker) {
        this.provenanceTracker.record(
          {
            type: "llm_call",
            source: roleId,
            content: {
              error: errorMsg,
              prompt: userMessage.slice(0, 1000),
            },
            confidence: 0.0, // 失败调用置信度为 0
            metadata: {
              errorType: err instanceof Error ? err.constructor.name : "Unknown",
            },
          },
          roleId,
          taskId,
          parentEvidenceId,
          traceContext,
        )
      }

      task.status = "failed"
      task.error = errorMsg
      task.completed_at = new Date().toISOString()
      task.duration_ms = Date.now() - startMs
      this.writeTask(task)
      this.onTaskFail?.(task, errorMsg)
      throw err
    }
  }

  async dispatchRestructure(triggeredBy: string = "quality_threshold"): Promise<import("../agents/parsers/restructure-plan.js").ParsedRestructurePlan> {
    return this.dispatch("restructure-planner", {}, triggeredBy)
  }

  async dispatchInsight(insight: string, triggeredBy: string = "manual"): Promise<import("../agents/parsers/insight.js").ParsedInsight> {
    return this.dispatch("insight-writer", { insight }, triggeredBy)
  }

  analyzePrompt(roleId: string): import("../prompt/types.js").PromptMetrics | null {
    if (!this.optimizer) return null

    const role = getRole(roleId)
    if (!role) return null

    const fullPrompt = `${role.system_prompt}\n\n${role.output_format}`
    return this.optimizer.calculateMetrics(fullPrompt)
  }

  getOptimizationSuggestions(
    prompt: string,
  ): {
    score: number
    issues: string[]
    suggestions: string[]
  } | null {
    if (!this.optimizer) return null
    return this.optimizer.analyzeQuality(prompt)
  }

  /**
   * 获取 Watchdog 状态
   */
  getWatchdogStatus(): WatchdogStatus | null {
    if (!this.watchdog) return null
    return this.watchdog.getStatus()
  }

  /**
   * 获取 Watchdog 实例（用于高级操作）
   */
  getWatchdog(): Watchdog | null {
    return this.watchdog
  }

  /**
   * 获取性能监控器
   */
  getPerformanceMonitor(): PerformanceMonitor {
    return this.perfMonitor
  }

  /**
   * 获取证据追踪器
   */
  getProvenanceTracker(): ProvenanceTracker | null {
    return this.provenanceTracker
  }

  /**
   * 获取调度性能统计
   */
  getDispatchStats(): ReturnType<PerformanceMonitor["getStats"]> {
    return this.perfMonitor.getStats()
  }

  private writeTask(task: AgentTask): void {
    try {
      const dir = resolveMetaDirectory(this.cwd, "agentTasks")
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const filePath = path.join(dir, `${task.id}.yaml`)
      fs.writeFileSync(filePath, yaml.dump(task, { lineWidth: 120 }))
      this.consecutiveWriteFailures = 0
    } catch (error) {
      this.consecutiveWriteFailures++
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Failed to write task ${task.id}: ${errMsg}`)

      if (this.consecutiveWriteFailures >= MAX_CONSECUTIVE_WRITE_FAILURES) {
        this.logger.error(
          `ALERT: ${this.consecutiveWriteFailures} consecutive task log write failures! Disk may be full.`,
        )
      }
    }
  }
}

function buildUserMessage(input: Record<string, unknown>, outputFormat: string): string {
  const inputSection = Object.entries(input)
    .map(([key, value]) => `${key}:\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`)
    .join("\n\n")

  return `${inputSection}\n\n---\nOutput format:\n${outputFormat}`
}


