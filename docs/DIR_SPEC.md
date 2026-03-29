# Eternity Code — 目录规范与上下文加载

本文件是 Eternity Code 文件系统的最终规范。
所有涉及 `.meta/` 目录的读写操作必须遵循本文件，
包括现有的 INSTRUCTION.md、GSD_INTEGRATION.md、SUBAGENT_DISPATCH.md、
TWO_SPEED_SYSTEM.md 里的路径，如与本文件冲突，以本文件为准。

---

## 目录结构

```
.meta/
  design/
    design.yaml                    ← 元设计主文件（约束层）
    schema/                        ← schema 定义，只读参考
      design.schema.yaml
      card.schema.yaml
      loop.schema.yaml

  cognition/                       ← 外化认知层（设计思考，弱模型只读）
    insights/
      INS-001.yaml
      INS-002.yaml
    blueprints/
      BLUEPRINT-current.yaml       ← 始终是最新版本的完整副本
      BLUEPRINT-20250320.yaml      ← 带时间戳的历史存档
      BLUEPRINT-20250313.yaml

  execution/                       ← 执行记录层（每次 loop 追加）
    cards/
      CARD-001.yaml
      CARD-002.yaml
    plans/
      PLAN-001.yaml
    loops/
      loop-001.yaml
    logs/
      LOG-20250319-loop005.md      ← 日期在前，loop id 在后
      LOG-20250318-loop004.md
    agent-tasks/
      task-a3f2c1d8.yaml

  negatives/                       ← 负空间（独立分立，loop 全量扫描）
    NEG-001.yaml
    NEG-002.yaml
    NEG-003.yaml
```

---

## 分立逻辑

四个顶层目录各司其职，读写权限和频率完全不同：

```
目录           职责               谁写           读取频率
──────────────────────────────────────────────────────────
design/        产品约束           人类 + SOTA    每次 loop 全量
cognition/     设计思考           SOTA（蓝图）   每次 loop 按需
                                  人类（洞察）
execution/     执行事实           弱模型         每次 loop 最近 N 条
negatives/     被排除方向         弱模型         每次 loop 全量
```

**`negatives/` 单独分立的原因：**
loop 生成候选卡片时，每个候选都要逐条对照 negatives 做过滤。
如果 negatives 和 cards、plans 混在 execution/ 里，
随着项目迭代文件增多，索引成本线性增长。
单独分立后，agent 只需读一个小目录，扫描成本始终可控。

**`cognition/` 弱模型只读的原因：**
蓝图是 SOTA 模型设定的方向，是两个模型之间的接口合约。
如果弱模型在迭代过程中修改了蓝图，
SOTA 下次介入时会看到一份被污染的方向文件，
无法判断哪些是自己设定的约束，哪些是弱模型的临时决策。
洞察（insights）同理——它记录的是经过人类确认的架构决策，
弱模型无权修改，只能引用。

---

## 时间戳规范

### 文件命名

蓝图和日志的文件名内嵌时间戳，格式 `YYYYMMDD`：

```
BLUEPRINT-20250320.yaml      ← SOTA 介入时创建
LOG-20250319-loop005.md      ← 弱模型 loop 结束时写入
```

精确到天，不需要时分秒——每天最多一次 SOTA 介入，
loop 日志按 loop id 已经有顺序，日期提供跨天的索引能力。

按文件名字典序排列即时间线，不需要额外的索引文件。

### 文件内部时间戳

所有 YAML 文件的时间戳字段统一用 ISO 8601：

```yaml
created_at: "2025-03-20T09:00:00Z"
updated_at: "2025-03-20T14:32:00Z"
```

### `BLUEPRINT-current.yaml` 的维护

SOTA 每次写新蓝图时：

1. 写入带时间戳的存档文件：`BLUEPRINT-20250320.yaml`
2. 将其完整复制为 `BLUEPRINT-current.yaml`（覆盖）
3. 在新蓝图内声明 `supersedes` 字段

