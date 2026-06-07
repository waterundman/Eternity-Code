/**
 * ObservabilityContext - 统一可观测性上下文
 *
 * 基于 AsyncLocalStorage 实现隐式 traceId/spanId 传播，
 * 统一管理 Logger、PerformanceMonitor、HandoffTrace 的可观测性数据关联。
 *
 * 使用方式：
 * 1. 显式传递：直接使用 TraceContext 参数
 * 2. 隐式传播：通过 run() 设置上下文，内部自动获取
 */

import { AsyncLocalStorage } from "node:async_hooks"
import type { TraceContext } from "./trace-context.js"
import { createTraceContext, createChildTraceContext } from "./trace-context.js"

// ─── AsyncLocalStorage 实例 ───

const storage = new AsyncLocalStorage<TraceContext>()

// ─── 核心 API ───

/**
 * 在指定的 TraceContext 下运行异步操作
 *
 * 运行期间，所有通过 `current()` 获取的上下文都将返回此 TraceContext。
 *
 * @param context TraceContext 实例
 * @param fn 要执行的异步函数
 * @returns fn 的返回值
 *
 * @example
 * ```ts
 * const ctx = createTraceContext()
 * await ObservabilityContext.run(ctx, async () => {
 *   const current = ObservabilityContext.current()
 *   // current === ctx
 * })
 * ```
 */
function run<T>(context: TraceContext, fn: () => T | Promise<T>): T | Promise<T> {
  return storage.run(context, fn)
}

/**
 * 获取当前异步上下文中的 TraceContext
 *
 * 如果当前不在 `run()` 创建的上下文中，返回 undefined。
 *
 * @returns 当前 TraceContext 或 undefined
 */
function current(): TraceContext | undefined {
  return storage.getStore()
}

/**
 * 获取当前 TraceContext，如果不存在则创建一个新的
 *
 * 用于需要确保一定有 traceId 的场景（如日志、指标）。
 *
 * @returns TraceContext 实例
 */
function currentOrCreate(): TraceContext {
  return storage.getStore() ?? createTraceContext()
}

/**
 * 在当前上下文中创建子级 TraceContext
 *
 * 继承当前上下文的 traceId，生成新的 spanId。
 * 如果当前没有上下文，创建全新的 TraceContext。
 *
 * @param additionalBaggage 额外的 baggage 数据
 * @returns 子级 TraceContext
 */
function child(additionalBaggage?: Record<string, unknown>): TraceContext {
  const parent = storage.getStore()
  if (parent) {
    return createChildTraceContext(parent, additionalBaggage)
  }
  return createTraceContext({ baggage: additionalBaggage })
}

/**
 * 检查当前是否在 ObservabilityContext 运行中
 */
function isActive(): boolean {
  return storage.getStore() !== undefined
}

// ─── 导出 ───

export const ObservabilityContext = {
  run,
  current,
  currentOrCreate,
  child,
  isActive,
} as const
