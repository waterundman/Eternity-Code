# Eternity Code 稳定性优化方案

更新日期：2026-03-29

## 审查概述

通过对整个项目的全面审查，识别了以下主要稳定性问题：

| 类别 | 问题数量 | 高风险 | 中风险 | 低风险 |
|------|----------|--------|--------|--------|
| 类型安全 | 15+ | 5 | 8 | 2 |
| 错误处理 | 20+ | 8 | 10 | 2 |
| 资源管理 | 10+ | 4 | 5 | 1 |
| 并发安全 | 8+ | 5 | 3 | 0 |
| 边界处理 | 12+ | 3 | 7 | 2 |

**总体评分：2.3/5** - 需要重点关注错误处理、类型安全和资源管理。

---

## 一、高风险问题（必须立即修复）

### 1.1 Promise.race 资源泄漏

**位置**：`agents/dispatcher.ts:174-178`

**问题**：当超时 Promise 先完成时，原始请求仍在后台运行。

**修复方案**：
```typescript
// 使用 AbortController 取消未完成的请求
const controller = new AbortController()

try {
  const response = await Promise.race([
    this.session.createSubtask?.({ 
      systemPrompt, 
      userMessage, 
      signal: controller.signal 
    }),
    timeout(role.timeout_ms ?? 60000, `${roleId} timed out`, () => controller.abort()),
  ])
} finally {
  controller.abort() // 确保取消任何挂起的操作
}
```

### 1.2 重试循环边界条件

**位置**：`watchdog/index.ts:155`

**问题**：`max_retries` 为 0 时，`lastError` 可能为 undefined。

**修复方案**：
```typescript
private async withRetry<T>(
  roleId: string,
  loopId: string,
  fn: () => Promise<T>
): Promise<T> {
  if (this.config.max_retries <= 0) {
    return fn() // 直接执行，不重试
  }

  let lastError: unknown
  for (let attempt = 0; attempt < this.config.max_retries; attempt++) {
    // ... 重试逻辑
  }
  
  // 确保 lastError 有值
  if (lastError) throw lastError
  throw new Error(`[Watchdog] ${roleId} failed after ${this.config.max_retries} retries`)
}
```

### 1.3 Git 命令调用无错误处理

**位置**：`execution/executor.ts:52-53`

**问题**：`getGitHead` 和 `getCurrentBranch` 可能抛出异常。

**修复方案**：
```typescript
async function getGitHead(cwd: string): Promise<string | null> {
  try {
    const result = await execAsync("git rev-parse HEAD", { cwd })
    return result.stdout.trim()
  } catch (error) {
    console.warn(`[Executor] Failed to get git HEAD: ${error}`)
    return null
  }
}

async function getCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const result = await execAsync("git branch --show-current", { cwd })
    return result.stdout.trim() || null
  } catch (error) {
    console.warn(`[Executor] Failed to get current branch: ${error}`)
    return null
  }
}
```

### 1.4 同步文件 I/O 阻塞

**位置**：多个文件中的 `fs.readFileSync` / `fs.writeFileSync`

**问题**：同步 I/O 阻塞事件循环。

**修复方案**：
```typescript
import { promises as fsPromises } from "fs"

// 替换同步操作
async function readYamlFileAsync<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fsPromises.readFile(filePath, "utf8")
    return yaml.load(content) as T
  } catch {
    return null
  }
}

async function writeYamlFileAsync<T>(filePath: string, data: T): Promise<void> {
  const content = yaml.dump(data, { lineWidth: 120 })
  // 原子写入：先写临时文件，再重命名
  const tempPath = `${filePath}.tmp.${Date.now()}`
  await fsPromises.writeFile(tempPath, content)
  await fsPromises.rename(tempPath, filePath)
}
```

### 1.5 子进程执行风险

**位置**：`evaluator.ts:91`

**问题**：命令注入风险和同步阻塞。

**修复方案**：
```typescript
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

async function runEvalScript(scriptPath: string, cwd: string): Promise<string> {
  // 验证脚本路径
  const resolvedPath = path.resolve(cwd, scriptPath)
  if (!resolvedPath.startsWith(cwd)) {
    throw new Error("Script path outside working directory")
  }

  try {
    const { stdout } = await execFileAsync("bun", [resolvedPath], {
      cwd,
      timeout: 30000,
      maxBuffer: 1024 * 1024, // 1MB
    })
    return stdout.trim()
  } catch (error: any) {
    throw new Error(`Eval script failed: ${error.message}`)
  }
}
```

