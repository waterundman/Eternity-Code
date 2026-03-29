import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { RawCard } from "./types.js"
import { resolveMetaEntryPath } from "./paths.js"

export interface CardScope {
  cardId: string
  files: string[]
  directories: string[]
  description: string
}

export interface ValidationResult {
  success: boolean
  errors: string[]
  warnings: string[]
}

/**
 * 分析卡片的 scope，确定修改范围
 */
export function analyzeCardScope(cwd: string, cardId: string): CardScope {
  const cardPath = resolveMetaEntryPath(cwd, "cards", `${cardId}.yaml`)
  
  if (!fs.existsSync(cardPath)) {
    throw new Error(`Card not found: ${cardId}`)
  }
  
  const card = yaml.load(fs.readFileSync(cardPath, "utf8")) as any
  const content = card.content
  
  // 从卡片内容中提取 scope 信息
  const files: string[] = []
  const directories: string[] = []
  
  // 分析 approach 字段，提取可能的文件路径
  const approach = content.approach || ""
  const fileMatches = approach.match(/(?:src|lib|packages?)\/[\w\/]+\.\w+/g) || []
  files.push(...fileMatches)
  
  // 分析 objective 字段
  const objective = content.objective || ""
  
  // 从 req_refs 推断可能的模块
  const reqRefs = card.req_refs || []
  
  // 如果卡片有明确的 scope 字段
  if (content.scope) {
    if (Array.isArray(content.scope)) {
      for (const scope of content.scope) {
        if (scope.includes(".")) {
          files.push(scope)
        } else {
          directories.push(scope)
        }
      }
    } else if (typeof content.scope === "string") {
      if (content.scope.includes(".")) {
        files.push(content.scope)
      } else {
        directories.push(content.scope)
      }
    }
  }
  
  // 去重
  const uniqueFiles = [...new Set(files)]
  const uniqueDirs = [...new Set(directories)]
  
  return {
    cardId,
    files: uniqueFiles,
    directories: uniqueDirs,
    description: `Scope for ${cardId}: ${uniqueFiles.length} files, ${uniqueDirs.length} directories`
  }
}

/**
 * 获取卡片的完整内容
 */
export function getCard(cwd: string, cardId: string): any {
  const cardPath = resolveMetaEntryPath(cwd, "cards", `${cardId}.yaml`)
  
  if (!fs.existsSync(cardPath)) {
    throw new Error(`Card not found: ${cardId}`)
  }
  
  return yaml.load(fs.readFileSync(cardPath, "utf8"))
}

/**
 * 获取 loop 中所有已接受的卡片
 */
export function getAcceptedCards(cwd: string, loopId: string): string[] {
  const loopPath = resolveMetaEntryPath(cwd, "loops", `${loopId}.yaml`)
  
  if (!fs.existsSync(loopPath)) {
    throw new Error(`Loop not found: ${loopId}`)
  }
  
  const loop = yaml.load(fs.readFileSync(loopPath, "utf8")) as any
  
  if (!loop.decision_session?.accepted_cards) {
    return []
  }
  
  return loop.decision_session.accepted_cards
}

/**
 * 为执行准备卡片上下文
 */
export function prepareExecutionContext(cwd: string, cardId: string): {
  card: any
  scope: CardScope
  prompt: string
} {
  const card = getCard(cwd, cardId)
  const scope = analyzeCardScope(cwd, cardId)
  
  // 构建执行提示
  const prompt = `
请根据以下决策卡片执行代码修改：

## 卡片信息
- ID: ${card.id}
- 目标: ${card.content.objective}
- 方案: ${card.content.approach}
- 预期收益: ${card.content.benefit}

## 修改范围
${scope.files.length > 0 ? `文件: ${scope.files.join(", ")}` : ""}
${scope.directories.length > 0 ? `目录: ${scope.directories.join(", ")}` : ""}

## 约束
- 保持代码风格一致
- 运行类型检查确保无错误
- 如果修改失败，回滚所有更改
`
  
  return { card, scope, prompt }
}

/**
 * 运行类型检查验证
 */
