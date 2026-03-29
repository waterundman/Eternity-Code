# MetaDesign 改造指令

你是一个正在改造 eternity-code 项目的工程师 agent。
本文件是你的完整任务说明。请从头读完再开始动手。

---

## 你的身份和原则

你正在将 eternity-code（anomalyco/eternity-code，TypeScript + Bun）改造为支持
MetaDesign 框架的 AI 原生软件工程工具。

**改造原则，每一步都必须遵守：**
- 不破坏 eternity-code 现有功能。对没有 `.meta/` 目录的项目，所有改动完全透明
- 每完成一个阶段，立即运行 `bun typecheck` 和 `bun dev .` 确认无报错
- 优先使用项目已有依赖，不引入新 npm 包（js-yaml 已在项目中）
- 所有新文件放在 `packages/eternity-code/src/meta/` 目录下
- TypeScript，严格类型，不用 `any`

---

## 第零步：摸清地形（必须先做，不要跳过）

在动任何文件之前，先执行以下探查，把结果记在脑子里：

```bash
# 1. 看整体结构
find packages/eternity-code/src -type f -name "*.ts" | head -60

# 2. 找 system prompt 组装位置
grep -r "system" packages/eternity-code/src/session/ -l
grep -r "systemPrompt\|system_prompt\|buildPrompt\|getPrompt" packages/eternity-code/src --include="*.ts" -l

# 3. 找 LLM 调用位置
grep -r "messages\|anthropic\|openai\|createMessage" packages/eternity-code/src --include="*.ts" -l | grep -v node_modules

# 4. 找 slash command 注册位置
grep -r "command\|slash\|register" packages/eternity-code/src/cli --include="*.ts" -l

# 5. 找 cwd 是怎么传递的
grep -r "cwd\|workingDir\|root" packages/eternity-code/src/session --include="*.ts" | head -20

# 6. 确认 js-yaml 可用
grep "js-yaml\|yaml" package.json packages/eternity-code/package.json 2>/dev/null
```

根据这些结果，确定：
- `SYSTEM_PROMPT_FILE`：system prompt 组装的实际文件路径
- `LLM_CALL_FILE`：实际发起 LLM API 调用的文件路径
- `COMMAND_REGISTRY_FILE`：slash command 注册的实际文件路径
- `CWD_SOURCE`：cwd 从哪里来（session config、全局变量还是参数传入）

把这四个变量的实际值确定后，再继续。

---

## 第一步：创建 MetaDesign 读取层

**目标：** 能读取 `.meta/design.yaml` 并组装成 context 字符串。

### 新建 `packages/eternity-code/src/meta/types.ts`

```typescript
export interface MetaRequirement {
  id: string
  text: string
  priority: "p0" | "p1" | "p2"
  coverage: number
  coverage_note?: string
  signal?: {
    type: "metric" | "behavior" | "llm_eval" | "human_eval"
    spec: string
  }
}

export interface RejectedDirection {
  id: string
  text: string
  reason: string
  status: "active" | "pending_review" | "lifted"
  scope?: {
    type: "permanent" | "conditional" | "phase"
    condition?: string
    until_phase?: string
  }
  source_card?: string
  created_at?: string
}

export interface EvalFactor {
  id: string
  name: string
  role: {
    type: "objective" | "proxy" | "guardrail" | "diagnostic"
    proxies_for?: string
  }
  threshold: {
    target: string
    floor: string
    baseline: string
  }
  relations?: {
    conflicts_with?: string[]
    weight: number
  }
  lifecycle?: {
    active_from: string
    active_until?: string
  }
}

export interface MetaDesign {
  _schema_version?: string
  project: {
    id: string
    name: string
    stage: "prototype" | "mvp" | "growth" | "mature"
    core_value: string
    anti_value: string
    tech_stack?: {
      primary?: string[]
      forbidden?: Array<{ path: string; reason: string; until?: string }>
    }
  }
  requirements: MetaRequirement[]
  constraints?: {
    immutable_modules?: Array<{ path: string; reason: string }>
    stable_interfaces?: Array<{ name: string; spec: string }>
    performance_budget?: Array<{ metric: string; threshold: string; hard: boolean }>
    compliance?: string[]
  }
  rejected_directions?: RejectedDirection[]
  eval_factors?: EvalFactor[]
  search_policy?: {
    mode: "conservative" | "balanced" | "exploratory"
    max_cards_per_loop: number
    exploration_rate: number
    candidate_sources?: Array<{ source: string; weight: number }>
  }
  loop_history?: {
    total_loops: number
    last_loop_id?: string
    loops?: Array<{
      loop_id: string
      status: string
      composite_score_delta?: number
      summary?: string
    }>
  }
}

export interface RawCard {
  objective: string
  approach: string
  benefit: string
  cost: string
  risk: string
  confidence: number
  req_refs: string[]
  warnings: string[]
}

export interface CardDecision {
  status: "accepted" | "rejected"
  note?: string
  resolved_at: string
}
```

