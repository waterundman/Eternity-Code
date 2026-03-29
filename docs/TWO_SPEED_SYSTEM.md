# Eternity Code — 双速认知系统框架

本文件描述 Eternity Code 的两个核心系统论，
并给出在现有 MetaDesign 架构上的完整实现方案。
读完本文件后，opencode 应当能独立实现这两个系统。

---

## 系统论一：外化认知层（Docs-driven Context）

### 问题

LLM 没有跨会话记忆。每次启动都是空白状态。
当前 MetaDesign 的 `.meta/design.yaml` 解决了"产品约束"的持久化，
但没有解决"设计思考过程"的持久化。

人类开发者和 Claude 对话产生的洞察——为什么做这个决定、
排除了哪些方向、这个架构背后的推理链——这些比代码本身更有价值，
但现在全部消失在聊天历史里。

### 解法：四层文档结构

```
.meta/
  design.yaml          ← 已有：产品约束（最终结论）
  insights/            ← 新增：设计思考（推理过程）
    INS-001.yaml
    INS-002.yaml
  blueprints/          ← 新增：执行蓝图（当前意图）
    BLUEPRINT-current.yaml
    BLUEPRINT-v002.yaml
  logs/                ← 新增：执行日志（已发生事实）
    LOG-loop-001.md
    LOG-loop-002.md
```

每一层的信息密度不同：

```
对话（原始，高噪音）
  → insights（提炼，结构化）
    → blueprints（意图，可执行）
      → logs（事实，不可变）
        → 下一轮 agent 的输入
```

### insights/ — 设计洞察

从对话或实践中提炼的设计决策，不是需求，不是任务，
是"为什么这样设计"的推理链。

```yaml
# .meta/insights/INS-001.yaml
id: INS-001
title: "sub-agent 应该使用 fresh context 而不是在主 session 里执行"
source: "与 Claude 的对话，2025-03-19"
category: architecture   # architecture / product / process / technical

insight: |
  在主 session 里连续执行多个任务会导致 context rot——
  agent 在 50% context 之后开始走捷径，70% 之后开始幻觉。
  解法是每个原子任务开一个新的 fresh context sub-agent，
  通过 MetaDesign context 注入保持约束一致性，
  而不是依赖主 session 的记忆。

implications:
  - "所有 sub-agent 调用必须通过 Dispatcher，不能在主 session 里直接执行"
  - "每个 AgentRole 的 context_needs 必须明确声明，按需注入"
  - "sub-agent 的输出必须结构化，不能依赖主 session 解析原始文本"

related:
  - INS-002
  - design.yaml[search_policy]

status: adopted    # adopted / pending / rejected
adopted_in: "SUBAGENT_DISPATCH.md"
created_at: "2025-03-19"
```

### blueprints/ — 执行蓝图

当前阶段的整体执行意图。不是 task 列表，是方向声明。

SOTA 模型写蓝图，弱模型读蓝图执行。
蓝图是两个模型之间的**接口合约**。

```yaml
# .meta/blueprints/BLUEPRINT-current.yaml
version: "v003"
created_by: "codex/gpt-5.4"    # 或 "claude/sonnet"
created_at: "2025-03-20"
valid_until: "2025-04-01"       # 下次 SOTA 介入时更新

# 当前阶段的架构状态描述（弱模型的出发点）
current_state: |
  MetaDesign 核心层已完成（design.yaml schema + loop runner + card IO）。
  Sub-agent 调度层已设计，planner 和 runner 已实现。
  Dashboard 已实现基础版本（4 个 API + 单页前端）。
  尚未实现：card-reviewer、prediction-auditor、insights 层。

# 当前阶段的优先目标（弱模型的迭代方向）
priorities:
  - id: P1
    goal: "完成 sub-agent 调度层的六个内置角色"
    rationale: "调度层是后续所有功能的基础，必须先稳定"
    acceptance: "所有六个角色注册成功，dispatcher 能正确路由"

  - id: P2
    goal: "card-reviewer 接入 loop 主流程"
    rationale: "消除卡片自评分的偏差是本阶段最高价值的改进"
    acceptance: "每张卡片生成后自动触发 reviewer，dashboard 能展示双评分"

  - id: P3
    goal: "insights 层的读写机制"
    rationale: "外化认知层是整个双速系统的基础"
    acceptance: "loop 结束后可以手动写入 INS，下一个 loop 的 agent 能读取"

# 弱模型在迭代时的边界
constraints:
  - "不修改 design.yaml 的 schema（由 SOTA 负责 schema 演化）"
  - "不修改 dispatcher.ts 的核心调度逻辑"
  - "新功能必须在没有 .meta/ 的项目里静默跳过"

# 技术债观察（弱模型写日志时如果发现这些，记录在 LOG 里）
known_debt:
  - "command.ts 里的 readline 交互代码需要抽象成独立模块"
  - "extractText() 函数在多个文件里重复定义"
  - "缺少 yaml 解析失败时的统一错误处理"
```

