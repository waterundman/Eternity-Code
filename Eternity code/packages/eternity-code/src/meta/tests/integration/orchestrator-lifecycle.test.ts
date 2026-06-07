import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import yaml from "js-yaml"
import type { Session, MetaDesign } from "../../types.js"
import type { LoopPhase, LoopResult, DecisionCard, EvaluationResult } from "../../orchestrator.js"

// Override dispatcher.test.ts's mock of design.js so loadMetaDesign works
mock.module("../../design.js", () => ({
  loadMetaDesign: async (cwd: string) => {
    const designPath = path.join(cwd, ".meta", "design", "design.yaml")
    if (!fs.existsSync(designPath)) return null
    const content = fs.readFileSync(designPath, "utf8")
    return yaml.load(content) as MetaDesign
  },
}))

import { LoopOrchestrator } from "../../orchestrator.js"

function createMockSession(responses: Map<string, unknown> = new Map()): Session {
  return {
    prompt: async (options) => {
      const key = options.message.slice(0, 100)
      return responses.get(key) ?? responses.get("default") ?? {
        text: `---CARD START---
objective: Improve test coverage
approach: Add unit tests for core modules
benefit: Better reliability and fewer bugs
cost: Development time for writing tests
risk: May miss edge cases
confidence: 0.85
req_refs: REQ-001
warnings: none
---CARD END---

---CARD START---
objective: Optimize performance
approach: Profile and optimize hot paths
benefit: Faster response times
cost: Code complexity may increase
risk: May introduce regressions
confidence: 0.75
req_refs: REQ-002
warnings: none
---CARD END---`
      }
    },
  }
}

function createTestDesign(): MetaDesign {
  return {
    _schema_version: "1.0.0",
    project: {
      id: "test-project",
      name: "Test Project",
      stage: "mvp",
      core_value: "Testing",
      anti_value: "Untested code",
    },
    requirements: [
      {
        id: "REQ-001",
        text: "All modules must have tests",
        priority: "p0",
        coverage: 0.5,
      },
      {
        id: "REQ-002",
        text: "Performance must meet benchmarks",
        priority: "p1",
        coverage: 0.3,
      },
    ],
    eval_factors: [
      {
        id: "eval-001",
        name: "Test Coverage",
        role: { type: "objective" },
        measurement: {
          type: "metric",
          spec: "scripts/coverage.sh",
        },
        threshold: {
          target: "90%",
          floor: "60%",
          baseline: "50%",
        },
        relations: { weight: 1.0 },
      },
    ],
    search_policy: {
      mode: "balanced",
      max_cards_per_loop: 3,
      exploration_rate: 0.2,
    },
  }
}

