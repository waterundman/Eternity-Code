/**
 * Git 命令执行模块
 * 提供同步和异步的 Git 命令执行能力
 */

/**
 * 同步执行 Git 命令（阻塞事件循环，仅用于关键路径）
 */
export function runGitCommand(cwd: string, args: string[]): string {
  try {
    const proc = Bun.spawnSync(["git", ...args], { cwd })
    if (proc.exitCode !== 0) {
      const stderr = proc.stderr.toString()
      throw new Error(`Git command failed: git ${args.join(" ")}\n${stderr}`)
    }
    return proc.stdout.toString().trim()
  } catch (error) {
    if (error instanceof Error && error.message.includes("Git command failed")) {
      throw error
    }
    throw new Error(`Failed to execute git command: ${error}`)
  }
}

/**
 * 同步执行 Git 命令，失败时返回 undefined
 */
export function tryRunGitCommand(cwd: string, args: string[]): string | undefined {
  try {
    return runGitCommand(cwd, args)
  } catch {
    return undefined
  }
}

/**
 * 异步执行 Git 命令（不阻塞事件循环）
 */
export async function runGitCommandAsync(cwd: string, args: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd })
    const output = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      throw new Error(`Git command failed: git ${args.join(" ")}\n${stderr}`)
    }
    return output.trim()
  } catch (error) {
    if (error instanceof Error && error.message.includes("Git command failed")) {
      throw error
    }
    throw new Error(`Failed to execute git command: ${error}`)
  }
}

/**
 * 异步执行 Git 命令，失败时返回 undefined
 */
export async function tryRunGitCommandAsync(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await runGitCommandAsync(cwd, args)
  } catch {
    return undefined
  }
}

/**
 * 获取当前 Git HEAD commit SHA
 */
export function getGitHead(cwd: string): string {
  return tryRunGitCommand(cwd, ["rev-parse", "HEAD"]) ?? "unknown"
}

/**
 * 异步获取当前 Git HEAD commit SHA
 */
export async function getGitHeadAsync(cwd: string): Promise<string> {
  return await tryRunGitCommandAsync(cwd, ["rev-parse", "HEAD"]) ?? "unknown"
}

/**
 * 获取当前分支名称
 */
export function getCurrentBranch(cwd: string): string | undefined {
  const branch = tryRunGitCommand(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (!branch || branch === "HEAD") return undefined
  return branch
}

/**
 * 异步获取当前分支名称
 */
export async function getCurrentBranchAsync(cwd: string): Promise<string | undefined> {
  const branch = await tryRunGitCommandAsync(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (!branch || branch === "HEAD") return undefined
  return branch
}

/**
 * 检查分支是否存在
 */
export function branchExists(cwd: string, branchName: string): boolean {
  return Boolean(tryRunGitCommand(cwd, ["rev-parse", "--verify", branchName]))
}

/**
 * 异步检查分支是否存在
 */
export async function branchExistsAsync(cwd: string, branchName: string): Promise<boolean> {
  return Boolean(await tryRunGitCommandAsync(cwd, ["rev-parse", "--verify", branchName]))
}

/**
 * 检查工作区是否干净
 */
export function isWorkingDirectoryClean(cwd: string): boolean {
  const status = tryRunGitCommand(cwd, ["status", "--porcelain"])
  return !status || status.length === 0
}

/**
 * 异步检查工作区是否干净
 */
export async function isWorkingDirectoryCleanAsync(cwd: string): Promise<boolean> {
  const status = await tryRunGitCommandAsync(cwd, ["status", "--porcelain"])
  return !status || status.length === 0
}

/**
 * 获取默认分支名称
 */
export function getDefaultBranch(cwd: string): string {
  // 尝试从 origin/HEAD 获取
  const originHead = tryRunGitCommand(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"])
  if (originHead) {
    const parts = originHead.split("/")
    return parts[parts.length - 1]
  }

  // 尝试常见的默认分支名
  for (const name of ["main", "master"]) {
    if (branchExists(cwd, name)) {
      return name
    }
  }

  // 返回当前分支或 "main"
  return getCurrentBranch(cwd) ?? "main"
}
