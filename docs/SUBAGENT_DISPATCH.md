# Eternity Code — Sub-agent 调度层设计文档

本文件描述 Eternity Code 的 sub-agent 调度层（Agent Dispatch Layer）。
这不是一次性的改造任务，而是一份**持续迭代的架构基础**。
opencode 读到这份文档后，应当理解整个调度层的设计意图，
并在后续每次收到"增加一个新 sub-agent"的需求时，
自然地在这个框架内扩展，而不是在各处散落地手写 `createSubtask`。

---

## 为什么需要调度层

Eternity Code 的整个 loop 流程里，越来越多的环节需要独立的 agent 来完成：
卡片评分、覆盖度评估、Plan 分解、Task 执行、LLM eval 打分……

如果每个地方都手写调用逻辑，会产生三个问题：

1. **MetaDesign context 注入不一致**——有的 sub-agent 拿到了完整约束，有的没有
2. **无法追踪**——sub-agent 干了什么、花了多久、输出了什么，没有统一记录
3. **无法复用**——同一个"评分 agent"在不同地方被重复定义

调度层解决这三个问题：统一注入、统一记录、统一注册。

---

## 核心概念

### AgentRole（角色定义）

每个 sub-agent 在注册时声明自己是谁、能做什么、需要什么输入、输出什么格式。

```typescript
interface AgentRole {
  id: string                    // 唯一标识，如 "card-reviewer"
  name: string                  // 显示名称
  description: string           // 这个 agent 做什么

  // 这个 agent 需要哪些 MetaDesign 上下文
  // 不是所有 agent 都需要全量注入——按需声明减少 token 消耗
  context_needs: Array<
    | "core_value"              // project.core_value + anti_value
    | "requirements"            // 所有 REQ + coverage
    | "constraints"             // 硬约束
    | "negatives"               // 负空间列表
    | "eval_factors"            // 评估因子 + baseline
    | "loop_history"            // 历史 loop 摘要
    | "none"                    // 不需要 MetaDesign 上下文
  >

  system_prompt: string         // 这个 agent 的固定系统 prompt
  output_format: string         // 期望的输出格式说明（给 agent 看的）
  output_parser: string         // 解析器 id，指向 parsers/ 里的函数
  timeout_ms?: number           // 超时，默认 60000
}
```

### AgentTask（一次调用）

```typescript
interface AgentTask {
  id: string                    // "task-{uuid}"
  role_id: string               // 使用哪个 AgentRole
  triggered_by: string          // 谁触发的，如 "loop-004" / "CARD-041"
  input: Record<string, unknown>// 传入的动态数据

  status: "pending" | "running" | "done" | "failed"
  output?: unknown              // 解析后的结构化输出
  raw_output?: string           // 原始文本输出，调试用
  error?: string
  started_at?: string
  completed_at?: string
  duration_ms?: number
}
```

### Dispatcher（调度器）

调度器是唯一的调用入口。所有 sub-agent 调用都通过它。

```typescript
interface Dispatcher {
  dispatch<T>(roleId: string, input: Record<string, unknown>): Promise<T>
}
```

调用方不需要关心：context 怎么注入、结果怎么解析、调用记录怎么写。
这些全在调度器内部处理。

---

## 文件结构

```
packages/opencode/src/meta/
  agents/
    registry.ts          ← 所有 AgentRole 的注册表
    dispatcher.ts        ← 调度器核心逻辑
    context-builder.ts   ← 按 context_needs 组装 MetaDesign context
    parsers/
      index.ts           ← 解析器注册表
      card-review.ts     ← 解析卡片评分结果
      coverage.ts        ← 解析覆盖度评估结果
      plan.ts            ← 解析 Plan 分解结果（迁移自 planner.ts）
      eval-score.ts      ← 解析 LLM eval 打分结果
    roles/
      card-reviewer.ts   ← CardReviewer 角色定义
      coverage-assessor.ts
      planner.ts         ← 迁移自 execution/planner.ts
      task-executor.ts
      eval-scorer.ts
      prediction-auditor.ts
  .meta/
    agent-tasks/
      task-{uuid}.yaml   ← 每次 sub-agent 调用的完整记录
```