```yaml
# BLUEPRINT-current.yaml 内部结构
version: "v003"
created_at: "2025-03-20T09:00:00Z"
created_by: "codex/gpt-5.4"
supersedes: "BLUEPRINT-20250313.yaml"
valid_until: "2025-04-01"

current_state: |
  当前架构状态的一段话描述，弱模型每次 loop 的出发点

priorities:
  - id: P1
    goal: "..."
    rationale: "..."
    acceptance: "..."

constraints:
  - "弱模型不能修改 cognition/ 目录下的任何文件"
  - "新功能在没有 .meta/ 的项目里必须静默跳过"

known_debt:
  - "extractText() 在多个文件里重复定义"
```

---

## 上下文加载策略

loop 开始时，按以下固定顺序、固定范围加载上下文。
不同目录的加载策略不同，避免项目迭代久了后启动变慢。

### 加载顺序和范围

```typescript
// packages/opencode/src/meta/context-loader.ts

export async function loadLoopContext(cwd: string): Promise<LoopContext> {

  // ── 1. design/ — 全量，必读 ─────────────────────────
  // 小文件，是所有约束的核心，每次必须全量读
  const design = await loadDesign(
    path.join(cwd, ".meta/design/design.yaml")
  )

  // ── 2. negatives/ — 全量，必读 ──────────────────────
  // 过滤候选卡片用，必须全量，不能遗漏
  const negatives = await loadAllNegatives(
    path.join(cwd, ".meta/negatives/")
  )

  // ── 3. cognition/blueprints/ — 只读 current ─────────
  // 弱模型的方向来源，只需要当前版本
  const blueprint = await loadBlueprint(
    path.join(cwd, ".meta/cognition/blueprints/BLUEPRINT-current.yaml")
  )

  // ── 4. cognition/insights/ — 只读 adopted ───────────
  // 只注入已被采纳的洞察的 implications，过滤掉 pending/rejected
  const insights = await loadAdoptedInsights(
    path.join(cwd, ".meta/cognition/insights/")
  )

  // ── 5. execution/logs/ — 只读最近 3 条 ──────────────
  // 按文件名倒序取最近 3 条，提供短期记忆
  // 数量固定，不随项目迭代增长
  const recentLogs = await loadRecentLogs(
    path.join(cwd, ".meta/execution/logs/"),
    3
  )

  // execution/cards、plans、loops 不在启动时加载
  // 按需由具体的 command 读取

  return { design, negatives, blueprint, insights, recentLogs }
}
```

### 注入到 system prompt 的结构

```
=== Eternity Code Context ===

[来自 design/]
Core value: ...
Anti value: ...
Stage: mvp

Requirements:
  [REQ-001] ████████░░ 74%  ...
  [REQ-002] ████░░░░░░ 41%  ...

Compliance constraints:
  • ...

[来自 negatives/]
Rejected directions (filter all candidates against these):
  [NEG-001] ...  reason: ...
  [NEG-002] ...  reason: ...

[来自 cognition/blueprints/]
Current blueprint (v003, 2025-03-20):
  State: ...
  P1: ...
  P2: ...
  Constraints:
    • 弱模型不能修改 cognition/ 目录
    • ...

[来自 cognition/insights/ — adopted only]
Architecture decisions:
  • sub-agent 调用必须通过 Dispatcher
  • context_needs 必须按需声明

[来自 execution/logs/ — 最近 3 条摘要]
Recent activity:
  2025-03-19 loop-005: 完成 dispatcher.ts，card-reviewer 待接入
  2025-03-18 loop-004: 修复评分回归，完成率 71%
  2025-03-17 loop-003: 缓存层回滚

=== End Context ===
```

---

## 文件读写接口

### `context-loader.ts` 完整实现

