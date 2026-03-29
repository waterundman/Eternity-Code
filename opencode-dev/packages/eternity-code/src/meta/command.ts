import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import { loadMetaDesign } from "./index.js"
import { parseCardsFromText, writeCard, resolveCard, writeRejectedDirection, updateLoopHistory } from "./cards.js"
import { planCard, runPlan } from "./execution/index.js"
import type { MetaDesign, Session } from "./types.js"
import { MetaPaths } from "./paths.js"
import { assessQuality, formatQualityReport } from "./quality-monitor.js"
import { loadLoopContext } from "./context-loader.js"
import { handleRestructureOutput } from "./restructure-handler.js"
import { handleInsightOutput } from "./insight-handler.js"

// 这个函数会被 command registry 调用
export async function runMetaLoop(cwd: string, session: Session): Promise<void> {
  const design = await loadMetaDesign(cwd)
  if (!design) {
    console.log("[MetaDesign] No design.yaml found in this project.")
    console.log("Run: /meta-init to initialize the .meta directory")
    return
  }

  // Generate loop id
  const loopNum = (design.loop_history?.total_loops ?? 0) + 1
  const loopId = `loop-${String(loopNum).padStart(3, "0")}`

  // Create loop record
  const loopDir = MetaPaths.loops(cwd)
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

  // 加载完整的 loop 上下文
  const loopContext = await loadLoopContext(cwd)

  // 质量评估
  const qualityReport = assessQuality(cwd)
  if (qualityReport.should_trigger_sota) {
    console.log(formatQualityReport(qualityReport))
    
    // 自动触发 restructure
    const shouldAutoRestructure = design.two_speed_policy?.sota_trigger?.schedule === "auto" ||
                                  qualityReport.triggered_by.some(r => r.includes("rollback_rate"))
    
    if (shouldAutoRestructure) {
      console.log("\n[MetaDesign] Auto-triggering restructure due to quality thresholds...\n")
      try {
        const { Dispatcher } = await import("./agents/dispatcher.js")
        const dispatcher = new Dispatcher({ cwd, session })
        const restructurePlan = await dispatcher.dispatchRestructure("quality_threshold")
        const result = handleRestructureOutput(cwd, restructurePlan)
        if (result.success) {
          console.log(`[MetaDesign] Restructure plan generated: ${result.restructureId}`)
        }
      } catch (error) {
        console.warn("[MetaDesign] Failed to auto-trigger restructure:", error)
      }
    } else {
      console.log("\n[MetaDesign] Consider running /meta-restructure for global optimization.\n")
    }
  }

  // Build the generation prompt with full context
  const maxCards = design.search_policy?.max_cards_per_loop ?? 3
  const generationPrompt = buildGenerationPrompt(design, loopId, maxCards, loopContext)

  // Inject into session as user message and wait for response
  const response = await session.prompt({
    system: "You are a Plan Agent for MetaDesign. Analyze the codebase and generate decision cards.",
    message: generationPrompt,
  })
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
  await runDecisionFlow(cwd, cardIds, loopId, loopPath, session)
}