### logs/ — 执行日志

每次 loop 结束后，agent 写一份执行日志。
格式是 Markdown，人类可读，也可以被下一个 agent 读取。

```markdown
# LOG — loop-005

日期: 2025-03-19
执行模型: opencode/mimov2pro
蓝图版本: BLUEPRINT-v003

## 完成的工作

- 实现了 `agents/registry.ts` 和 `agents/dispatcher.ts`
- 注册了 card-reviewer 和 coverage-assessor 两个角色
- 修复了 yaml.dump 在 Windows 路径下的换行符问题

## 遇到的问题

- `session.createSubtask` API 在 opencode 里实际名称是 `session.fork`，
  和文档描述不一致，花了 40 分钟排查
- eval-scorer 的 timeout 设置为 15000ms 不够用，实际需要约 25000ms

## 未完成

- prediction-auditor 角色定义完成，但 parser 未实现
- dashboard 的 agent-tasks tab 未开始

## 技术债记录

- `command.ts` 第 87-134 行的 readline 交互逻辑重复出现在 runner.ts，
  应该抽象成 `meta/ui/prompt.ts`
- BLUEPRINT-v003 里提到的 extractText() 重复定义问题已确认，
  在 dispatcher.ts、planner.ts、command.ts 各有一份，需要统一

## 下一轮建议

P2（card-reviewer 接入 loop）可以开始，
前提是先解决 session.fork 的正确 API 用法已经确认。
```

---

## 系统论二：双速开发系统（Two-speed Development）

### 问题

单一模型做持续迭代会产生两个对立的问题：

- **弱模型**：成本低、速度快，但全局视角不足，增量修改会积累路径依赖，
  代码一致性随时间下降，技术债慢慢堆积
- **SOTA 模型**：全局视角强、能做整体重构，但成本高，
  不适合日常的高频迭代

你现在的实践：用弱模型（opencode/mimov2pro）每天迭代，
每周用 SOTA（codex/gpt-5.4）做一次全局优化。
Codex 倾向于完全重写而不是增量编辑，这是正确的——
重写可以消除路径依赖，保证全局一致性。

### 双速架构

```
触发条件：时间（每周）或质量阈值（技术债密度）
          │
          ▼
    ┌─────────────┐         ┌──────────────────┐
    │  SOTA 模型  │◄────────│   质量监测        │
    │             │         │  （LOG 分析）      │
    │ • 读全量文档 │         └──────────────────┘
    │ • 重写代码  │
    │ • 更新蓝图  │──────────────────────────────┐
    │ • 消除技术债│                              │
    └─────────────┘                              │
                                                 ▼
                                        ┌──────────────┐
    ┌─────────────┐                     │   DOCS 层    │
    │  弱模型     │◄────────────────────│              │
    │             │                     │ • design.yaml│
    │ • 读蓝图    │                     │ • blueprints │
    │ • 增量迭代  │                     │ • insights   │
    │ • 写日志    │────────────────────►│ • logs       │
    │ • 记录技术债│                     └──────────────┘
    └─────────────┘
```

**关键洞察：DOCS 层是两个模型的接口。**

SOTA 重写完代码后，必须同步更新 blueprints 和 insights，
弱模型下一轮从新文档出发，而不是从对旧代码结构的记忆出发。
如果 SOTA 只改代码不改文档，弱模型会在新结构上延续旧思维，
快速重新积累偏差。

### SOTA 触发条件（quality_threshold）

不只是时间触发，还需要质量触发。
在 design.yaml 里增加：

```yaml
two_speed_policy:
  weak_model: "opencode/mimov2pro"
  sota_model: "codex/gpt-5.4"

  sota_trigger:
    schedule: "weekly"             # 时间触发
    quality_thresholds:            # 质量触发（满足任一即触发）
      - metric: "tech_debt_density"
        threshold: "> 3 items per loop"
        window: "last 3 loops"
      - metric: "todo_count_in_logs"
        threshold: "> 10"
        window: "last 5 logs"
      - metric: "rollback_rate"
        threshold: "> 30%"
        window: "last 5 loops"
      - metric: "coverage_regression"
        threshold: "any REQ drops > 0.1"
        window: "last 3 loops"

  sota_mode: restructure           # 见下方 search_policy 扩展
```