---

## 实现：context-builder.ts

```typescript
import type { MetaDesign } from "../types.js"
import type { AgentRole } from "./registry.js"

export function buildAgentContext(
  design: MetaDesign | null,
  needs: AgentRole["context_needs"]
): string {
  if (!design || needs.includes("none")) return ""

  const parts: string[] = ["=== MetaDesign Context ==="]

  if (needs.includes("core_value")) {
    parts.push(`Core value: ${design.project.core_value}`)
    parts.push(`Anti value: ${design.project.anti_value}`)
    parts.push(`Stage: ${design.project.stage}`)
  }

  if (needs.includes("requirements")) {
    parts.push("\nRequirements:")
    for (const r of design.requirements ?? []) {
      const pct = ((r.coverage ?? 0) * 100).toFixed(0)
      parts.push(`  [${r.id}] ${pct}% coverage — ${r.text}`)
      if (r.coverage_note) parts.push(`         ↳ ${r.coverage_note}`)
    }
  }

  if (needs.includes("constraints")) {
    const c = design.constraints
    if (c?.compliance?.length) {
      parts.push("\nCompliance (never violate):")
      c.compliance.forEach(rule => parts.push(`  • ${rule}`))
    }
    if (c?.immutable_modules?.length) {
      parts.push("\nImmutable modules (never modify):")
      c.immutable_modules.forEach(m => parts.push(`  • ${m.path}`))
    }
  }

  if (needs.includes("negatives")) {
    const active = (design.rejected_directions ?? []).filter(n => n.status === "active")
    if (active.length) {
      parts.push("\nRejected directions (do NOT propose these):")
      active.forEach(n => {
        parts.push(`  [${n.id}] ${n.text}`)
        parts.push(`         reason: ${n.reason}`)
      })
    }
  }

  if (needs.includes("eval_factors")) {
    const factors = (design.eval_factors ?? []).filter(
      f => f.role.type === "objective" || f.role.type === "guardrail"
    )
    if (factors.length) {
      parts.push("\nEval baselines:")
      factors.forEach(f => {
        const role = f.role.type === "guardrail" ? "🔒" : "🎯"
        parts.push(`  ${role} ${f.name}: ${f.threshold.baseline} (target: ${f.threshold.target}, floor: ${f.threshold.floor})`)
      })
    }
  }

  if (needs.includes("loop_history")) {
    const last = design.loop_history?.loops?.slice(0, 3)
    if (last?.length) {
      parts.push("\nRecent loops:")
      last.forEach(l => {
        const d = (l.composite_score_delta ?? 0) > 0
          ? `+${l.composite_score_delta}` : String(l.composite_score_delta)
        parts.push(`  ${l.loop_id} ${d} — ${l.summary ?? ""}`)
      })
    }
  }

  parts.push("=== End MetaDesign Context ===\n")
  return parts.join("\n")
}
```

---

## 实现：dispatcher.ts