### 新建 `packages/eternity-code/src/meta/index.ts`

```typescript
import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { MetaDesign } from "./types.js"

export type { MetaDesign, RawCard, CardDecision } from "./types.js"

/**
 * Load .meta/design.yaml from the given working directory.
 * Returns null silently if the file doesn't exist —
 * non-MetaDesign projects are unaffected.
 */
export async function loadMetaDesign(cwd: string): Promise<MetaDesign | null> {
  const designPath = path.join(cwd, ".meta", "design.yaml")
  if (!fs.existsSync(designPath)) return null

  try {
    const raw = fs.readFileSync(designPath, "utf8")
    return yaml.load(raw) as MetaDesign
  } catch (e) {
    // malformed yaml: warn but don't crash eternity-code
    console.warn("[MetaDesign] Failed to parse .meta/design.yaml:", e)
    return null
  }
}

/**
 * Build a structured context block from the MetaDesign object.
 * This string is appended to the system prompt of every LLM call.
 */
export function buildSystemContext(design: MetaDesign): string {
  const lines: string[] = []

  lines.push("=== MetaDesign Context ===")
  lines.push(`Project: ${design.project.name}  [stage: ${design.project.stage}]`)
  lines.push(`Core value:  ${design.project.core_value}`)
  lines.push(`Anti value:  ${design.project.anti_value}`)

  // Requirements with coverage
  if (design.requirements?.length) {
    lines.push("")
    lines.push("Requirements:")
    for (const req of design.requirements) {
      const bar = coverageBar(req.coverage ?? 0)
      lines.push(`  [${req.id}] ${bar} (${((req.coverage ?? 0) * 100).toFixed(0)}%)  ${req.text}`)
      if (req.coverage_note) {
        lines.push(`         ↳ ${req.coverage_note}`)
      }
    }
  }

  // Active compliance constraints
  const compliance = design.constraints?.compliance ?? []
  if (compliance.length) {
    lines.push("")
    lines.push("Compliance constraints (hard rules, never violate):")
    for (const c of compliance) {
      lines.push(`  • ${c}`)
    }
  }

  // Immutable modules
  const immutable = design.constraints?.immutable_modules ?? []
  if (immutable.length) {
    lines.push("")
    lines.push("Immutable modules (never modify these files):")
    for (const m of immutable) {
      lines.push(`  • ${m.path}  — ${m.reason}`)
    }
  }

  // Active rejected directions — the most important constraint
  const activeNegs = (design.rejected_directions ?? []).filter(
    (n) => n.status === "active"
  )
  if (activeNegs.length) {
    lines.push("")
    lines.push("Rejected directions (DO NOT propose anything in these directions):")
    for (const neg of activeNegs) {
      lines.push(`  [${neg.id}] ${neg.text}`)
      lines.push(`         reason: ${neg.reason}`)
      if (neg.scope?.condition) {
        lines.push(`         unlocks when: ${neg.scope.condition}`)
      }
    }
  }

  // Eval factor baselines (for agent awareness)
  const objectives = (design.eval_factors ?? []).filter(
    (f) => f.role.type === "objective" || f.role.type === "guardrail"
  )
  if (objectives.length) {
    lines.push("")
    lines.push("Eval factor baselines:")
    for (const f of objectives) {
      const role = f.role.type === "guardrail" ? "🔒 guardrail" : "🎯 objective"
      lines.push(`  ${role}  ${f.name}: ${f.threshold.baseline}  (target: ${f.threshold.target}, floor: ${f.threshold.floor})`)
    }
  }

  // Search policy hint
  if (design.search_policy) {
    lines.push("")
    lines.push(`Search policy: ${design.search_policy.mode}  max cards/loop: ${design.search_policy.max_cards_per_loop}`)
  }

  lines.push("=== End MetaDesign Context ===")

  return lines.join("\n")
}

function coverageBar(coverage: number): string {
  const filled = Math.round(coverage * 8)
  return "█".repeat(filled) + "░".repeat(8 - filled)
}
```