---

## 二、中风险问题（短期修复）

### 2.1 类型安全问题

**问题**：多处使用 `as` 进行不安全的类型断言。

**修复方案**：引入运行时类型验证。

```typescript
import { z } from "zod"

const MetaDesignSchema = z.object({
  _schema_version: z.string().optional(),
  project: z.object({
    id: z.string(),
    name: z.string(),
    stage: z.enum(["prototype", "mvp", "growth", "mature"]),
    core_value: z.string(),
    anti_value: z.string(),
  }),
  requirements: z.array(z.object({
    id: z.string(),
    text: z.string(),
    priority: z.enum(["p0", "p1", "p2"]),
    coverage: z.number(),
  })),
  // ... 其他字段
})

function parseMetaDesign(data: unknown): MetaDesign {
  return MetaDesignSchema.parse(data)
}
```

### 2.2 文件操作竞态条件

**问题**：`existsSync` 和 `mkdirSync` 之间存在时间窗口。

**修复方案**：
```typescript
async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true })
  } catch (error: any) {
    if (error.code !== "EEXIST") throw error
    // EEXIST 是预期的，忽略
  }
}
```

### 2.3 错误处理过于宽泛

**问题**：捕获所有错误并返回默认值。

**修复方案**：
```typescript
// 定义结构化错误类型
class EvalError extends Error {
  constructor(
    message: string,
    public readonly factorId: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = "EvalError"
  }
}

// 在 catch 块中区分错误类型
try {
  const result = await runEval()
  return result
} catch (error) {
  if (error instanceof EvalError) {
    // 评估特定错误，记录但继续
    logger.warn(`Eval failed for ${error.factorId}: ${error.message}`)
    return { error: error.message, factorId: error.factorId }
  }
  // 其他错误，向上抛出
  throw error
}
```

### 2.4 状态更新非原子性

**问题**：读取-修改-写入操作不是原子的。

**修复方案**：
```typescript
import { lock } from "proper-lockfile"

async function updateDesignAtomically(
  cwd: string,
  updater: (design: MetaDesign) => MetaDesign
): Promise<void> {
  const designPath = resolveMetaDesignPath(cwd)
  
  // 获取文件锁
  const release = await lock(designPath, { retries: 3 })
  
  try {
    // 读取
    const content = await fsPromises.readFile(designPath, "utf8")
    const design = yaml.load(content) as MetaDesign
    
    // 修改
    const updated = updater(design)
    
    // 写入
    await fsPromises.writeFile(designPath, yaml.dump(updated, { lineWidth: 100 }))
  } finally {
    // 释放锁
    await release()
  }
}
```

### 2.5 内存泄漏风险

**问题**：未清理的 setTimeout 和未取消的 Promise。

**修复方案**：
```typescript
function timeout(ms: number, msg: string, onCancel?: () => void): Promise<never> {
  let timer: NodeJS.Timeout | null = null
  
  return new Promise((_, reject) => {
    timer = setTimeout(() => {
      onCancel?.()
      reject(new Error(msg))
    }, ms)
  }).finally(() => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  })
}
```

---

## 三、低风险问题（长期改进）

### 3.1 代码重复

**问题**：`extractText` 函数在多个文件中重复定义。

**修复方案**：
```typescript
// utils/text.ts
export function extractText(response: unknown): string {
  if (typeof response === "string") return response
  const result = response as any
  if (typeof result?.text === "string") return result.text
  if (Array.isArray(result?.content)) {
    return result.content.map((item: any) => item?.text ?? "").join("\n")
  }
  return String(response)
}
```

### 3.2 硬编码值

**问题**：模型名称等硬编码在代码中。

**修复方案**：
```typescript
// config/defaults.ts
export const DEFAULT_MODEL = process.env.ETERNITY_DEFAULT_MODEL ?? "opencode/mimo-v2-pro-free"

export const DEFAULT_TIMEOUTS = {
  agentCall: 60000,
  evalScript: 30000,
  gitOperation: 10000,
} as const
```

### 3.3 性能优化

**问题**：重复计算和不必要的文件读取。