function buildGenerationPrompt(design: MetaDesign, loopId: string, maxCards: number, loopContext?: any): string {
  const lowCoverageReqs = [...(design.requirements ?? [])]
    .sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0))
    .slice(0, 3)
    .map((r) => `  [${r.id}] coverage ${((r.coverage ?? 0) * 100).toFixed(0)}%: ${r.text}`)
    .join("\n")

  const activeNegs = (design.rejected_directions ?? [])
    .filter((n) => n.status === "active")
    .map((n) => `  [${n.id}] ${n.text}`)
    .join("\n")

  let contextSection = ""
  if (loopContext) {
    // 注入 blueprint 上下文
    if (loopContext.blueprint) {
      contextSection += `\n当前蓝图 (${loopContext.blueprint.version}):\n`
      contextSection += `  状态: ${loopContext.blueprint.current_state?.split('\n')[0]}\n`
      loopContext.blueprint.priorities?.forEach((p: any) => {
        contextSection += `  ${p.id}: ${p.goal}\n`
      })
    }

    // 注入 insights 上下文
    if (loopContext.insights?.length) {
      contextSection += `\n架构决策 (已采纳的 insights):\n`
      loopContext.insights.flatMap((i: any) => i.implications).forEach((imp: string) => {
        contextSection += `  • ${imp}\n`
      })
    }

    // 注入最近的日志
    if (loopContext.recentLogs?.length) {
      contextSection += `\n最近的活动:\n`
      loopContext.recentLogs.slice(0, 2).forEach((log: string) => {
        const firstLine = log.split('\n')[0]
        contextSection += `  ${firstLine}\n`
      })
    }
  }

  return `[MetaDesign Loop ${loopId}]

以下是当前覆盖度最低的需求：
${lowCoverageReqs}

以下方向已被明确拒绝，你的卡片不得命中这些方向：
${activeNegs || "  （暂无）"}
${contextSection}
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
  loopPath: string,
  session?: Session
): Promise<void> {
  const yaml_ = await import("js-yaml")
  const readline = await import("readline")

  // Print card summaries
  console.log("\n" + "─".repeat(52))
  console.log("  DECISION PHASE — 选择本轮要执行的优化方向")
  console.log("─".repeat(52))

  for (let i = 0; i < cardIds.length; i++) {
    const cardPath = path.join(MetaPaths.cards(cwd), `${cardIds[i]}.yaml`)
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
    const cardPath = path.join(MetaPaths.cards(cwd), `${cardId}.yaml`)
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

  // Update loop history in design.yaml
  await updateLoopHistory(
    cwd,
    loopId,
    "completed",
    cardIds.length,
    accepted.size,
    rejected.size,
    `Cards accepted: ${accepted.size}, rejected: ${rejected.size}`
  )

  // Print summary
  console.log("\n" + "─".repeat(52))
  console.log(`  Loop ${loopId} 决策完成`)
  console.log(`  接受: ${accepted.size} 张  |  拒绝: ${rejected.size} 张`)
  if (newNegs.length) {
    console.log(`  写入负空间约束: ${newNegs.join(", ")}`)
  }

  // 对每张被接受的卡片，依次 plan → run
  const acceptedCards = [...accepted].map((i) => cardIds[i - 1])
  
  if (acceptedCards.length > 0) {
    console.log(`\n  进入执行阶段：${acceptedCards.length} 张卡片`)

    for (const cardId of acceptedCards) {
      console.log(`\n  ┌─ [${cardId}] 生成执行计划...`)

      const plan = await planCard(cwd, cardId, loopId, session)

      // 展示 plan 给人类确认再执行
      console.log(`  │  Plan ${plan.id}：${plan.interpretation}`)
      plan.tasks.forEach((t, i) => {
        console.log(`  │  ${i + 1}. ${t.spec.title}`)
        console.log(`  │     完成条件: ${t.spec.definition_of_done}`)
      })

      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout })
      const confirm = await new Promise<string>(res =>
        rl2.question("  │  确认执行此计划？[Y/n] ", res)
      )
      rl2.close()

      if (confirm.trim().toLowerCase() === "n") {
        console.log(`  └─ 跳过 ${plan.id}`)
        continue
      }

      console.log(`  │  开始执行...`)
      const result = await runPlan(cwd, plan.id, session)

      if (result.success) {
        console.log(`  └─ ✓ ${plan.id} 完成 (${result.tasks_completed} tasks)`)
      } else {
        console.log(`  └─ ✗ ${plan.id} 失败: ${result.error}`)
      }
    }
  }

  console.log(`\n  Loop ${loopId} 执行完成`)
  console.log(`  卡片详情: ${MetaPaths.cards(cwd)}`)
  console.log(`  Plan 详情: ${MetaPaths.plans(cwd)}`)
  console.log("─".repeat(52) + "\n")
}