### 新建 `packages/eternity-code/src/meta/cards.ts`

```typescript
import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { RawCard, CardDecision } from "./types.js"

// ── Card ID management ──────────────────────────────────────

function nextId(dir: string, prefix: string): string {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".yaml"))
  const nums = files.map((f) => parseInt(f.replace(prefix, "").replace(".yaml", ""), 10)).filter((n) => !isNaN(n))
  const next = nums.length ? Math.max(...nums) + 1 : 1
  return `${prefix}${String(next).padStart(3, "0")}`
}

// ── Parse cards from model output ──────────────────────────

export function parseCardsFromText(text: string): RawCard[] {
  const cards: RawCard[] = []
  const blocks = text.split("---CARD START---").slice(1)

  for (const block of blocks) {
    const end = block.indexOf("---CARD END---")
    if (end === -1) continue
    const content = block.slice(0, end).trim()

    try {
      const parsed = yaml.load(content) as Record<string, unknown>
      if (!parsed || typeof parsed !== "object") continue

      const card: RawCard = {
        objective: String(parsed.objective ?? ""),
        approach: String(parsed.approach ?? ""),
        benefit: String(parsed.benefit ?? ""),
        cost: String(parsed.cost ?? ""),
        risk: String(parsed.risk ?? ""),
        confidence: Number(parsed.confidence ?? 0.5),
        req_refs: parseStringList(parsed.req_refs),
        warnings: parseStringList(parsed.warnings),
      }

      if (card.objective) cards.push(card)
    } catch {
      // malformed card block: skip
    }
  }

  return cards
}

function parseStringList(val: unknown): string[] {
  if (!val || val === "none") return []
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === "string") return val.split(",").map((s) => s.trim()).filter(Boolean)
  return []
}

// ── Write card to disk ──────────────────────────────────────

export async function writeCard(
  cwd: string,
  card: RawCard,
  loopId: string
): Promise<string> {
  const dir = path.join(cwd, ".meta", "cards")
  const id = nextId(dir, "CARD-")
  const cardPath = path.join(dir, `${id}.yaml`)

  const cardObj = {
    _schema_version: "1.0.0",
    _schema_type: "decision_card",
    id,
    loop_id: loopId,
    req_refs: card.req_refs,
    content: {
      objective: card.objective,
      approach: card.approach,
      benefit: card.benefit,
      cost: card.cost,
      risk: card.risk,
      warnings: card.warnings,
    },
    prediction: {
      confidence: card.confidence,
    },
    decision: {
      status: "pending",
      chosen_by: null,
      resolved_at: null,
      note: null,
    },
    outcome: null,
    created_at: new Date().toISOString(),
  }

  fs.writeFileSync(cardPath, yaml.dump(cardObj, { lineWidth: 100 }))
  return id
}

// ── Resolve a card (accept or reject) ──────────────────────

export async function resolveCard(
  cwd: string,
  cardId: string,
  decision: CardDecision
): Promise<void> {
  const cardPath = path.join(cwd, ".meta", "cards", `${cardId}.yaml`)
  if (!fs.existsSync(cardPath)) throw new Error(`Card not found: ${cardId}`)

  const card = yaml.load(fs.readFileSync(cardPath, "utf8")) as Record<string, unknown>
  ;(card as Record<string, unknown>).decision = {
    status: decision.status,
    note: decision.note ?? null,
    resolved_at: decision.resolved_at,
  }

  fs.writeFileSync(cardPath, yaml.dump(card, { lineWidth: 100 }))
}

// ── Write rejected direction to design.yaml + negatives/ ───

export async function writeRejectedDirection(
  cwd: string,
  cardId: string,
  cardObjective: string,
  cardReason: string,
  note: string
): Promise<string> {
  const designPath = path.join(cwd, ".meta", "design.yaml")
  const negDir = path.join(cwd, ".meta", "negatives")

  // Load current design
  const designRaw = fs.readFileSync(designPath, "utf8")
  const design = yaml.load(designRaw) as Record<string, unknown>

  // Generate NEG id
  if (!fs.existsSync(negDir)) fs.mkdirSync(negDir, { recursive: true })
  const negId = nextId(negDir, "NEG-")

  const negEntry = {
    id: negId,
    text: cardObjective,
    reason: note || cardReason,
    scope: { type: "conditional", condition: null, until_phase: null },
    source_card: cardId,
    created_at: new Date().toISOString(),
    status: "active",
    lifted_at: null,
    lifted_note: null,
  }

  // Write individual NEG file
  const negPath = path.join(negDir, `${negId}.yaml`)
  fs.writeFileSync(negPath, yaml.dump(negEntry, { lineWidth: 100 }))

  // Append to design.yaml rejected_directions
  const rejected = (design.rejected_directions as unknown[]) ?? []
  rejected.push(negEntry)
  design.rejected_directions = rejected
  design.updated_at = new Date().toISOString()

  fs.writeFileSync(designPath, yaml.dump(design, { lineWidth: 100 }))

  return negId
}
```

