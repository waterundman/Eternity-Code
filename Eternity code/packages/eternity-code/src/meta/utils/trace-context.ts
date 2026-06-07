/**
 * TraceContext - 跨模块链路追踪
 *
 * 提供 traceId、spanId、parentSpanId、baggage 的传播机制，
 * 支持跨模块调用时的上下文传递。
 *
 * 与 HandoffTrace 兼容，可在 Handoff 链路中复用 traceId。
 */

import { randomUUID } from "crypto"

// ─── 类型定义 ───

/**
 * 追踪上下文接口
 */
export interface TraceContext {
  /** 全局追踪 ID，标识一次完整的调用链路 */
  readonly traceId: string
  /** 当前 span ID，标识当前操作 */
  readonly spanId: string
  /** 父级 span ID，标识调用来源 */
  readonly parentSpanId?: string
  /** 携带的额外数据，跨模块传播 */
  readonly baggage: Record<string, unknown>
  /** 创建时间 */
  readonly createdAt: string
}

/**
 * 创建追踪上下文的选项
 */
export interface TraceContextOptions {
  /** 指定 traceId，不提供则自动生成 */
  traceId?: string
  /** 指定 spanId，不提供则自动生成 */
  spanId?: string
  /** 父级 span ID */
  parentSpanId?: string
  /** 初始 baggage 数据 */
  baggage?: Record<string, unknown>
}

// ─── 核心函数 ───

/**
 * 创建 TraceContext 实例
 *
 * @example
 * ```ts
 * const ctx = createTraceContext()
 * // => { traceId: "tr-abc123", spanId: "sp-def456", baggage: {}, ... }
 *
 * const childCtx = createTraceContext({
 *   traceId: ctx.traceId,
 *   parentSpanId: ctx.spanId,
 * })
 * ```
 */
export function createTraceContext(options?: TraceContextOptions): TraceContext {
  return {
    traceId: options?.traceId ?? `tr-${randomUUID().slice(0, 12)}`,
    spanId: options?.spanId ?? `sp-${randomUUID().slice(0, 8)}`,
    parentSpanId: options?.parentSpanId,
    baggage: { ...options?.baggage },
    createdAt: new Date().toISOString(),
  }
}

/**
 * 创建子级 TraceContext
 *
 * 继承父级的 traceId 和 baggage，生成新的 spanId，
 * 将父级 spanId 设为 parentSpanId。
 *
 * @example
 * ```ts
 * const parent = createTraceContext()
 * const child = createChildTraceContext(parent)
 * // child.traceId === parent.traceId
 * // child.parentSpanId === parent.spanId
 * ```
 */
export function createChildTraceContext(
  parent: TraceContext,
  additionalBaggage?: Record<string, unknown>,
): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: `sp-${randomUUID().slice(0, 8)}`,
    parentSpanId: parent.spanId,
    baggage: {
      ...parent.baggage,
      ...additionalBaggage,
    },
    createdAt: new Date().toISOString(),
  }
}

/**
 * 传播 TraceContext
 *
 * 将 TraceContext 注入到目标对象中，用于跨模块传递。
 * 支持注入到 input、options 或任意 Record 中。
 *
 * @param context 要传播的 TraceContext
 * @param target 目标对象，TraceContext 字段将被合并
 * @returns 合并后的新对象
 *
 * @example
 * ```ts
 * const ctx = createTraceContext()
 * const input = propagateTraceContext(ctx, { task: "analyze" })
 * // => { task: "analyze", _traceId: "tr-abc123", _spanId: "sp-def456", ... }
 * ```
 */
export function propagateTraceContext<T extends Record<string, unknown>>(
  context: TraceContext,
  target: T,
): T & TraceContextFields {
  return {
    ...target,
    _traceId: context.traceId,
    _spanId: context.spanId,
    _parentSpanId: context.parentSpanId,
    _baggage: context.baggage,
    _traceCreatedAt: context.createdAt,
  }
}

/**
 * 从对象中提取 TraceContext
 *
 * @param source 包含 TraceContext 字段的对象
 * @returns 提取的 TraceContext，如果字段不存在则返回 undefined
 *
 * @example
 * ```ts
 * const input = { task: "analyze", _traceId: "tr-abc123", _spanId: "sp-def456" }
 * const ctx = extractTraceContext(input)
 * // => { traceId: "tr-abc123", spanId: "sp-def456", baggage: {} }
 * ```
 */
export function extractTraceContext(
  source: Record<string, unknown>,
): TraceContext | undefined {
  const traceId = source._traceId as string | undefined
  const spanId = source._spanId as string | undefined

  if (!traceId || !spanId) {
    return undefined
  }

  return {
    traceId,
    spanId,
    parentSpanId: source._parentSpanId as string | undefined,
    baggage: (source._baggage as Record<string, unknown>) ?? {},
    createdAt: (source._traceCreatedAt as string) ?? new Date().toISOString(),
  }
}

/**
 * 合并 baggage 数据
 *
 * 将新的键值对添加到 TraceContext 的 baggage 中，
 * 返回新的 TraceContext 实例（不可变）。
 */
export function withBaggage(
  context: TraceContext,
  additionalBaggage: Record<string, unknown>,
): TraceContext {
  return {
    ...context,
    baggage: {
      ...context.baggage,
      ...additionalBaggage,
    },
  }
}

// ─── 类型辅助 ───

/**
 * 传播到对象后添加的字段类型
 */
export interface TraceContextFields {
  _traceId: string
  _spanId: string
  _parentSpanId?: string
  _baggage: Record<string, unknown>
  _traceCreatedAt: string
}

// ─── HandoffTrace 集成 ───

/**
 * 从 HandoffTrace 创建 TraceContext
 *
 * 用于将现有的 HandoffTrace 转换为 TraceContext，
 * 实现两套追踪系统的桥接。
 *
 * @param handoffTraceId HandoffTrace 中的 traceId（如果有的话）
 * @param handoffId Handoff 的 ID
 * @returns 新的 TraceContext
 */
export function createTraceContextFromHandoff(
  handoffTraceId?: string,
  handoffId?: string,
): TraceContext {
  return createTraceContext({
    traceId: handoffTraceId,
    baggage: handoffId ? { handoffId } : undefined,
  })
}

/**
 * 检查对象是否包含 TraceContext
 */
export function hasTraceContext(source: Record<string, unknown>): boolean {
  return typeof source._traceId === "string" && typeof source._spanId === "string"
}