### search_policy 新增 restructure 模式

在 `design.yaml[search_policy.mode]` 里新增第四种模式：

```yaml
search_policy:
  mode: restructure   # 新增，原有: conservative / balanced / exploratory
```

`restructure` 模式下，loop 的行为完全不同：

```
普通模式（弱模型）：
  分析 → 生成3张增量卡片 → 选卡 → 执行 → 评估

restructure 模式（SOTA）：
  分析全量代码 → 生成重构方案 → 人类确认 → 完全重写 → 更新所有文档
```

重构方案不是卡片，是一份 `RESTRUCTURE-NNN.yaml`：

```yaml
# .meta/restructures/RESTRUCTURE-001.yaml
id: RESTRUCTURE-001
triggered_by: "quality_threshold[tech_debt_density]"
created_by: "codex/gpt-5.4"
created_at: "2025-03-25"

# SOTA 对当前代码状态的诊断
diagnosis:
  overall_health: 0.52             # 0-1
  primary_issues:
    - "extractText() 在 5 个文件里重复定义，每次有细微差异"
    - "command.ts 承担了过多职责（700 行），需要拆分"
    - "yaml 解析错误处理不一致，有的 throw 有的 return null"
  path_dependencies:
    - "card IO 的文件命名约定在 3 处假设了不同的格式"

# 重写范围和策略
restructure_plan:
  approach: "full_rewrite"         # full_rewrite / targeted_refactor
  scope:
    - "packages/opencode/src/meta/（全部）"
    - "packages/opencode/src/cli/cmd/tui/routes/loop/（全部）"
  preserve:
    - ".meta/design.yaml（数据不变，只改代码）"
    - ".meta/cards/（历史数据完整保留）"
  new_architecture: |
    将 meta/ 目录重组为三层：
    meta/core/     — 纯数据 IO（loadMetaDesign, cards, loops）
    meta/agents/   — sub-agent 调度层（Dispatcher, roles, parsers）
    meta/loop/     — loop 主流程（command, decision, execution）
    消除所有重复定义，统一 yaml 错误处理，统一 extractText。

# 重写完成后必须更新的文档
docs_to_update:
  - "blueprints/BLUEPRINT-current.yaml（更新 current_state）"
  - "insights/（新增关于新架构决策的 insight）"
  - "design.yaml[project.updated_at]"

# 验证标准
acceptance:
  - "bun typecheck 零错误"
  - "extractText 只在 meta/core/utils.ts 里定义"
  - "command.ts 行数 < 200"
  - "所有现有 .meta/ 数据文件能被新代码正确读取"
```

---

## 实现任务

### 任务一：创建 insights/ 读写模块

新建 `packages/opencode/src/meta/insights.ts`：

```typescript
import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"

export interface Insight {
  id: string
  title: string
  source: string
  category: "architecture" | "product" | "process" | "technical"
  insight: string
  implications: string[]
  related?: string[]
  status: "adopted" | "pending" | "rejected"
  adopted_in?: string
  created_at: string
}

export function loadInsights(cwd: string): Insight[] {
  const dir = path.join(cwd, ".meta", "insights")
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yaml"))
    .sort()
    .map(f => {
      try {
        return yaml.load(fs.readFileSync(path.join(dir, f), "utf8")) as Insight
      } catch { return null }
    })
    .filter(Boolean) as Insight[]
}

export function writeInsight(cwd: string, insight: Omit<Insight, "id">): string {
  const dir = path.join(cwd, ".meta", "insights")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const existing = fs.readdirSync(dir).filter(f => f.endsWith(".yaml")).length
  const id = `INS-${String(existing + 1).padStart(3, "0")}`
  const full: Insight = { id, ...insight }
  fs.writeFileSync(path.join(dir, `${id}.yaml`), yaml.dump(full, { lineWidth: 100 }))
  return id
}
```

将 insights 注入到 `buildSystemContext` 里：
在 `=== MetaDesign Context ===` 末尾，追加 adopted insights 的 implications：