describe("LoopOrchestrator Lifecycle Integration", () => {
  let tmpDir: string
  let orchestrator: LoopOrchestrator
  let phaseChanges: LoopPhase[]
  let loopStarted: string[]
  let loopCompleted: Array<{ loopId: string; result: LoopResult }>
  let cardsReady: DecisionCard[]

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-test-"))
    phaseChanges = []
    loopStarted = []
    loopCompleted = []
    cardsReady = []

    // Create directory structure matching paths.ts expectations
    const designDir = path.join(tmpDir, ".meta", "design")
    fs.mkdirSync(designDir, { recursive: true })
    fs.writeFileSync(
      path.join(designDir, "design.yaml"),
      yaml.dump(createTestDesign(), { lineWidth: 100 })
    )

    const cardsDir = path.join(tmpDir, ".meta", "execution", "cards")
    fs.mkdirSync(cardsDir, { recursive: true })

    const plansDir = path.join(tmpDir, ".meta", "execution", "plans")
    fs.mkdirSync(plansDir, { recursive: true })

    const loopsDir = path.join(tmpDir, ".meta", "execution", "loops")
    fs.mkdirSync(loopsDir, { recursive: true })

    const logsDir = path.join(tmpDir, ".meta", "execution", "logs")
    fs.mkdirSync(logsDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("should initialize orchestrator with correct default state", () => {
    orchestrator = new LoopOrchestrator({
      cwd: tmpDir,
      session: createMockSession(),
    })

    expect(orchestrator.getPhase()).toBe("idle")
    expect(orchestrator.getCurrentCards()).toEqual([])
    expect(orchestrator.getCurrentLoopId()).toBeNull()
    expect(orchestrator.isPaused()).toBe(false)
  })

  test("should transition through phases during startLoop", async () => {
    orchestrator = new LoopOrchestrator({
      cwd: tmpDir,
      session: createMockSession(),
      onPhaseChange: (phase) => phaseChanges.push(phase),
      onLoopStart: (loopId) => loopStarted.push(loopId),
      onCardsReady: (cards) => { cardsReady = cards },
    })

    await orchestrator.startLoop()

    expect(phaseChanges).toContain("analyzing")
    expect(phaseChanges).toContain("generating")
    expect(phaseChanges).toContain("deciding")
    expect(loopStarted).toHaveLength(1)
    expect(orchestrator.getCurrentLoopId()).toBeTruthy()
    expect(cardsReady.length).toBeGreaterThan(0)
    expect(orchestrator.getCurrentCards()).toEqual(cardsReady)
  })

  test("should complete full lifecycle with submitDecisions", async () => {
    const evalResultCapture: EvaluationResult[] = []

    orchestrator = new LoopOrchestrator({
      cwd: tmpDir,
      session: createMockSession(),
      onPhaseChange: (phase) => phaseChanges.push(phase),
      onLoopStart: (loopId) => loopStarted.push(loopId),
      onLoopComplete: (loopId, result) => loopCompleted.push({ loopId, result }),
      onEvaluationComplete: (result) => evalResultCapture.push(result),
    })

    await orchestrator.startLoop()

    const cards = orchestrator.getCurrentCards()
    const loopId = orchestrator.getCurrentLoopId()
    expect(cards.length).toBeGreaterThan(0)
    expect(loopId).toBeTruthy()

    // Create loop record file (normally created by command.ts)
    const loopsDir = path.join(tmpDir, ".meta", "execution", "loops")
    const loopPath = path.join(loopsDir, `${loopId}.yaml`)
    fs.writeFileSync(loopPath, yaml.dump({
      _schema_type: "loop_record",
      id: loopId,
      sequence: 1,
      started_at: new Date().toISOString(),
      status: "running",
      phase: "decide",
      candidates: { presented_cards: cards.map(c => c.id) },
    }))

    const decisions = cards.map((card) => ({
      cardId: card.id,
      status: "accepted" as const,
    }))

    await orchestrator.submitDecisions(decisions)

    expect(phaseChanges).toContain("executing")
    expect(phaseChanges).toContain("evaluating")
    expect(phaseChanges).toContain("optimizing")
    expect(phaseChanges).toContain("complete")

    expect(loopCompleted).toHaveLength(1)
    expect(loopCompleted[0].result.success).toBe(true)
    expect(loopCompleted[0].result.cardsAccepted).toBe(cards.length)
    expect(loopCompleted[0].result.cardsRejected).toBe(0)

    expect(evalResultCapture).toHaveLength(1)
  })

  test("should handle mixed accept/reject decisions", async () => {
    orchestrator = new LoopOrchestrator({
      cwd: tmpDir,
      session: createMockSession(),
      onLoopComplete: (loopId, result) => loopCompleted.push({ loopId, result }),
    })

    await orchestrator.startLoop()

    const cards = orchestrator.getCurrentCards()
    const loopId = orchestrator.getCurrentLoopId()

    // Create loop record file
    const loopsDir = path.join(tmpDir, ".meta", "execution", "loops")
    const loopPath = path.join(loopsDir, `${loopId}.yaml`)
    fs.writeFileSync(loopPath, yaml.dump({
      _schema_type: "loop_record",
      id: loopId,
      sequence: 1,
      started_at: new Date().toISOString(),
      status: "running",
      phase: "decide",
      candidates: { presented_cards: cards.map(c => c.id) },
    }))

    const decisions = cards.map((card, index) => ({
      cardId: card.id,
      status: index === 0 ? ("accepted" as const) : ("rejected" as const),
      note: index > 0 ? "Not ready yet" : undefined,
    }))

    await orchestrator.submitDecisions(decisions)

    expect(loopCompleted).toHaveLength(1)
    expect(loopCompleted[0].result.cardsAccepted).toBe(1)
    expect(loopCompleted[0].result.cardsRejected).toBe(cards.length - 1)
  })

  test("should throw error when submitting decisions without active loop", async () => {
    orchestrator = new LoopOrchestrator({
      cwd: tmpDir,
      session: createMockSession(),
    })

    await expect(
      orchestrator.submitDecisions([{ cardId: "card-001", status: "accepted" }])
    ).rejects.toThrow("No active loop. Call startLoop() first.")
  })

  test("should track stage changes correctly", async () => {
    const stageChanges: Array<{ loopId: string; stage: LoopPhase; previousStage: LoopPhase }> = []

    orchestrator = new LoopOrchestrator({
      cwd: tmpDir,
      session: createMockSession(),
      onStageChange: (loopId, stage, previousStage) => {
        stageChanges.push({ loopId, stage, previousStage })
      },
    })

    await orchestrator.startLoop()

    const cards = orchestrator.getCurrentCards()
    const loopId = orchestrator.getCurrentLoopId()

    // Create loop record file
    const loopsDir = path.join(tmpDir, ".meta", "execution", "loops")
    const loopPath = path.join(loopsDir, `${loopId}.yaml`)
    fs.writeFileSync(loopPath, yaml.dump({
      _schema_type: "loop_record",
      id: loopId,
      sequence: 1,
      started_at: new Date().toISOString(),
      status: "running",
      phase: "decide",
      candidates: { presented_cards: cards.map(c => c.id) },
    }))

    await orchestrator.submitDecisions(
      cards.map((card) => ({ cardId: card.id, status: "accepted" as const }))
    )

    expect(stageChanges.length).toBeGreaterThan(0)
    expect(stageChanges.some((s) => s.stage === "analyzing")).toBe(true)
    expect(stageChanges.some((s) => s.stage === "generating")).toBe(true)
    expect(stageChanges.some((s) => s.stage === "deciding")).toBe(true)
    expect(stageChanges.some((s) => s.stage === "executing")).toBe(true)
    expect(stageChanges.some((s) => s.stage === "evaluating")).toBe(true)
    expect(stageChanges.some((s) => s.stage === "optimizing")).toBe(true)
    expect(stageChanges.some((s) => s.stage === "complete")).toBe(true)
  })

  test("should register and execute conditional branches", async () => {
    orchestrator = new LoopOrchestrator({
      cwd: tmpDir,
      session: createMockSession(),
    })

    let truePathExecuted = false
    let falsePathExecuted = false

    orchestrator.registerConditionalBranch("test-branch", {
      condition: (result) => result.delta > 0,
      truePath: async () => { truePathExecuted = true },
      falsePath: async () => { falsePathExecuted = true },
    })

    const branches = orchestrator.getConditionalBranches()
    expect(branches.has("test-branch")).toBe(true)

    await orchestrator.executeConditionalBranch("test-branch", {
      score_before: 0.5,
      score_after: 0.8,
      delta: 0.3,
      forced_rollback: false,
    })

    expect(truePathExecuted).toBe(true)
    expect(falsePathExecuted).toBe(false)
  })

  test("should register and execute user decision branches", async () => {
    orchestrator = new LoopOrchestrator({
      cwd: tmpDir,
      session: createMockSession(),
    })

    let selectedAction = ""

    orchestrator.registerUserDecisionBranch("user-branch", {
      decisionPoint: "Choose optimization strategy",
      options: [
        {
          id: "option-a",
          label: "Aggressive optimization",
          action: async () => { selectedAction = "aggressive" },
        },
        {
          id: "option-b",
          label: "Conservative optimization",
          action: async () => { selectedAction = "conservative" },
        },
      ],
    })

    const options = orchestrator.getUserDecisionOptions("user-branch")
    expect(options).toHaveLength(2)
    expect(options[0].id).toBe("option-a")

    await orchestrator.executeUserDecisionBranch("user-branch", "option-b")
    expect(selectedAction).toBe("conservative")
  })

  test("should throw error for unknown conditional branch", async () => {
    orchestrator = new LoopOrchestrator({
      cwd: tmpDir,
      session: createMockSession(),
    })

    await expect(
      orchestrator.executeConditionalBranch("nonexistent", {
        score_before: 0,
        score_after: 0,
        delta: 0,
        forced_rollback: false,
      })
    ).rejects.toThrow("Conditional branch not found: nonexistent")
  })

  test("should throw error for unknown user decision branch", async () => {
    orchestrator = new LoopOrchestrator({
      cwd: tmpDir,
      session: createMockSession(),
    })

    await expect(
      orchestrator.executeUserDecisionBranch("nonexistent", "option-a")
    ).rejects.toThrow("User decision branch not found: nonexistent")
  })

  test("should emit custom events", async () => {
    const customEvents: Array<{ name: string; data: unknown }> = []

    orchestrator = new LoopOrchestrator({
      cwd: tmpDir,
      session: createMockSession(),
      onCustomEvent: (eventName, data) => {
        customEvents.push({ name: eventName, data })
      },
    })

    orchestrator.emitCustomEvent("test.event", { key: "value" })

    expect(customEvents).toHaveLength(1)
    expect(customEvents[0].name).toBe("test.event")
    expect(customEvents[0].data).toEqual({ key: "value" })
  })
})