```typescript
import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import { randomUUID } from "crypto"
import { getRole } from "./registry.js"
import { buildAgentContext } from "./context-builder.js"
import { getParser } from "./parsers/index.js"
import { loadMetaDesign } from "../index.js"
import type { AgentTask } from "./types.js"

export class Dispatcher {
  constructor(
    private cwd: string,
    private session: any          // opencode session API
  ) {}

  async dispatch<T>(
    roleId: string,
    input: Record<string, unknown>,
    triggeredBy: string = "manual"
  ): Promise<T> {
    const role = getRole(roleId)
    if (!role) throw new Error(`Unknown agent role: ${roleId}`)

    const taskId = `task-${randomUUID().slice(0, 8)}`
    const design = await loadMetaDesign(this.cwd)

    // 按角色声明的 context_needs 组装注入
    const metaContext = buildAgentContext(design, role.context_needs)

    // 构造完整 system prompt
    const systemPrompt = metaContext
      ? `${metaContext}\n\n${role.system_prompt}`
      : role.system_prompt

    // 构造 user message（角色定义里的 output_format 追加到末尾）
    const userMessage = buildUserMessage(input, role.output_format)

    // 写入任务开始记录
    const task: AgentTask = {
      id: taskId,
      role_id: roleId,
      triggered_by: triggeredBy,
      input,
      status: "running",
      started_at: new Date().toISOString(),
    }
    this.writeTask(task)

    const startMs = Date.now()

    try {
      // 调用 fresh context sub-agent
      const response = await Promise.race([
        this.session.createSubtask({ systemPrompt, userMessage }),
        timeout(role.timeout_ms ?? 60000, `${roleId} timed out`),
      ])

      const rawOutput = extractText(response)
      const parser = getParser(role.output_parser)
      const output = parser(rawOutput) as T

      // 写入完成记录
      task.status = "done"
      task.output = output
      task.raw_output = rawOutput
      task.completed_at = new Date().toISOString()
      task.duration_ms = Date.now() - startMs
      this.writeTask(task)

      return output

    } catch (err) {
      task.status = "failed"
      task.error = err instanceof Error ? err.message : String(err)
      task.completed_at = new Date().toISOString()
      task.duration_ms = Date.now() - startMs
      this.writeTask(task)
      throw err
    }
  }

  private writeTask(task: AgentTask): void {
    const dir = path.join(this.cwd, ".meta", "agent-tasks")
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const p = path.join(dir, `${task.id}.yaml`)
    fs.writeFileSync(p, yaml.dump(task, { lineWidth: 120 }))
  }
}

function buildUserMessage(
  input: Record<string, unknown>,
  outputFormat: string
): string {
  const inputSection = Object.entries(input)
    .map(([k, v]) => `${k}:\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`)
    .join("\n\n")
  return `${inputSection}\n\n---\n输出格式要求：\n${outputFormat}`
}

function extractText(response: unknown): string {
  if (typeof response === "string") return response
  const r = response as any
  if (typeof r?.text === "string") return r.text
  if (Array.isArray(r?.content))
    return r.content.map((c: any) => c?.text ?? "").join("\n")
  return String(response)
}

function timeout(ms: number, msg: string): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(msg)), ms)
  )
}
```

---

## 实现：registry.ts

```typescript
import type { AgentRole } from "./types.js"

const roles = new Map<string, AgentRole>()

export function registerRole(role: AgentRole): void {
  roles.set(role.id, role)
}

export function getRole(id: string): AgentRole | undefined {
  return roles.get(id)
}

export function listRoles(): AgentRole[] {
  return Array.from(roles.values())
}

// 自动加载所有 roles/ 目录下的角色定义
// 在 dispatcher.ts 第一次实例化时调用
export async function loadAllRoles(): Promise<void> {
  const roleModules = [
    () => import("./roles/card-reviewer.js"),
    () => import("./roles/coverage-assessor.js"),
    () => import("./roles/planner.js"),
    () => import("./roles/task-executor.js"),
    () => import("./roles/eval-scorer.js"),
    () => import("./roles/prediction-auditor.js"),
  ]
  for (const load of roleModules) {
    const mod = await load()
    if (mod.default) registerRole(mod.default)
  }
}
```

---

## 实现：六个内置角色

### roles/card-reviewer.ts

```typescript
import type { AgentRole } from "../types.js"

export default {
  id: "card-reviewer",
  name: "Card Reviewer",
  description: "对主 agent 生成的决策卡片进行独立评分，提供第二视角",
  context_needs: ["core_value", "requirements", "constraints", "negatives", "eval_factors"],
  system_prompt: `你是一个代码审查 agent，专门评估 MetaDesign 决策卡片的质量。
