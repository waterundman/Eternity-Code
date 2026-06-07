/**
 * 文件锁工具模块
 * 使用锁文件 (.lock) 实现进程间并发控制，保护 design.yaml 等共享文件的读写
 */

import { promises as fsPromises } from "fs"

const LOCK_TIMEOUT_MS = 5000
const LOCK_RETRY_COUNT = 3
const LOCK_RETRY_DELAY_MS = 100

export interface LockOptions {
  /** 锁超时时间（毫秒），超过此时间强制获取锁 */
  timeoutMs?: number
  /** 重试次数 */
  retryCount?: number
  /** 重试间隔（毫秒） */
  retryDelayMs?: number
}

/**
 * 获取文件锁
 * 使用 'wx' 标志原子创建锁文件，仅当文件不存在时成功
 * 如果锁文件存在但已超时，则强制获取
 */
export async function acquireLock(lockPath: string, options?: LockOptions): Promise<void> {
  const lockFile = lockPath + ".lock"
  const timeoutMs = options?.timeoutMs ?? LOCK_TIMEOUT_MS
  const retryCount = options?.retryCount ?? LOCK_RETRY_COUNT
  const retryDelayMs = options?.retryDelayMs ?? LOCK_RETRY_DELAY_MS

  for (let i = 0; i < retryCount; i++) {
    try {
      await fsPromises.writeFile(lockFile, String(process.pid), { flag: "wx" })
      return
    } catch (err: any) {
      if (err.code === "EEXIST") {
        try {
          const stat = await fsPromises.stat(lockFile)
          if (Date.now() - stat.mtimeMs > timeoutMs) {
            await fsPromises.writeFile(lockFile, String(process.pid), { flag: "w" })
            return
          }
        } catch {
          // stat 失败说明锁文件已被删除，下一轮重试即可
        }
        await new Promise((r) => setTimeout(r, retryDelayMs))
      } else {
        throw err
      }
    }
  }
  throw new Error(`Failed to acquire lock after ${retryCount} retries: ${lockPath}`)
}

/**
 * 释放文件锁
 * 删除锁文件，如果锁文件不存在则静默忽略
 */
export async function releaseLock(lockPath: string): Promise<void> {
  const lockFile = lockPath + ".lock"
  try {
    await fsPromises.unlink(lockFile)
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err
  }
}

/**
 * 在文件锁保护下执行异步操作
 * 自动处理锁的获取和释放，异常时确保锁被释放
 */
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, options?: LockOptions): Promise<T> {
  await acquireLock(lockPath, options)
  try {
    return await fn()
  } finally {
    await releaseLock(lockPath)
  }
}