```typescript
import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { MetaDesign, RejectedDirection } from "./types.js"
import type { Blueprint, Insight } from "./cognition.js"

export interface LoopContext {
  design: MetaDesign | null
  negatives: RejectedDirection[]
  blueprint: Blueprint | null
  insights: Insight[]
  recentLogs: string[]          // raw markdown，最近 3 条
}

export async function loadLoopContext(cwd: string): Promise<LoopContext> {
  return {
    design:     loadDesign(path.join(cwd, ".meta/design/design.yaml")),
    negatives:  loadAllNegatives(path.join(cwd, ".meta/negatives/")),
    blueprint:  loadBlueprint(path.join(cwd, ".meta/cognition/blueprints/BLUEPRINT-current.yaml")),
    insights:   loadAdoptedInsights(path.join(cwd, ".meta/cognition/insights/")),
    recentLogs: loadRecentLogs(path.join(cwd, ".meta/execution/logs/"), 3),
  }
}

function loadDesign(p: string): MetaDesign | null {
  if (!fs.existsSync(p)) return null
  try { return yaml.load(fs.readFileSync(p, "utf8")) as MetaDesign }
  catch { return null }
}

function loadAllNegatives(dir: string): RejectedDirection[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yaml"))
    .sort()
    .map(f => {
      try { return yaml.load(fs.readFileSync(path.join(dir, f), "utf8")) as RejectedDirection }
      catch { return null }
    })
    .filter((n): n is RejectedDirection => n !== null && n.status === "active")
}

function loadBlueprint(p: string): Blueprint | null {
  if (!fs.existsSync(p)) return null
  try { return yaml.load(fs.readFileSync(p, "utf8")) as Blueprint }
  catch { return null }
}

function loadAdoptedInsights(dir: string): Insight[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yaml"))
    .sort()
    .map(f => {
      try { return yaml.load(fs.readFileSync(path.join(dir, f), "utf8")) as Insight }
      catch { return null }
    })
    .filter((i): i is Insight => i !== null && i.status === "adopted")
}

function loadRecentLogs(dir: string, n: number): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .sort()
    .reverse()                          // 最新的在前
    .slice(0, n)
    .map(f => {
      try { return fs.readFileSync(path.join(dir, f), "utf8") }
      catch { return null }
    })
    .filter((l): l is string => l !== null)
}
```

### `cognition.ts` — 蓝图和洞察的读写

```typescript
import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"

export interface Blueprint {
  version: string
  created_at: string
  created_by: string
  supersedes?: string
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

// SOTA 调用：写新蓝图（同时更新 current 和存档）
export function writeBlueprint(cwd: string, blueprint: Blueprint): void {
  const dir = path.join(cwd, ".meta/cognition/blueprints")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const date = blueprint.created_at.slice(0, 10).replace(/-/g, "")
  const archivePath = path.join(dir, `BLUEPRINT-${date}.yaml`)
  const currentPath = path.join(dir, "BLUEPRINT-current.yaml")

  const content = yaml.dump(blueprint, { lineWidth: 100 })
  fs.writeFileSync(archivePath, content)
  fs.writeFileSync(currentPath, content)   // current 始终是最新的完整副本
}

// 写洞察（人类触发，通过 /meta insight 命令）
export function writeInsight(cwd: string, insight: Omit<Insight, "id">): string {
  const dir = path.join(cwd, ".meta/cognition/insights")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const existing = fs.readdirSync(dir).filter(f => f.endsWith(".yaml")).length
  const id = `INS-${String(existing + 1).padStart(3, "0")}`
  const full: Insight = { id, ...insight }
  fs.writeFileSync(path.join(dir, `${id}.yaml`), yaml.dump(full, { lineWidth: 100 }))
  return id
}
```

### `execution/logs.ts` — 日志写入