완료 후 실행:
```bash
bun typecheck
```

타입 에러가 없으면 계속.

---

## 第二步：注入 system prompt

**目标：** 每次 LLM 调用前，自动把 MetaDesign context 追加到 system prompt。

先确认 `SYSTEM_PROMPT_FILE`（第零步找到的）。
打开那个文件，找到 system prompt 字符串最终组装完成的位置，
在那里加入以下逻辑：

```typescript
// 在 system prompt 文件顶部加 import
import { loadMetaDesign, buildSystemContext } from "../meta/index.js"

// 在 system prompt 组装函数里，找到 return systemPromptString 之前，插入：
const metaDesign = await loadMetaDesign(cwd)  // cwd 从你找到的实际来源取
if (metaDesign) {
  systemPromptString += "\n\n" + buildSystemContext(metaDesign)
}
```

**注意：**
- 如果 system prompt 函数不是 async 的，需要改成 async，并更新所有调用方
- `cwd` 的来源用第零步找到的实际路径，不要猜测
- 如果 system prompt 是数组形式（message blocks），则 push 一个新的 text block

完成后运行验证：
```bash
bun dev .
# 在有 .meta/design.yaml 的项目里启动 eternity-code
# 问："这个项目有哪些被拒绝的优化方向？"
# 期望：模型能准确复述 rejected_directions 的内容
```

---

## 第三步：注册 /meta 命令

**目标：** 用户运行 `/meta` 后，触发分析并生成卡片文件。

找到 `COMMAND_REGISTRY_FILE`，参照已有命令的注册方式，注册新命令。

命令实现逻辑如下（新建 `packages/eternity-code/src/meta/command.ts`）：

