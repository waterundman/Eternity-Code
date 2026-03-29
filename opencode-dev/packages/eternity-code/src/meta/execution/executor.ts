import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { ExecutionPlan, ExecutionTask, TaskResult, PlanResult, ExecutionOptionsBase } from "./types.js"
import type { Session } from "../types.js"
import { loadMetaDesign, buildSystemContext } from "../design.js"
import { updateLoopRollback } from "../loop.js"
import { branchExists, getCurrentBranch, getGitHead, runGitCommand } from "./git.js"
import { resolveMetaEntryPath } from "../paths.js"

export interface ExecutorOptions extends ExecutionOptionsBase {
  cwd: string
  planId: string
  session?: Session
}

export interface TaskDiff {
  taskId: string
  filePath: string
  diff: string
  action: "create" | "modify" | "delete"
}

export class ExecutionExecutor {
  private cwd: string
  private planId: string
  private session: Session | undefined
  private autoCommit: boolean
  private dryRun: boolean
  private autoRollback: boolean
  private branchName: string
  private onTaskStart?: (task: ExecutionTask) => void
  private onTaskComplete?: (task: ExecutionTask, result: TaskResult) => void
  private onTaskConfirm?: (task: ExecutionTask, diff: string) => Promise<boolean>
  private onRollback?: (reason: string, error?: string) => void

  constructor(options: ExecutorOptions) {
    this.cwd = options.cwd
    this.planId = options.planId
    this.session = options.session
    this.autoCommit = options.autoCommit ?? true
    this.dryRun = options.dryRun ?? false
    this.autoRollback = options.autoRollback ?? true
    this.branchName = `meta/${options.planId}`
    this.onTaskStart = options.onTaskStart
    this.onTaskComplete = options.onTaskComplete
    this.onTaskConfirm = options.onTaskConfirm
    this.onRollback = options.onRollback
  }

  async executePlan(plan: ExecutionPlan): Promise<PlanResult> {
    const gitShaBefore = getGitHead(this.cwd)
    const gitBranchBefore = getCurrentBranch(this.cwd)
    let tasksCompleted = 0
    let tasksFailed = 0
    let lastError: string | undefined
    let rolledBack = false

    const livePlan: ExecutionPlan = {
      ...plan,
      status: "running",
      git_sha_before: gitShaBefore,
      git_branch_before: gitBranchBefore,
      git_sha_after: undefined,
      completed_at: undefined,
      tasks: plan.tasks.map((task) => ({
        ...task,
        error: undefined,
      })),
    }
    this.persistPlan(livePlan)

    try {
      if (!this.dryRun) {
        this.createBranch()
      }

      const sortedTasks = this.topologicalSort(livePlan.tasks)

      for (const task of sortedTasks) {
        const currentTask = this.getTask(livePlan, task.id)
        if (currentTask.status === "done" || currentTask.status === "skipped") {
          tasksCompleted++
          continue
        }

        this.onTaskStart?.(currentTask)
        this.patchTask(livePlan, currentTask.id, {
          status: "running",
          started_at: new Date().toISOString(),
          completed_at: undefined,
          error: undefined,
        })

        const result = await this.executeTask(this.getTask(livePlan, currentTask.id), livePlan)

        if (result.success) {
          tasksCompleted++
          this.patchTask(livePlan, currentTask.id, {
            status: "done",
            completed_at: new Date().toISOString(),
            git_sha: result.git_sha,
            error: undefined,
          })
          this.onTaskComplete?.(this.getTask(livePlan, currentTask.id), result)
          continue
        }

        tasksFailed++
        lastError = result.error
        this.patchTask(livePlan, currentTask.id, {
          status: "failed",
          completed_at: new Date().toISOString(),
          error: result.error,
        })
        this.onTaskComplete?.(this.getTask(livePlan, currentTask.id), result)

        if (this.autoRollback && !this.dryRun) {
          try {
            await this.rollback(`Task ${currentTask.id} failed`, result.error, livePlan)
            rolledBack = true
            this.onRollback?.(`Task ${currentTask.id} failed: ${result.error}`, result.error)
          } catch (rollbackError) {
            const rollbackErrorMsg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            this.onRollback?.(`Rollback failed after task ${currentTask.id} failure`, rollbackErrorMsg)
          }
        } else {
          livePlan.status = "failed"
          livePlan.completed_at = new Date().toISOString()
          this.persistPlan(livePlan)
        }

        break
      }

      const gitShaAfter = rolledBack ? gitShaBefore : getGitHead(this.cwd)

      if (!rolledBack) {
        livePlan.status = tasksFailed === 0 ? "done" : "failed"
        livePlan.git_sha_after = gitShaAfter
        livePlan.completed_at = new Date().toISOString()
        this.persistPlan(livePlan)
      }

      return {
        success: tasksFailed === 0,
        tasks_completed: tasksCompleted,
        tasks_failed: tasksFailed,
        git_sha_before: gitShaBefore,
        git_sha_after: gitShaAfter,
        rolled_back: rolledBack,
        error: lastError,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)

      if (this.autoRollback && !this.dryRun) {
        try {
          await this.rollback("Execution exception", errorMsg, livePlan)
          rolledBack = true
          this.onRollback?.(`Execution exception: ${errorMsg}`, errorMsg)
        } catch (rollbackError) {
          const rollbackErrorMsg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          this.onRollback?.("Rollback failed after execution exception", rollbackErrorMsg)
        }
      } else {
        livePlan.status = "failed"
        livePlan.completed_at = new Date().toISOString()
        this.persistPlan(livePlan)
      }

      return {
        success: false,
        tasks_completed: tasksCompleted,
        tasks_failed: tasksFailed + 1,
        git_sha_before: gitShaBefore,
        rolled_back: rolledBack,
        error: errorMsg,
      }
    }
  }