你不知道这张卡片是谁生成的。你的职责是独立判断：
1. 这张卡片是否真的指向了最重要的覆盖度缺口
2. 预期收益是否合理，还是被高估了
3. 是否存在未被声明的风险
4. 是否与任何 rejected_direction 存在隐性冲突（不只是字面匹配）
你的评分会直接呈现给做决策的人类，请保持客观。`,
  output_format: `严格输出以下格式，不要有其他内容：
---REVIEW START---
alignment_score: （0-10，与核心需求的对齐程度）
feasibility_score: （0-10，技术可行性）
risk_score: （0-10，10=高风险）
confidence_calibration: （over/fair/under，对提案方置信度的判断）
hidden_risks:
  - （未被声明的风险，没有则写 none）
neg_conflicts:
  - （可能触碰的 rejected_direction id，没有则写 none）
reviewer_note: （一句话总结）
---REVIEW END---`,
  output_parser: "card-review",
  timeout_ms: 30000,
} satisfies AgentRole
```

### roles/coverage-assessor.ts

```typescript
import type { AgentRole } from "../types.js"

export default {
  id: "coverage-assessor",
  name: "Coverage Assessor",
  description: "评估当前代码库对每条元需求的覆盖程度",
  context_needs: ["requirements", "constraints"],
  system_prompt: `你是一个代码分析 agent。
你的任务是阅读提供的代码文件，然后对每条元需求给出覆盖度评分（0.0-1.0）。
评分标准：
0.0 = 完全没有实现
0.3 = 有相关代码但功能不完整
0.6 = 主要功能实现，边缘情况未覆盖
0.8 = 基本完整，有小的缺失
1.0 = 完全实现
每个评分必须附上一句依据。`,
  output_format: `严格输出以下格式：
---COVERAGE START---
req_id: REQ-001
score: 0.74
note: （一句依据）
---COVERAGE END---
（每条 REQ 一个块）`,
  output_parser: "coverage",
  timeout_ms: 45000,
} satisfies AgentRole
```

### roles/eval-scorer.ts

```typescript
import type { AgentRole } from "../types.js"

export default {
  id: "eval-scorer",
  name: "Eval Scorer",
  description: "对 LLM eval 类型的评估因子进行打分",
  context_needs: ["none"],
  system_prompt: `你是一个评估 agent。
你会收到一段评估对象（通常是某个功能的输出样本）和一个评分标准。
你的任务是严格按照评分标准打分，只输出分数，不做任何解释。`,
  output_format: `只输出一个数字，例如：4`,
  output_parser: "eval-score",
  timeout_ms: 15000,
} satisfies AgentRole
```

### roles/prediction-auditor.ts

```typescript
import type { AgentRole } from "../types.js"

export default {
  id: "prediction-auditor",
  name: "Prediction Auditor",
  description: "对比卡片预测和实际执行结果，分析误差原因",
  context_needs: ["eval_factors", "loop_history"],
  system_prompt: `你是一个预测审计 agent。
你会收到一张决策卡片的预测数据和实际执行后的测量数据。
你的任务是：
1. 计算每个 eval factor 的预测误差
2. 判断误差的主要原因（assumption 失效/过度乐观/测量口径不一致/其他）
3. 给出下一轮提案时应该调整的建议
这个分析会被写入卡片的 outcome.lessons 字段，供下一个 loop 的 agent 参考。`,
  output_format: `严格输出以下格式：
---AUDIT START---
prediction_accuracy: （0.0-1.0，整体预测准确度）
factor_errors:
  - eval_id: EVAL-003
    predicted: "+0.8"
    actual: "+0.6"
    error_type: （over_optimistic/assumption_failed/measurement_mismatch/other）
    reason: （一句分析）
lessons:
  - （下一轮应该注意的点 1）
  - （下一轮应该注意的点 2）
---AUDIT END---`,
  output_parser: "prediction-audit",
  timeout_ms: 30000,
} satisfies AgentRole
```

---

## 实现：parsers/index.ts