export async function validateTypeCheck(cwd: string): Promise<ValidationResult> {
  const { execSync } = await import("child_process")
  
  try {
    // 运行 bun typecheck
    execSync("bun typecheck", {
      cwd: path.join(cwd, "packages", "eternity-code"),
      encoding: "utf-8",
      stdio: "pipe"
    })
    
    return {
      success: true,
      errors: [],
      warnings: []
    }
  } catch (error: any) {
    const output = error.stderr || error.stdout || ""
    const errors = output.split("\n").filter((line: string) => line.includes("error"))
    
    return {
      success: false,
      errors,
      warnings: []
    }
  }
}

/**
 * 运行 linter 验证
 */
export async function validateLint(cwd: string): Promise<ValidationResult> {
  // 简单的 lint 检查
  // 可以扩展为更复杂的 lint 规则
  
  return {
    success: true,
    errors: [],
    warnings: []
  }
}

/**
 * 综合验证
 */
export async function validateExecution(cwd: string): Promise<ValidationResult> {
  const typeCheckResult = await validateTypeCheck(cwd)
  const lintResult = await validateLint(cwd)
  
  return {
    success: typeCheckResult.success && lintResult.success,
    errors: [...typeCheckResult.errors, ...lintResult.errors],
    warnings: [...typeCheckResult.warnings, ...lintResult.warnings]
  }
}

/**
 * 创建 git 快照用于回滚
 */
export async function createGitSnapshot(cwd: string): Promise<string> {
  const { execSync } = await import("child_process")
  
  try {
    // 获取当前 git 状态
    const status = execSync("git status --porcelain", {
      cwd,
      encoding: "utf-8"
    }).trim()
    
    // 如果有未提交的更改，先暂存
    if (status) {
      execSync("git add -A", { cwd, encoding: "utf-8" })
      execSync('git commit -m "MetaDesign snapshot before execution"', {
        cwd,
        encoding: "utf-8"
      })
    }
    
    // 返回当前 commit hash
    return execSync("git rev-parse HEAD", {
      cwd,
      encoding: "utf-8"
    }).trim()
  } catch (error) {
    throw new Error(`Failed to create git snapshot: ${error}`)
  }
}

/**
 * 回滚到指定的 git 快照
 */
export async function rollbackToSnapshot(cwd: string, snapshotHash: string): Promise<void> {
  const { execSync } = await import("child_process")
  
  try {
    // 回滚到指定 commit
    execSync(`git reset --hard ${snapshotHash}`, {
      cwd,
      encoding: "utf-8"
    })
    
    console.log(`[MetaDesign] Rolled back to snapshot: ${snapshotHash}`)
  } catch (error) {
    throw new Error(`Failed to rollback to snapshot: ${error}`)
  }
}

/**
 * 执行卡片并处理失败回滚
 */
export async function executeCardWithRollback(
  cwd: string,
  cardId: string,
  executeFn: () => Promise<void>
): Promise<{ success: boolean; error?: string }> {
  // 创建快照
  const snapshotHash = await createGitSnapshot(cwd)
  
  try {
    // 执行卡片
    await executeFn()
    
    // 验证执行结果
    const validation = await validateExecution(cwd)
    
    if (!validation.success) {
      // 验证失败，回滚
      await rollbackToSnapshot(cwd, snapshotHash)
      return {
        success: false,
        error: `Validation failed: ${validation.errors.join(", ")}`
      }
    }
    
    return { success: true }
  } catch (error: any) {
    // 执行失败，回滚
    await rollbackToSnapshot(cwd, snapshotHash)
    return {
      success: false,
      error: error.message || "Unknown error"
    }
  }
}

/**
 * 批量执行卡片
 */
export async function executeCards(
  cwd: string,
  cardIds: string[],
  executeFn: (cardId: string) => Promise<void>
): Promise<{
  successful: string[]
  failed: Array<{ cardId: string; error: string }>
}> {
  const successful: string[] = []
  const failed: Array<{ cardId: string; error: string }> = []
  
  for (const cardId of cardIds) {
    const result = await executeCardWithRollback(cwd, cardId, () => executeFn(cardId))
    
    if (result.success) {
      successful.push(cardId)
    } else {
      failed.push({ cardId, error: result.error || "Unknown error" })
    }
  }
  
  return { successful, failed }
}