```typescript
// 在 index.ts 的 buildSystemContext 里追加：
const insights = loadInsights(cwd)   // 需要把 cwd 传进来，或改为接受 insights 参数
const adoptedImplications = insights
  .filter(i => i.status === "adopted")
  .flatMap(i => i.implications)

if (adoptedImplications.length) {
  lines.push("")
  lines.push("Architecture decisions (adopted insights):")
  adoptedImplications.forEach(imp => lines.push(`  • ${imp}`))
}
```

### 任务二：创建 blueprints/ 读写模块

新建 `packages/opencode/src/meta/blueprints.ts`：

```typescript
import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"

export interface Blueprint {
  version: string
  created_by: string
  created_at: string
  valid_until?: string
  current_state: string
  priorities: Array<{
    id: string
    goal: string
    rationale: string
    acceptance: string
  }>
  constraints: string[]
  known_debt: string[]
}

export function loadCurrentBlueprint(cwd: string): Blueprint | null {
  const p = path.join(cwd, ".meta", "blueprints", "BLUEPRINT-current.yaml")
  if (!fs.existsSync(p)) return null
  try {
    return yaml.load(fs.readFileSync(p, "utf8")) as Blueprint
  } catch { return null }
}
```

将当前蓝图注入到 agent context 里：
在 loop 开始时，把 `current_state` 和 `priorities` 追加到 system prompt，
让弱模型每次迭代都知道自己在哪里、要去哪里。

### 任务三：创建 logs/ 写入模块

新建 `packages/opencode/src/meta/logs.ts`：

```typescript
import * as path from "path"
import * as fs from "fs"

export interface LoopLog {
  loop_id: string
  date: string
  model: string
  blueprint_version?: string
  completed: string[]
  problems: string[]
  incomplete: string[]
  tech_debt: string[]
  next_loop_suggestions: string[]
}

export function writeLoopLog(cwd: string, log: LoopLog): void {
  const dir = path.join(cwd, ".meta", "logs")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const content = formatLogMarkdown(log)
  fs.writeFileSync(path.join(dir, `LOG-${log.loop_id}.md`), content)
}

function formatLogMarkdown(log: LoopLog): string {
  return [
    `# LOG — ${log.loop_id}`,
    ``,
    `日期: ${log.date}`,
    `执行模型: ${log.model}`,
    log.blueprint_version ? `蓝图版本: ${log.blueprint_version}` : "",
    ``,
    `## 完成的工作`,
    log.completed.map(c => `- ${c}`).join("\n"),
    ``,
    `## 遇到的问题`,
    log.problems.length ? log.problems.map(p => `- ${p}`).join("\n") : "- 无",
    ``,
    `## 未完成`,
    log.incomplete.length ? log.incomplete.map(i => `- ${i}`).join("\n") : "- 无",
    ``,
    `## 技术债记录`,
    log.tech_debt.length ? log.tech_debt.map(d => `- ${d}`).join("\n") : "- 无",
    ``,
    `## 下一轮建议`,
    log.next_loop_suggestions.map(s => `- ${s}`).join("\n"),
  ].filter(l => l !== undefined).join("\n")
}
```

### 任务四：quality_threshold 监测

新建 `packages/opencode/src/meta/quality-monitor.ts`：

```typescript
import * as path from "path"
import * as fs from "fs"
import { loadLoopHistory } from "./index.js"

export interface QualityReport {
  should_trigger_sota: boolean
  triggered_by: string[]            // 哪些阈值被触发
  tech_debt_density: number         // 最近 3 个 loop 平均技术债条目数
  rollback_rate: number             // 最近 5 个 loop 回滚比例
  todo_count: number                // 最近 5 个 log 里的技术债总数
}

