/**
 * 资源管理器
 * 提供统一的资源清理机制，防止内存泄漏
 */

/**
 * 可清理资源接口
 */
export interface Disposable {
  dispose(): Promise<void> | void
}

/**
 * 资源项
 */
interface ResourceEntry {
  id: string
  resource: Disposable | (() => Promise<void> | void)
  description?: string
}

/**
 * 资源管理器
 */
export class ResourceManager implements Disposable {
  private resources: Map<string, ResourceEntry> = new Map()
  private disposed = false
  private cleanupErrors: Error[] = []

  /**
   * 注册资源
   */
  register<T extends Disposable>(resource: T, id?: string, description?: string): T {
    this.checkDisposed()
    const resourceId = id ?? `resource-${this.resources.size}`
    this.resources.set(resourceId, {
      id: resourceId,
      resource,
      description,
    })
    return resource
  }

  /**
   * 注册清理函数
   */
  registerCleanup(cleanup: () => Promise<void> | void, id?: string, description?: string): void {
    this.checkDisposed()
    const resourceId = id ?? `cleanup-${this.resources.size}`
    this.resources.set(resourceId, {
      id: resourceId,
      resource: cleanup,
      description,
    })
  }

  /**
   * 注册定时器
   */
  registerTimer(timerId: ReturnType<typeof setTimeout>, id?: string): void {
    this.registerCleanup(() => clearTimeout(timerId), id ?? `timer-${timerId}`, "Timer")
  }

  /**
   * 注册 AbortController
   */
  registerAbortController(controller: AbortController, id?: string): AbortController {
    this.registerCleanup(() => {
      if (!controller.signal.aborted) {
        controller.abort()
      }
    }, id ?? `abort-controller-${this.resources.size}`, "AbortController")
    return controller
  }

  /**
   * 注册文件监视器
   */
  registerWatcher(watcher: { close: () => void }, id?: string): void {
    this.registerCleanup(() => watcher.close(), id ?? `watcher-${this.resources.size}`, "FileWatcher")
  }

  /**
   * 移除资源
   */
  async unregister(id: string): Promise<boolean> {
    const entry = this.resources.get(id)
    if (!entry) return false

    await this.cleanupResource(entry)
    this.resources.delete(id)
    return true
  }

  /**
   * 清理所有资源
   */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true

    const entries = Array.from(this.resources.values()).reverse()

    for (const entry of entries) {
      await this.cleanupResource(entry)
    }

    this.resources.clear()

    if (this.cleanupErrors.length > 0) {
      console.warn(`[ResourceManager] ${this.cleanupErrors.length} errors during cleanup:`)
      for (const error of this.cleanupErrors) {
        console.warn(`  - ${error.message}`)
      }
    }
  }

  /**
   * 获取资源数量
   */
  get size(): number {
    return this.resources.size
  }

  /**
   * 获取资源列表
   */
  getResources(): Array<{ id: string; description?: string }> {
    return Array.from(this.resources.values()).map(({ id, description }) => ({ id, description }))
  }

  /**
   * 检查是否已清理
   */
  isDisposed(): boolean {
    return this.disposed
  }

  /**
   * 获取清理错误
   */
  getCleanupErrors(): Error[] {
    return [...this.cleanupErrors]
  }

  private checkDisposed(): void {
    if (this.disposed) {
      throw new Error("ResourceManager has been disposed")
    }
  }

  private async cleanupResource(entry: ResourceEntry): Promise<void> {
    try {
      if (typeof entry.resource === "function") {
        await entry.resource()
      } else {
        await entry.resource.dispose()
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.cleanupErrors.push(err)
    }
  }
}

/**
 * 创建资源管理器的作用域函数
 */
export async function withResources<T>(
  fn: (manager: ResourceManager) => Promise<T>
): Promise<T> {
  const manager = new ResourceManager()
  try {
    return await fn(manager)
  } finally {
    await manager.dispose()
  }
}

/**
 * 创建可清理的定时器
 */
export function createDisposableTimer(
  callback: () => void,
  ms: number
): Disposable & { id: ReturnType<typeof setTimeout> } {
  const id = setTimeout(callback, ms)
  return {
    id,
    dispose: () => clearTimeout(id),
  }
}

/**
 * 创建可清理的间隔定时器
 */
export function createDisposableInterval(
  callback: () => void,
  ms: number
): Disposable & { id: ReturnType<typeof setInterval> } {
  const id = setInterval(callback, ms)
  return {
    id,
    dispose: () => clearInterval(id),
  }
}

/**
 * 创建可清理的 AbortController
 */
export function createDisposableAbortController(): Disposable & AbortController {
  const controller = new AbortController()
  return Object.assign(controller, {
    dispose: () => {
      if (!controller.signal.aborted) {
        controller.abort()
      }
    },
  })
}

/**
 * 创建可清理的 Promise
 * 当资源被清理时，Promise 会被取消
 */
export function createCancellablePromise<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Promise cancelled"))
      return
    }

    const onAbort = () => {
      reject(new Error("Promise cancelled"))
    }

    signal.addEventListener("abort", onAbort, { once: true })

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      }
    )
  })
}

/**
 * 带超时的资源操作
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage?: string
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await createCancellablePromise(
      operation(),
      controller.signal
    )
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timeoutMessage ?? `Operation timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): T & { cancel: () => void; flush: () => void } {
  let timerId: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null

  const debounced = function (...args: Parameters<T>) {
    lastArgs = args
    if (timerId) {
      clearTimeout(timerId)
    }
    timerId = setTimeout(() => {
      fn(...args)
      timerId = null
      lastArgs = null
    }, ms)
  } as T & { cancel: () => void; flush: () => void }

  debounced.cancel = () => {
    if (timerId) {
      clearTimeout(timerId)
      timerId = null
      lastArgs = null
    }
  }

  debounced.flush = () => {
    if (timerId && lastArgs) {
      clearTimeout(timerId)
      fn(...lastArgs)
      timerId = null
      lastArgs = null
    }
  }

  return debounced
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): T & { cancel: () => void } {
  let lastCall = 0
  let timerId: ReturnType<typeof setTimeout> | null = null

  const throttled = function (...args: Parameters<T>) {
    const now = Date.now()
    const remaining = ms - (now - lastCall)

    if (remaining <= 0) {
      lastCall = now
      fn(...args)
    } else if (!timerId) {
      timerId = setTimeout(() => {
        lastCall = Date.now()
        timerId = null
        fn(...args)
      }, remaining)
    }
  } as T & { cancel: () => void }

  throttled.cancel = () => {
    if (timerId) {
      clearTimeout(timerId)
      timerId = null
    }
  }

  return throttled
}