```typescript
import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import { loadMetaDesign } from "./index.js"
import { parseCardsFromText, writeCard, resolveCard, writeRejectedDirection } from "./cards.js"
import type { MetaDesign } from "./types.js"

// 这个函数会被 command registry 调用
// session 参数类型用项目中已有的 Session 类型替换
export async function runMetaLoop(cwd: string, session: any): Promise<void> {
  const design = await loadMetaDesign(cwd)
  if (!design) {
    console.log("[MetaDesign] No .meta/design.yaml found in this project.")
    console.log("Run: mkdir -p .meta && cp <your-design.yaml> .meta/design.yaml")
    return
  }

  // Generate loop id
  const loopNum = (design.loop_history?.total_loops ?? 0) + 1
  const loopId = `loop-${String(loopNum).padStart(3, "0")}`

  // Create loop record
  const loopDir = path.join(cwd, ".meta", "loops")
  if (!fs.existsSync(loopDir)) fs.mkdirSync(loopDir, { recursive: true })
  const loopPath = path.join(loopDir, `${loopId}.yaml`)
  fs.writeFileSync(loopPath, yaml.dump({
    _schema_type: "loop_record",
    id: loopId,
    sequence: loopNum,
    started_at: new Date().toISOString(),
    status: "running",
    phase: "generate",
  }))

  console.log(`\n[MetaDesign] Starting ${loopId}...\n`)

  // Build the generation prompt
  const maxCards = design.search_policy?.max_cards_per_loop ?? 3
  const generationPrompt = buildGenerationPrompt(design, loopId, maxCards)

  // Inject into session as user message and wait for response
  // (replace session.sendMessage with the actual session API)
  const response = await session.sendMessage(generationPrompt)
  const responseText = extractText(response)

  // Parse cards from model output
  const rawCards = parseCardsFromText(responseText)

  if (rawCards.length === 0) {
    console.log("[MetaDesign] No cards found in model output. Try again or rephrase.")
    return
  }

  // Write cards to disk
  const cardIds: string[] = []
  for (const card of rawCards) {
    const id = await writeCard(cwd, card, loopId)
    cardIds.push(id)
  }

  console.log(`\n[MetaDesign] Generated ${cardIds.length} cards: ${cardIds.join(", ")}`)

  // Update loop record
  const loopRecord = yaml.load(fs.readFileSync(loopPath, "utf8")) as Record<string, unknown>
  loopRecord.phase = "decide"
  loopRecord.candidates = { presented_cards: cardIds }
  fs.writeFileSync(loopPath, yaml.dump(loopRecord))

  // Run decision flow
  await runDecisionFlow(cwd, cardIds, loopId, loopPath)
}

function buildGenerationPrompt(design: MetaDesign, loopId: string, maxCards: number): string {
  const lowCoverageReqs = [...(design.requirements ?? [])]
    .sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0))
    .slice(0, 3)
    .map((r) => `  [${r.id}] coverage ${((r.coverage ?? 0) * 100).toFixed(0)}%: ${r.text}`)
    .join("\n")

  const activeNegs = (design.rejected_directions ?? [])
    .filter((n) => n.status === "active")
    .map((n) => `  [${n.id}] ${n.text}`)
    .join("\n")

  return `[MetaDesign Loop ${loopId}]

以下是当前覆盖度最低的需求：
${lowCoverageReqs}

以下方向已被明确拒绝，你的卡片不得命中这些方向：
${activeNegs || "  （暂无）"}

请分析当前代码库，生成恰好 ${maxCards} 张决策卡片。
每张卡片必须严格按以下格式输出，前后的分隔符不能省略：

---CARD START---
objective: （一句话，这张卡要达到什么目标）
approach: （具体的实施手段，技术层面）
benefit: （预期收益，尽量量化）
cost: （代价或副作用）
risk: （最可能出错的地方）
confidence: （0.0-1.0，你对预测收益的置信度）
req_refs: （关联的 REQ id，逗号分隔）
warnings: （接近哪些约束或 NEG，没有写 none）
---CARD END---