**修复方案**：
```typescript
// 实现 LRU 缓存
import { LRUCache } from "lru-cache"

const yamlCache = new LRUCache<string, unknown>({
  max: 100,
  ttl: 1000 * 60 * 5, // 5分钟
})

async function readYamlCached<T>(filePath: string): Promise<T | null> {
  const stat = await fsPromises.stat(filePath).catch(() => null)
  if (!stat) return null
  
  const cacheKey = `${filePath}:${stat.mtimeMs}`
  const cached = yamlCache.get(cacheKey)
  if (cached) return cached as T
  
  const content = await fsPromises.readFile(filePath, "utf8")
  const parsed = yaml.load(content) as T
  yamlCache.set(cacheKey, parsed)
  return parsed
}
```

---

## 四、架构性改进

### 4.1 统一错误处理框架

```typescript
// errors/index.ts
export enum ErrorCode {
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  PARSE_ERROR = "PARSE_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  GIT_ERROR = "GIT_ERROR",
  AGENT_ERROR = "AGENT_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = "AppError"
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    }
  }
}

// 使用示例
throw new AppError(
  ErrorCode.FILE_NOT_FOUND,
  "Design file not found",
  { path: designPath }
)
```

### 4.2 资源管理器

```typescript
// resources/manager.ts
export class ResourceManager {
  private resources: Array<{ cleanup: () => Promise<void> }> = []

  register<T extends { cleanup: () => Promise<void> }>(resource: T): T {
    this.resources.push(resource)
    return resource
  }

  async cleanupAll(): Promise<void> {
    for (const resource of this.resources.reverse()) {
      try {
        await resource.cleanup()
      } catch (error) {
        console.error("Failed to cleanup resource:", error)
      }
    }
    this.resources = []
  }
}

// 使用示例
async function executeWithCleanup<T>(
  fn: (manager: ResourceManager) => Promise<T>
): Promise<T> {
  const manager = new ResourceManager()
  try {
    return await fn(manager)
  } finally {
    await manager.cleanupAll()
  }
}
```

### 4.3 监控和健康检查

```typescript
// health/checker.ts
export interface HealthStatus {
  healthy: boolean
  checks: Array<{
    name: string
    status: "ok" | "error" | "warning"
    message?: string
    latency?: number
  }>
}

export async function checkHealth(cwd: string): Promise<HealthStatus> {
  const checks = await Promise.all([
    checkFileSystem(cwd),
    checkGitStatus(cwd),
    checkMemoryUsage(),
    checkWatchdog(),
  ])

  return {
    healthy: checks.every(c => c.status === "ok"),
    checks,
  }
}
```

---

## 五、实施计划

### 第一阶段：高风险修复（1周）

| 任务 | 优先级 | 预计工时 |
|------|--------|----------|
| Promise.race 资源泄漏修复 | P0 | 4h |
| 重试循环边界条件修复 | P0 | 2h |
| Git 命令错误处理 | P0 | 4h |
| 同步 I/O 迁移 | P0 | 8h |
| 子进程安全加固 | P0 | 4h |

### 第二阶段：中风险修复（2周）

| 任务 | 优先级 | 预计工时 |
|------|--------|----------|
| 类型安全验证 | P1 | 16h |
| 文件锁机制 | P1 | 8h |
| 结构化错误处理 | P1 | 12h |
| 内存泄漏修复 | P1 | 8h |

### 第三阶段：长期改进（4周）

| 任务 | 优先级 | 预计工时 |
|------|--------|----------|
| 代码重构 | P2 | 24h |
| 性能优化 | P2 | 16h |
| 监控系统 | P2 | 16h |
| 测试覆盖 | P2 | 24h |

---

## 六、验收标准

### 稳定性指标

| 指标 | 当前估计 | 目标值 |
|------|----------|--------|
| 未处理异常率 | ~5% | < 0.1% |
| 资源泄漏 | 存在 | 无 |
| 数据损坏风险 | 中 | 无 |
| 并发安全 | 不安全 | 安全 |

### 性能指标

| 指标 | 当前估计 | 目标值 |
|------|----------|--------|
| 文件操作延迟 | ~100ms (sync) | < 50ms (async) |
| 内存使用 | 无监控 | < 512MB |
| CPU 阻塞时间 | 频繁 | < 10ms/op |

---

## 七、总结

本次审查识别了 **65+ 个稳定性问题**，其中 **25 个高风险** 问题需要立即修复。主要问题集中在：

1. **错误处理不完善** - 导致问题被掩盖，难以诊断
2. **类型安全缺失** - 运行时错误风险高
3. **资源管理不当** - 内存泄漏和资源耗尽风险
4. **并发安全问题** - 数据损坏和竞态条件

通过分阶段实施本方案，可以将系统稳定性从 **2.3/5** 提升到 **4.0/5** 以上。
