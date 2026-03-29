/**
 * Agent Dispatcher
 *
 * Unified sub-agent dispatch entry.
 * All sub-agent invocations go through this class so context injection,
 * prompt optimization, tracing, and persistence stay consistent.
 */

import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import { randomUUID } from "crypto"
import { getRole, loadAllRoles } from "./registry.js"
import { buildAgentContext } from "./context-builder.js"
import { getParser } from "./parsers/index.js"
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

export interface DispatcherEnhancedOptions extends DispatcherOptions {
  enablePromptOptimization?: boolean
  promptConfig?: Partial<import("../prompt/types.js").PromptMetaConfig>
  enableContextMixer?: boolean
  enableWatchdog?: boolean
  watchdogConfig?: Partial<WatchdogConfig>
  performanceMonitor?: PerformanceMonitor
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

        // 如果 watchdog 启用，使用 watchdog.guard 包裹
        if (this.watchdog) {
          return this.watchdog.guard<T>(roleId, triggeredBy, async (signal, onToolCall) => {
            return this.executeDispatch<T>(roleId, input, triggeredBy, taskId, role, signal, onToolCall)
          })
        }

        // 否则直接执行
        return this.executeDispatch<T>(roleId, input, triggeredBy, taskId, role)
      },
      { triggeredBy, inputSize: JSON.stringify(input).length }
    )
  }

  private async executeDispatch<T>(
    roleId: string,
    input: Record<string, unknown>,
    triggeredBy: string,
    taskId: string,
    role: import("./types.js").AgentRole,
    signal?: AbortSignal,
    onToolCall?: (tool: string, params: unknown) => void
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

    if (this.optimizer) {
      const optimizationResult = this.optimizer.optimize(systemPrompt)
      systemPrompt = optimizationResult.optimized_prompt

      if (optimizationResult.changes.length > 0) {
        console.log(`[Dispatcher] Prompt optimized for ${roleId}: ${optimizationResult.changes.length} changes`)
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
    }
    this.writeTask(task)
    this.onTaskStart?.(task)

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
    } catch (error) {
      // 写入失败不应阻塞主流程，只记录警告
      console.warn(`[Dispatcher] Failed to write task ${task.id}:`, error)
    }
  }
}

function buildUserMessage(input: Record<string, unknown>, outputFormat: string): string {
  const inputSection = Object.entries(input)
    .map(([key, value]) => `${key}:\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`)
    .join("\n\n")

  return `${inputSection}\n\n---\nOutput format:\n${outputFormat}`
}

function extractText(response: unknown): string {
  if (typeof response === "string") return response
  const result = response as any
  if (typeof result?.text === "string") return result.text
  if (Array.isArray(result?.content)) {
    return result.content.map((item: any) => item?.text ?? "").join("\n")
  }
  return String(response)
}