在卡片之外不要提出任何代码修改建议。`
}

function extractText(response: unknown): string {
  // 根据实际 session API 的返回结构调整
  if (typeof response === "string") return response
  if (response && typeof response === "object") {
    const r = response as Record<string, unknown>
    if (typeof r.text === "string") return r.text
    if (typeof r.content === "string") return r.content
    if (Array.isArray(r.content)) {
      return r.content
        .filter((c: unknown) => c && typeof c === "object" && (c as Record<string, unknown>).type === "text")
        .map((c: unknown) => (c as Record<string, unknown>).text as string)
        .join("\n")
    }
  }
  return String(response)
}

async function runDecisionFlow(
  cwd: string,
  cardIds: string[],
  loopId: string,
  loopPath: string
): Promise<void> {
  const yaml_ = await import("js-yaml")
  const readline = await import("readline")

  // Print card summaries
  console.log("\n" + "─".repeat(52))
  console.log("  DECISION PHASE — 选择本轮要执行的优化方向")
  console.log("─".repeat(52))

  for (let i = 0; i < cardIds.length; i++) {
    const cardPath = path.join(cwd, ".meta", "cards", `${cardIds[i]}.yaml`)
    const card = yaml_.load(fs.readFileSync(cardPath, "utf8")) as Record<string, unknown>
    const content = card.content as Record<string, string>
    const pred = card.prediction as Record<string, number>
    const conf = pred?.confidence ?? 0
    const confBar = "█".repeat(Math.round(conf * 10)).padEnd(10, "░")

    console.log(`\n  ┌─ ${cardIds[i]} [${((card as Record<string, unknown>).req_refs as string[])?.join(", ") ?? ""}]`)
    console.log(`  │  目标: ${content.objective}`)
    console.log(`  │  手段: ${content.approach}`)
    console.log(`  │  收益: ${content.benefit}`)
    console.log(`  │  代价: ${content.cost}`)
    console.log(`  │  风险: ${content.risk}`)
    console.log(`  │  置信: ${confBar} ${(conf * 100).toFixed(0)}%`)
    if ((content.warnings as unknown as string[])?.length > 0 && content.warnings !== "none") {
      console.log(`  │  ⚠️   ${content.warnings}`)
    }
    console.log(`  └──────`)
  }

  console.log(`
  输入选择：
    数字       接受对应卡片      (例: 1 3 → 接受第1和第3张)
    -数字      拒绝对应卡片      (例: -2  → 拒绝第2张)
    all        全部接受
    none       全部拒绝，重新定义方向
    q          中止本轮 loop
  `)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const question = (q: string) => new Promise<string>((res) => rl.question(q, res))

  const input = (await question("  > ")).trim()

  if (input === "q") {
    rl.close()
    const loopRecord = yaml_.load(fs.readFileSync(loopPath, "utf8")) as Record<string, unknown>
    loopRecord.status = "aborted"
    loopRecord.completed_at = new Date().toISOString()
    fs.writeFileSync(loopPath, yaml_.dump(loopRecord))
    console.log("\n  Loop aborted.")
    return
  }

  // Parse selection
  const accepted = new Set<number>()
  const rejected = new Set<number>()

  if (input === "all") {
    cardIds.forEach((_, i) => accepted.add(i + 1))
  } else if (input === "none") {
    cardIds.forEach((_, i) => rejected.add(i + 1))
  } else {
    for (const token of input.split(/\s+/)) {
      if (token.startsWith("-")) {
        const n = parseInt(token.slice(1))
        if (n >= 1 && n <= cardIds.length) rejected.add(n)
      } else {
        const n = parseInt(token)
        if (n >= 1 && n <= cardIds.length) accepted.add(n)
      }
    }
  }

  const now = new Date().toISOString()
  const newNegs: string[] = []

  // Process rejections first (collect notes)
  for (const idx of rejected) {
    const cardId = cardIds[idx - 1]
    const cardPath = path.join(cwd, ".meta", "cards", `${cardId}.yaml`)
    const card = yaml_.load(fs.readFileSync(cardPath, "utf8")) as Record<string, unknown>
    const content = card.content as Record<string, string>

    console.log(`\n  拒绝 ${cardId}: ${content.objective}`)
    const note = (await question("  拒绝原因（可选，直接回车跳过）: ")).trim()

    await resolveCard(cwd, cardId, { status: "rejected", note, resolved_at: now })
    const negId = await writeRejectedDirection(cwd, cardId, content.objective, content.risk, note)
    newNegs.push(negId)
    console.log(`  ✓ 已写入 ${negId}: "${content.objective}"`)
  }

  // Process acceptances
  for (const idx of accepted) {
    const cardId = cardIds[idx - 1]
    await resolveCard(cwd, cardId, { status: "accepted", resolved_at: now })
    console.log(`  ✓ 接受 ${cardId}`)
  }

  rl.close()

  // Update loop record
  const loopRecord = yaml_.load(fs.readFileSync(loopPath, "utf8")) as Record<string, unknown>
  loopRecord.status = "completed"
  loopRecord.completed_at = now
  loopRecord.decision_session = {
    accepted_cards: [...accepted].map((i) => cardIds[i - 1]),
    rejected_cards: [...rejected].map((i) => cardIds[i - 1]),
    new_negatives_written: newNegs,
    completed_at: now,
  }
  fs.writeFileSync(loopPath, yaml_.dump(loopRecord))

  // Print summary
  console.log("\n" + "─".repeat(52))
  console.log(`  Loop ${loopId} 决策完成`)
  console.log(`  接受: ${accepted.size} 张  |  拒绝: ${rejected.size} 张`)
  if (newNegs.length) {
    console.log(`  写入负空间约束: ${newNegs.join(", ")}`)
  }
  console.log(`\n  下一步: 针对接受的卡片逐一实施改动`)
  console.log(`  卡片详情: .meta/cards/`)
  console.log("─".repeat(52) + "\n")
}
```