```typescript
import * as path from "path"
import * as fs from "fs"

export interface LoopLog {
  loop_id: string
  date: string               // YYYY-MM-DD
  model: string
  blueprint_version?: string
  completed: string[]
  problems: string[]
  incomplete: string[]
  tech_debt: string[]
  next_loop_suggestions: string[]
}

export function writeLoopLog(cwd: string, log: LoopLog): void {
  const dir = path.join(cwd, ".meta/execution/logs")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // 文件名：LOG-YYYYMMDD-loop-NNN.md
  const dateStr = log.date.replace(/-/g, "")
  const filename = `LOG-${dateStr}-${log.loop_id}.md`

  fs.writeFileSync(path.join(dir, filename), formatLog(log))
}

function formatLog(log: LoopLog): string {
  const section = (title: string, items: string[]) =>
    `## ${title}\n${items.length ? items.map(i => `- ${i}`).join("\n") : "- 无"}`

  return [
    `# LOG — ${log.loop_id}`,
    ``,
    `日期: ${log.date}`,
    `执行模型: ${log.model}`,
    log.blueprint_version ? `蓝图版本: ${log.blueprint_version}` : "",
    ``,
    section("完成的工作", log.completed),
    ``,
    section("遇到的问题", log.problems),
    ``,
    section("未完成", log.incomplete),
    ``,
    section("技术债记录", log.tech_debt),
    ``,
    section("下一轮建议", log.next_loop_suggestions),
  ].filter(l => l !== undefined).join("\n")
}
```

---

## 路径常量

所有涉及 `.meta/` 路径的代码，统一从这个文件取常量，不要在各处硬编码路径：

```typescript
// packages/opencode/src/meta/paths.ts

export const MetaPaths = {
  root:       (cwd: string) => path.join(cwd, ".meta"),

  // design/
  design:     (cwd: string) => path.join(cwd, ".meta/design/design.yaml"),
  schema:     (cwd: string) => path.join(cwd, ".meta/design/schema"),

  // cognition/
  blueprints: (cwd: string) => path.join(cwd, ".meta/cognition/blueprints"),
  current:    (cwd: string) => path.join(cwd, ".meta/cognition/blueprints/BLUEPRINT-current.yaml"),
  insights:   (cwd: string) => path.join(cwd, ".meta/cognition/insights"),

  // execution/
  cards:      (cwd: string) => path.join(cwd, ".meta/execution/cards"),
  plans:      (cwd: string) => path.join(cwd, ".meta/execution/plans"),
  loops:      (cwd: string) => path.join(cwd, ".meta/execution/loops"),
  logs:       (cwd: string) => path.join(cwd, ".meta/execution/logs"),
  agentTasks: (cwd: string) => path.join(cwd, ".meta/execution/agent-tasks"),

  // negatives/
  negatives:  (cwd: string) => path.join(cwd, ".meta/negatives"),
}
```

---

## 对现有代码的迁移

现有代码里所有硬编码的 `.meta/` 路径，统一替换为 `MetaPaths.*`：

```typescript
// 改造前
const cardPath = path.join(cwd, ".meta/cards/CARD-001.yaml")

// 改造后
const cardPath = path.join(MetaPaths.cards(cwd), "CARD-001.yaml")
```

涉及的文件：
- `packages/opencode/src/meta/index.ts`
- `packages/opencode/src/meta/cards.ts`
- `packages/opencode/src/meta/command.ts`
- `packages/opencode/src/meta/execution/planner.ts`
- `packages/opencode/src/meta/execution/runner.ts`
- `packages/opencode/src/meta/dashboard/server.ts`

---

## 执行顺序

```
step 1: 创建 paths.ts，定义 MetaPaths 常量
step 2: 创建新目录结构（mkdir -p）
step 3: 将现有 .meta/ 下的文件迁移到新路径
step 4: 实现 context-loader.ts
step 5: 实现 cognition.ts（Blueprint + Insight 读写）
step 6: 实现 execution/logs.ts（带时间戳文件名）
step 7: 将现有代码里的硬编码路径替换为 MetaPaths.*
step 8: 更新 dashboard/server.ts 的 API 路径
step 9: bun typecheck + bun dev . 验证
```

打 tag：
```bash
git tag eternity-v1.0-dir-restructure
```
