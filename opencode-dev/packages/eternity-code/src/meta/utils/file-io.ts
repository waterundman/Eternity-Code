/**
 * 文件 I/O 工具模块
 * 提供异步文件操作、原子写入和类型安全的 YAML 解析
 */

import { promises as fsPromises } from "fs"
import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"

/**
 * 确保目录存在
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true })
  } catch (error: any) {
    if (error.code !== "EEXIST") throw error
    // EEXIST 是预期的，忽略
  }
}

/**
 * 同步确保目录存在（用于兼容现有代码）
 */
export function ensureDirectorySync(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * 异步读取 YAML 文件
 */
export async function readYamlFileAsync<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fsPromises.readFile(filePath, "utf8")
    const parsed = yaml.load(content)
    return parsed as T
  } catch {
    return null
  }
}

/**
 * 同步读取 YAML 文件（用于兼容现有代码）
 */
export function readYamlFileSync<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const content = fs.readFileSync(filePath, "utf8")
    const parsed = yaml.load(content)
    return parsed as T
  } catch {
    return null
  }
}

/**
 * 原子写入 YAML 文件
 * 先写入临时文件，再重命名，防止写入过程中崩溃导致数据损坏
 */
export async function writeYamlFileAtomicAsync<T>(filePath: string, data: T, options?: { lineWidth?: number }): Promise<void> {
  const content = yaml.dump(data, { lineWidth: options?.lineWidth ?? 120 })
  const tempPath = `${filePath}.tmp.${Date.now()}.${process.pid}`

  try {
    // 确保目录存在
    const dir = path.dirname(filePath)
    await ensureDirectory(dir)

    // 写入临时文件
    await fsPromises.writeFile(tempPath, content, "utf8")

    // 原子重命名
    await fsPromises.rename(tempPath, filePath)
  } catch (error) {
    // 清理临时文件
    try {
      await fsPromises.unlink(tempPath).catch(() => {})
    } catch {
      // 忽略清理错误
    }
    throw error
  }
}

/**
 * 同步写入 YAML 文件（用于兼容现有代码）
 */
export function writeYamlFileSync<T>(filePath: string, data: T, options?: { lineWidth?: number }): void {
  const content = yaml.dump(data, { lineWidth: options?.lineWidth ?? 120 })
  const dir = path.dirname(filePath)
  ensureDirectorySync(dir)
  fs.writeFileSync(filePath, content, "utf8")
}

/**
 * 异步读取 JSON 文件
 */
export async function readJsonFileAsync<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fsPromises.readFile(filePath, "utf8")
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

/**
 * 原子写入 JSON 文件
 */
export async function writeJsonFileAtomicAsync<T>(filePath: string, data: T): Promise<void> {
  const content = JSON.stringify(data, null, 2)
  const tempPath = `${filePath}.tmp.${Date.now()}.${process.pid}`

  try {
    const dir = path.dirname(filePath)
    await ensureDirectory(dir)
    await fsPromises.writeFile(tempPath, content, "utf8")
    await fsPromises.rename(tempPath, filePath)
  } catch (error) {
    try {
      await fsPromises.unlink(tempPath).catch(() => {})
    } catch {
      // 忽略清理错误
    }
    throw error
  }
}

/**
 * 异步读取目录中的所有 YAML 文件
 */
export async function readYamlDirectoryAsync<T>(dirPath: string, limit?: number): Promise<T[]> {
  try {
    const entries = await fsPromises.readdir(dirPath)
    const yamlFiles = entries
      .filter(f => f.endsWith(".yaml") || f.endsWith(".yml"))
      .sort()
      .reverse()

    const filesToRead = limit ? yamlFiles.slice(0, limit) : yamlFiles

    const results: T[] = []
    for (const file of filesToRead) {
      const filePath = path.join(dirPath, file)
      const data = await readYamlFileAsync<T>(filePath)
      if (data !== null) {
        results.push(data)
      }
    }
    return results
  } catch {
    return []
  }
}

/**
 * 检查文件是否存在
 */
export async function fileExistsAsync(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * 获取文件修改时间
 */
export async function getFileMtime(filePath: string): Promise<Date | null> {
  try {
    const stat = await fsPromises.stat(filePath)
    return stat.mtime
  } catch {
    return null
  }
}

/**
 * LRU 缓存实现
 */
export class LRUCache<K, V> {
  private cache = new Map<K, { value: V; timestamp: number }>()
  private readonly maxSize: number
  private readonly ttlMs: number

  constructor(options: { maxSize: number; ttlMs: number }) {
    this.maxSize = options.maxSize
    this.ttlMs = options.ttlMs
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key)
      return undefined
    }

    // 移动到最新位置
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.value
  }

  set(key: K, value: V): void {
    // 如果已存在，先删除
    this.cache.delete(key)

    // 如果超过最大大小，删除最旧的
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, { value, timestamp: Date.now() })
  }

  delete(key: K): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

/**
 * 带缓存的 YAML 文件读取
 */
export function createCachedYamlReader<T>(options?: { maxSize?: number; ttlMs?: number }) {
  const cache = new LRUCache<string, T>({
    maxSize: options?.maxSize ?? 100,
    ttlMs: options?.ttlMs ?? 5 * 60 * 1000, // 5分钟
  })

  return async function readCached(filePath: string): Promise<T | null> {
    const mtime = await getFileMtime(filePath)
    if (!mtime) return null

    const cacheKey = `${filePath}:${mtime.getTime()}`
    const cached = cache.get(cacheKey)
    if (cached) return cached

    const data = await readYamlFileAsync<T>(filePath)
    if (data !== null) {
      cache.set(cacheKey, data)
    }
    return data
  }
}