export function assessQuality(cwd: string): QualityReport {
  const logDir = path.join(cwd, ".meta", "logs")
  const triggered: string[] = []

  // 读最近的 log 文件
  const logFiles = fs.existsSync(logDir)
    ? fs.readdirSync(logDir).filter(f => f.endsWith(".md")).sort().reverse()
    : []

  // 技术债密度：最近 3 个 loop
  const recentLogs = logFiles.slice(0, 3).map(f =>
    fs.readFileSync(path.join(logDir, f), "utf8")
  )
  const techDebtItems = recentLogs.map(log => {
    const section = log.split("## 技术债记录")[1]?.split("##")[0] ?? ""
    return section.split("\n").filter(l => l.startsWith("- ")).length
  })
  const avgDebt = techDebtItems.reduce((a, b) => a + b, 0) / (techDebtItems.length || 1)
  if (avgDebt > 3) triggered.push(`tech_debt_density: ${avgDebt.toFixed(1)} > 3`)

  // 回滚率：最近 5 个 loop
  const history = loadLoopHistory(cwd)
  const recent5 = history.slice(0, 5)
  const rollbacks = recent5.filter(l => l.status === "rolled_back").length
  const rollbackRate = rollbacks / (recent5.length || 1)
  if (rollbackRate > 0.3) triggered.push(`rollback_rate: ${(rollbackRate * 100).toFixed(0)}% > 30%`)

  // TODO 总数
  const todoCount = logFiles.slice(0, 5)
    .map(f => fs.readFileSync(path.join(logDir, f), "utf8"))
    .join("\n")
    .split("\n")
    .filter(l => l.startsWith("- ") && l.includes("技术债")).length
  if (todoCount > 10) triggered.push(`todo_count: ${todoCount} > 10`)

  return {
    should_trigger_sota: triggered.length > 0,
    triggered_by: triggered,
    tech_debt_density: avgDebt,
    rollback_rate: rollbackRate,
    todo_count: todoCount,
  }
}
```

在 loop 开始时调用 `assessQuality`，如果 `should_trigger_sota` 为 true，
在 TUI 和 dashboard 里显示提示：

```
⚠ 质量监测触发：tech_debt_density 4.3 > 3
  建议切换到 SOTA 模型进行重构。
  当前蓝图: BLUEPRINT-v003
  运行 /meta restructure 查看重构建议
```

### 任务五：restructure 模式

在 `/meta` 命令里新增子命令 `/meta restructure`：

触发后，以 `restructure` 模式运行一次特殊的 loop：
- 不生成卡片
- 调用 `restructure-planner` sub-agent（新增角色）
- 生成 `RESTRUCTURE-NNN.yaml`
- 展示诊断报告和重构方案，等待人类确认
- 确认后执行完全重写（而不是增量）

`restructure-planner` 角色定义：

```typescript
// roles/restructure-planner.ts
export default {
  id: "restructure-planner",
  name: "Restructure Planner",
  description: "全局代码质量诊断，生成重构方案，供 SOTA 模型执行",
  context_needs: ["core_value", "requirements", "constraints", "negatives", "eval_factors"],
  system_prompt: `你是一个代码架构 agent。
你的任务是对整个代码库做全局诊断，找出路径依赖、重复定义、职责不清的模块，
然后给出一个完整的重构方案。
你的方案将被一个 SOTA 模型执行完全重写，所以不要保守——
如果某个模块需要从头写，就说清楚为什么以及新的组织方式是什么。
诊断完成后，必须明确指出重写后需要更新哪些文档。`,
  output_format: `输出一份完整的 RESTRUCTURE 方案，格式参考 .meta/blueprints/BLUEPRINT-current.yaml 里的 restructure_plan 字段结构`,
  output_parser: "restructure-plan",
  timeout_ms: 120000,
}
```

---

## 完整集成后的 loop 流程

```
loop 开始
  ├─ 读 design.yaml + insights（adopted）+ blueprints/current
  ├─ assessQuality() → 如果触发阈值，提示切换 SOTA
  │
  ├─ [普通模式] 分析 → 生成卡片 → card-reviewer 评分
  │    → 人类选卡（看双评分）→ planner 分解 → task-executor 执行
  │    → evaluation → 写 LOG → 更新 design.yaml baselines
  │
  └─ [restructure 模式] 全局诊断 → 生成 RESTRUCTURE 方案
       → 人类确认 → 完全重写 → 更新 blueprints + insights
```

---

## 执行顺序

```
step 1: 实现 insights.ts + blueprints.ts + logs.ts（纯 IO，无副作用）
step 2: 将 insights 和 blueprints 注入 buildSystemContext
step 3: 在 loop close 阶段自动写 LOG（调用 writeLoopLog）
step 4: 实现 quality-monitor.ts，在 loop 开始时调用
step 5: 在 TUI 和 dashboard 展示质量监测结果
step 6: 实现 restructure-planner 角色 + /meta restructure 子命令
step 7: 在 design.yaml schema 增加 two_speed_policy 字段
```

每步完成后 `bun typecheck`，每步打 git tag：
```
eternity-v1.1-insights-io
eternity-v1.2-context-injection
eternity-v1.3-loop-logs
eternity-v1.4-quality-monitor
eternity-v1.5-restructure-mode
```