然后在 `COMMAND_REGISTRY_FILE` 中参照已有命令，将 `/meta` 注册为调用 `runMetaLoop(cwd, session)` 的命令。

---

## 第四步：最终验证

全部完成后，执行以下验证序列：

```bash
# 1. 类型检查
bun typecheck

# 2. 启动
bun dev .

# 3. 在任意没有 .meta/ 的项目里启动 eternity-code
#    → 行为应与改造前完全一致，无任何报错或多余输出

# 4. 在有 .meta/design.yaml 的项目里启动 eternity-code
#    输入: /meta
#    期望:
#      - 模型分析代码库
#      - 输出 3 张格式正确的卡片
#      - .meta/cards/ 下出现对应 CARD-NNN.yaml 文件
#      - 出现决策界面，可以输入选择
#      - 拒绝后 .meta/negatives/ 和 design.yaml 自动更新
#      - .meta/loops/loop-NNN.yaml 记录完整

# 5. 对话验证
#    问: "这个项目有哪些被拒绝的优化方向？"
#    期望: 模型复述 rejected_directions 内容，不提出命中这些方向的建议
```

---

## 已知需要你判断的地方

以下几处我无法确定实际的 API，你需要在第零步之后自行判断：

| 位置 | 需要确认的事 |
|------|------------|
| `session.sendMessage()` | 实际的 session 发消息 API 名称和参数 |
| system prompt 注入点 | 是字符串拼接还是 message block push |
| command 注册方式 | 是 object registry 还是 decorator 还是文件约定 |
| `cwd` 来源 | 是 session.config.cwd 还是全局 App.info().path 还是其他 |

遇到这些地方，先读相邻的已有代码，模仿已有模式，不要发明新的。

---

## 如果遇到阻塞

任何一步卡住超过 10 分钟，执行：

```bash
# 回退到上一个干净状态
git stash

# 重新只读那个卡住的文件
# 问自己：这个文件里已有的代码是怎么做类似事情的？
# 模仿它，不要自创模式
```