```typescript
import { parseCardReview } from "./card-review.js"
import { parseCoverage } from "./coverage.js"
import { parsePlan } from "./plan.js"
import { parseEvalScore } from "./eval-score.js"
import { parsePredictionAudit } from "./prediction-audit.js"

const parsers: Record<string, (text: string) => unknown> = {
  "card-review": parseCardReview,
  "coverage": parseCoverage,
  "plan": parsePlan,
  "eval-score": parseEvalScore,
  "prediction-audit": parsePredictionAudit,
}

export function getParser(id: string): (text: string) => unknown {
  const p = parsers[id]
  if (!p) throw new Error(`Unknown parser: ${id}`)
  return p
}
```

每个 parser 文件读取对应格式的 `---BLOCK START/END---` 块，用 `js-yaml` 解析内容，返回类型化对象。实现模式与 `cards.ts` 里的 `parseCardsFromText` 完全一致，直接参照复用。

---

## 调用方式（改造后的对比）

**改造前（散落在各处）：**
```typescript
// 在 command.ts 里
const response = await session.createSubtask({
  systemPrompt: "你是一个评分 agent..." + metaContext,
  userMessage: buildPlannerPrompt(card, planId, metaContext),
})
const rawPlan = parsePlanFromText(extractText(response))

// 在别的文件里又写一遍类似的逻辑
```

**改造后（统一调用）：**
```typescript
import { Dispatcher } from "./agents/dispatcher.js"

const dispatcher = new Dispatcher(cwd, session)

// 生成卡片后立即触发评分
const review = await dispatcher.dispatch<CardReview>(
  "card-reviewer",
  { card: cardYaml },
  `CARD-${cardId}`
)

// 分解 Plan
const plan = await dispatcher.dispatch<ExecutionPlan>(
  "planner",
  { card: cardYaml, loop_id: loopId },
  loopId
)

// 执行 Task
const result = await dispatcher.dispatch<TaskResult>(
  "task-executor",
  { task: taskYaml, plan_summary: plan.interpretation },
  task.id
)
```

---

## 与现有代码的集成顺序

现有的 `execution/planner.ts` 和 `execution/runner.ts` 里已经有 sub-agent 调用逻辑。
集成时按以下顺序迁移，不要一次性重写：

```
step 1: 创建 agents/ 目录结构，实现 dispatcher.ts + registry.ts + context-builder.ts
step 2: 将 planner.ts 的 sub-agent 调用迁移到 dispatcher（最小改动验证可行性）
step 3: 将 runner.ts 的 task-executor 迁移
step 4: 在 command.ts 的卡片生成后插入 card-reviewer 调用
step 5: 在 loop close 阶段插入 prediction-auditor 调用
step 6: 将 eval_factor 的 llm_eval 类型评分迁移到 eval-scorer
```

每步完成后运行 `bun typecheck`，每步独立可回滚。

---

## 新增 AgentRole 的步骤（供 opencode 自然迭代时参考）

未来任何时候需要新增一个 sub-agent：

1. 在 `roles/` 下新建 `{role-id}.ts`，填写 `AgentRole` 对象
2. 在 `parsers/` 下新建对应解析器
3. 在 `parsers/index.ts` 注册解析器
4. 在 `registry.ts` 的 `loadAllRoles` 里加载新角色
5. 在需要调用的地方 `dispatcher.dispatch("role-id", input)`

不需要改 dispatcher.ts 本身。调度层对新角色完全开放，对核心逻辑完全关闭。

---

## Dashboard 集成

`/api/agent-tasks` 端点已预留（参考 DASHBOARD_INSTRUCTION.md）。
在 `.meta/agent-tasks/` 目录里，每次 sub-agent 调用都有一个完整的 YAML 记录。
Dashboard 的 Execution tab 可以展示每个 loop 触发了哪些 sub-agent、各自耗时多少、输出是什么。
这为后续的性能调优和 prompt 迭代提供了完整的可观测性。