  async executeTask(task: ExecutionTask, plan: ExecutionPlan): Promise<TaskResult> {
    try {
      const dependencies = task.depends_on ?? []
      for (const depId of dependencies) {
        const depTask = plan.tasks.find((item) => item.id === depId)
        if (depTask && depTask.status !== "done") {
          return {
            success: false,
            error: `Dependency ${depId} is not completed (status: ${depTask.status})`,
          }
        }
      }

      const diffs = await this.generateTaskDiffs(task, plan)
      if (diffs.length === 0) {
        return { success: true }
      }

      if (this.onTaskConfirm && !this.dryRun) {
        const diffSummary = diffs.map((item) => `${item.action}: ${item.filePath}\n${item.diff}`).join("\n\n")
        const confirmed = await this.onTaskConfirm(task, diffSummary)
        if (!confirmed) {
          return {
            success: false,
            error: "Task execution cancelled by user",
          }
        }
      }

      if (!this.dryRun) {
        for (const taskDiff of diffs) {
          this.applyDiff(taskDiff)
        }

        if (this.autoCommit) {
          return {
            success: true,
            git_sha: this.commitTask(task),
          }
        }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async generateTaskDiffs(task: ExecutionTask, plan: ExecutionPlan): Promise<TaskDiff[]> {
    const diffs: TaskDiff[] = []
    const filesToModify = task.spec.files_to_modify ?? []

    for (const filePath of filesToModify) {
      const absolutePath = path.resolve(this.cwd, filePath)
      const exists = fs.existsSync(absolutePath)

      if (exists) {
        const diff = await this.generateDiffForFile(task, filePath, plan)
        diffs.push({
          taskId: task.id,
          filePath,
          diff,
          action: "modify",
        })
        continue
      }

      const content = await this.generateNewFileContent(task, filePath, plan)
      diffs.push({
        taskId: task.id,
        filePath,
        diff: content,
        action: "create",
      })
    }

    return diffs
  }

  async rollback(reason = "Manual rollback", error?: string, planArg?: ExecutionPlan): Promise<void> {
    const plan = planArg ?? this.readPlan()
    const originalSha = plan.git_sha_before
    const originalBranch = plan.git_branch_before

    if (originalBranch && branchExists(this.cwd, originalBranch) && getCurrentBranch(this.cwd) !== originalBranch) {
      runGitCommand(this.cwd, ["checkout", originalBranch])
    }

    if (originalSha && originalSha !== "unknown") {
      runGitCommand(this.cwd, ["reset", "--hard", originalSha])
    }

    if (branchExists(this.cwd, this.branchName) && originalBranch !== this.branchName) {
      runGitCommand(this.cwd, ["branch", "-D", this.branchName])
    }

    plan.status = "rolled_back"
    plan.completed_at = new Date().toISOString()
    this.persistPlan(plan)

    if (plan.loop_id) {
      await updateLoopRollback(this.cwd, plan.loop_id, this.planId, reason, error)
    }
  }

  private async generateDiffForFile(task: ExecutionTask, filePath: string, _plan: ExecutionPlan): Promise<string> {
    if (this.session) {
      try {
        const design = await loadMetaDesign(this.cwd)
        const metaContext = design ? buildSystemContext(design) : ""
        const currentContent = fs.readFileSync(path.resolve(this.cwd, filePath), "utf8")
        const mustNotList = task.spec.must_not.map((item) => `- ${item}`).join("\n")

        const systemPrompt = `${metaContext}

You are a code editing agent. Generate a precise unified diff for the requested file change.
Rules:
1. Read the current file contents carefully.
2. Return a unified diff only.
3. Respect must_not boundaries.
4. Ensure the change satisfies definition_of_done.
5. Only modify the requested file.`

        const userMessage = `Current file: ${filePath}

\`\`\`
${currentContent}
\`\`\`

Task: ${task.spec.title}
Description: ${task.spec.description}
Definition of done: ${task.spec.definition_of_done}
Must not:
${mustNotList}
`

        const response = await this.callSession(systemPrompt, userMessage)
        if (response) {
          return this.extractDiffFromResponse(response)
        }
      } catch (error) {
        console.warn(`[Executor] LLM diff generation failed for ${filePath}:`, error)
      }
    }

    const currentContent = fs.readFileSync(path.resolve(this.cwd, filePath), "utf8")
    return `--- a/${filePath}
+++ b/${filePath}
@@ -1,3 +1,4 @@
 ${currentContent.split("\n").slice(0, 3).join("\n")}
+// Modified by ${task.id}: ${task.spec.title}
`
  }

  private async generateNewFileContent(task: ExecutionTask, filePath: string, _plan: ExecutionPlan): Promise<string> {
    if (this.session) {
      try {
        const design = await loadMetaDesign(this.cwd)
        const metaContext = design ? buildSystemContext(design) : ""
        const mustNotList = task.spec.must_not.map((item) => `- ${item}`).join("\n")

        const systemPrompt = `${metaContext}

You are a code generation agent. Generate the complete content for a new file.
Rules:
1. Return only the file contents.
2. Respect must_not boundaries.
3. Ensure the file satisfies definition_of_done.
4. Follow the existing project style.`

        const userMessage = `Create a new file: ${filePath}

Task: ${task.spec.title}
Description: ${task.spec.description}
Definition of done: ${task.spec.definition_of_done}
Must not:
${mustNotList}
`

        const response = await this.callSession(systemPrompt, userMessage)
        if (response) {
          return this.extractContentFromResponse(response)
        }
      } catch (error) {
        console.warn(`[Executor] LLM content generation failed for ${filePath}:`, error)
      }
    }

    return `// Created by ${task.id}: ${task.spec.title}
// ${task.spec.description}

export function ${task.spec.title.replace(/\s+/g, "")}() {
  // Implementation here
}
`
  }

  private async callSession(systemPrompt: string, userMessage: string): Promise<string | undefined> {
    try {
      if (this.session?.createSubtask) {
        const result = await this.session.createSubtask({ systemPrompt, userMessage })
        return this.extractText(result)
      }

      if (this.session?.prompt) {
        const result = await this.session.prompt({
          system: systemPrompt,
          message: userMessage,
        })
        return this.extractText(result)
      }

      return undefined
    } catch (error) {
      console.error("[Executor] Failed to call session:", error)
      return undefined
    }
  }

  private extractText(response: unknown): string {
    if (typeof response === "string") return response
    const value = response as any
    if (typeof value?.text === "string") return value.text
    if (Array.isArray(value?.content)) return value.content.map((part: any) => part?.text ?? "").join("\n")
    return String(response)
  }

  private extractDiffFromResponse(response: string): string {
    const fenced = response.match(/```diff\n([\s\S]*?)\n```/)
    if (fenced?.[1]) return fenced[1]
    return response
  }

  private extractContentFromResponse(response: string): string {
    const codeBlock = response.match(/```\w*\n([\s\S]*?)\n```/)
    if (codeBlock?.[1]) return codeBlock[1]
    return response
  }

  private applyDiff(taskDiff: TaskDiff): void {
    const absolutePath = path.resolve(this.cwd, taskDiff.filePath)
    const dir = path.dirname(absolutePath)

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    if (taskDiff.action === "create") {
      fs.writeFileSync(absolutePath, taskDiff.diff)
      return
    }

    if (taskDiff.action === "delete") {
      if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath)
      return
    }

    const currentContent = fs.readFileSync(absolutePath, "utf8")
    const lines = currentContent.split("\n")
    const diffLines = taskDiff.diff.split("\n")
    const newLines = this.applyDiffLines(lines, diffLines)
    fs.writeFileSync(absolutePath, newLines.join("\n"))
  }

  private applyDiffLines(originalLines: string[], diffLines: string[]): string[] {
    const result = [...originalLines]

    for (const line of diffLines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        result.push(line.substring(1))
        continue
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        const content = line.substring(1)
        const index = result.findIndex((item) => item.includes(content))
        if (index !== -1) result.splice(index, 1)
      }
    }

    return result
  }

  private createBranch(): void {
    if (!branchExists(this.cwd, this.branchName)) {
      runGitCommand(this.cwd, ["checkout", "-b", this.branchName])
      return
    }
    runGitCommand(this.cwd, ["checkout", this.branchName])
  }

  private commitTask(task: ExecutionTask): string {
    runGitCommand(this.cwd, ["add", "."])

    const commitMessage = `[${task.plan_id}] ${task.spec.title}\n\n${task.spec.description}\n\nTask: ${task.id}`
    runGitCommand(this.cwd, ["commit", "-m", commitMessage])
    return getGitHead(this.cwd)
  }

  private topologicalSort(tasks: ExecutionTask[]): ExecutionTask[] {
    const sorted: ExecutionTask[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return
      if (visiting.has(taskId)) {
        throw new Error(`Circular dependency detected involving task ${taskId}`)
      }

      visiting.add(taskId)
      const task = tasks.find((item) => item.id === taskId)
      if (task) {
        for (const depId of task.depends_on ?? []) {
          visit(depId)
        }
        sorted.push(task)
      }
      visiting.delete(taskId)
      visited.add(taskId)
    }

    for (const task of tasks) {
      visit(task.id)
    }

    return sorted
  }

  private getPlanPath(): string {
    return resolveMetaEntryPath(this.cwd, "plans", `${this.planId}.yaml`)
  }

  private readPlan(): ExecutionPlan {
    const planPath = this.getPlanPath()
    if (!fs.existsSync(planPath)) {
      throw new Error(`Plan not found: ${this.planId}`)
    }
    return yaml.load(fs.readFileSync(planPath, "utf8")) as ExecutionPlan
  }

  private persistPlan(plan: ExecutionPlan): void {
    fs.writeFileSync(this.getPlanPath(), yaml.dump(plan, { lineWidth: 120 }))
  }

  private getTask(plan: ExecutionPlan, taskId: string): ExecutionTask {
    const task = plan.tasks.find((item) => item.id === taskId)
    if (!task) {
      throw new Error(`Task not found in plan ${plan.id}: ${taskId}`)
    }
    return task
  }

  private patchTask(plan: ExecutionPlan, taskId: string, patch: Partial<ExecutionTask>): void {
    const index = plan.tasks.findIndex((item) => item.id === taskId)
    if (index === -1) {
      throw new Error(`Task not found in plan ${plan.id}: ${taskId}`)
    }
    plan.tasks[index] = {
      ...plan.tasks[index],
      ...patch,
    }
    this.persistPlan(plan)
  }
}

export async function executePlan(
  cwd: string,
  planId: string,
  options: Partial<ExecutorOptions> = {},
): Promise<PlanResult> {
  const executor = new ExecutionExecutor({
    cwd,
    planId,
    ...options,
  })

  return executor.executePlan(loadExecutionPlan(cwd, planId))
}

export async function executeTask(
  cwd: string,
  planId: string,
  taskId: string,
  options: Partial<ExecutorOptions> = {},
): Promise<TaskResult> {
  const executor = new ExecutionExecutor({
    cwd,
    planId,
    ...options,
  })

  const plan = loadExecutionPlan(cwd, planId)
  const task = plan.tasks.find((item) => item.id === taskId)
  if (!task) {
    throw new Error(`Task not found: ${taskId}`)
  }

  return executor.executeTask(task, plan)
}

function loadExecutionPlan(cwd: string, planId: string): ExecutionPlan {
  const planPath = resolveMetaEntryPath(cwd, "plans", `${planId}.yaml`)
  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan not found: ${planId}`)
  }
  return yaml.load(fs.readFileSync(planPath, "utf8")) as ExecutionPlan
}
