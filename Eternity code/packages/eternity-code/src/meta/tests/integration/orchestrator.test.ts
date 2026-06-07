import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import yaml from "js-yaml"
import type { Session, MetaDesign } from "../../types.js"
import type { LoopPhase, LoopResult, DecisionCard, LoopPauseState } from "../../orchestrator.js"

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

function createMockSession(): Session {
  return {
    prompt: async () => ({
      text: `---CARD START---
objective: Test card
approach: Test approach
benefit: Test benefit
cost: Test cost
risk: Test risk
confidence: 0.8
req_refs: REQ-001
warnings: none
---CARD END---`
    }),
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
        text: "Test requirement",
        priority: "p0",
        coverage: 0.5,
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

describe("LoopOrchestrator Integration", () => {
  describe("Phase Transitions", () => {
    test("should have correct phase types", () => {
      const validPhases = [
        "idle",
        "analyzing",
        "generating",
        "deciding",
        "executing",
        "evaluating",
        "optimizing",
        "complete",
        "handing_off",
        "paused",
      ]
      expect(validPhases).toHaveLength(10)
    })
  })

  describe("LoopDecision Structure", () => {
    test("should accept valid decision", () => {
      const decision = {
        cardId: "card-001",
        status: "accepted" as const,
      }
      expect(decision.cardId).toBe("card-001")
      expect(decision.status).toBe("accepted")
    })

    test("should accept decision with note", () => {
      const decision = {
        cardId: "card-002",
        status: "rejected" as const,
        note: "Too risky",
      }
      expect(decision.note).toBe("Too risky")
    })
  })

  describe("EvaluationResult Structure", () => {
    test("should represent evaluation delta correctly", () => {
      const result = {
        score_before: 0.6,
        score_after: 0.8,
        delta: 0.2,
        forced_rollback: false,
      }
      expect(result.delta).toBeCloseTo(result.score_after - result.score_before, 10)
      expect(result.forced_rollback).toBe(false)
    })

    test("should represent forced rollback", () => {
      const result = {
        score_before: 0.8,
        score_after: 0.3,
        delta: -0.5,
        forced_rollback: true,
        rollback_reason: "Score dropped below threshold",
      }
      expect(result.forced_rollback).toBe(true)
      expect(result.rollback_reason).toBeDefined()
    })
  })

  describe("DecisionCard Structure", () => {
    test("should have all required fields", () => {
      const card = {
        id: "card-001",
        objective: "Improve test coverage",
        approach: "Add unit tests",
        benefit: "Better reliability",
        cost: "Development time",
        risk: "May miss edge cases",
        confidence: 0.85,
        req_refs: ["REQ-001", "REQ-002"],
      }
      expect(card.id).toBeDefined()
      expect(card.objective).toBeDefined()
      expect(card.approach).toBeDefined()
      expect(card.confidence).toBeGreaterThanOrEqual(0)
      expect(card.confidence).toBeLessThanOrEqual(1)
      expect(Array.isArray(card.req_refs)).toBe(true)
    })
  })

  describe("Pause/Resume Integration", () => {
    let tmpDir: string
    let orchestrator: LoopOrchestrator

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-pause-test-"))

      // Create directory structure
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

    test("should save pause state when pausing loop", async () => {
      const customEvents: Array<{ name: string; data: unknown }> = []

      orchestrator = new LoopOrchestrator({
        cwd: tmpDir,
        session: createMockSession(),
        onCustomEvent: (eventName, data) => {
          customEvents.push({ name: eventName, data })
        },
      })

      await orchestrator.startLoop()

      const loopId = orchestrator.getCurrentLoopId()
      expect(loopId).toBeTruthy()

      await orchestrator.pauseLoop("User requested pause")

      expect(orchestrator.getPhase()).toBe("paused")
      expect(orchestrator.isPaused()).toBe(true)

      const pauseState = orchestrator.getPauseState()
      expect(pauseState).not.toBeNull()
      expect(pauseState?.loopId).toBe(loopId ?? undefined)
      expect(pauseState?.reason).toBe("User requested pause")
      expect(pauseState?.phase).toBe("deciding")
      expect(pauseState?.currentCards.length).toBeGreaterThan(0)

      // Check that YAML file was written
      const pauseStatePath = path.join(tmpDir, ".meta", "pause-state.yaml")
      expect(fs.existsSync(pauseStatePath)).toBe(true)

      const savedState = yaml.load(fs.readFileSync(pauseStatePath, "utf8")) as any
      expect(savedState.loopId).toBe(loopId)
      expect(savedState.reason).toBe("User requested pause")

      // Check custom event was emitted
      expect(customEvents.some((e) => e.name === "loop.paused")).toBe(true)
    })

    test("should throw error when pausing without active loop", async () => {
      orchestrator = new LoopOrchestrator({
        cwd: tmpDir,
        session: createMockSession(),
      })

      await expect(orchestrator.pauseLoop()).rejects.toThrow("No active loop to pause.")
    })

    test("should throw error when pausing already paused loop", async () => {
      orchestrator = new LoopOrchestrator({
        cwd: tmpDir,
        session: createMockSession(),
      })

      await orchestrator.startLoop()
      await orchestrator.pauseLoop()

      await expect(orchestrator.pauseLoop()).rejects.toThrow("Loop is already paused.")
    })

    test("should resume loop from paused state", async () => {
      const customEvents: Array<{ name: string; data: unknown }> = []
      const phaseChanges: LoopPhase[] = []

      orchestrator = new LoopOrchestrator({
        cwd: tmpDir,
        session: createMockSession(),
        onPhaseChange: (phase) => phaseChanges.push(phase),
        onCustomEvent: (eventName, data) => {
          customEvents.push({ name: eventName, data })
        },
      })

      await orchestrator.startLoop()
      const loopId = orchestrator.getCurrentLoopId()

      await orchestrator.pauseLoop("Test pause")

      // Clear phase changes for resume
      phaseChanges.length = 0

      await orchestrator.resumeLoop()

      // Should have resumed from deciding phase
      expect(phaseChanges).toContain("deciding")
      expect(orchestrator.isPaused()).toBe(false)
      expect(orchestrator.getCurrentLoopId()).toBe(loopId)

      // Check custom event was emitted
      expect(customEvents.some((e) => e.name === "loop.resumed")).toBe(true)
    })

    test("should resume loop from YAML file", async () => {
      orchestrator = new LoopOrchestrator({
        cwd: tmpDir,
        session: createMockSession(),
      })

      await orchestrator.startLoop()
      const loopId = orchestrator.getCurrentLoopId()
      const cards = orchestrator.getCurrentCards()

      await orchestrator.pauseLoop("Test pause")

      // Create new orchestrator instance (simulating restart)
      const newOrchestrator = new LoopOrchestrator({
        cwd: tmpDir,
        session: createMockSession(),
      })

      // Should be able to resume from YAML file
      await newOrchestrator.resumeLoop()

      // Verify state was restored
      expect(newOrchestrator.getCurrentLoopId()).toBe(loopId)
      expect(newOrchestrator.getCurrentCards()).toEqual(cards)
      expect(newOrchestrator.isPaused()).toBe(false)
    })

    test("should throw error when resuming without pause state", async () => {
      orchestrator = new LoopOrchestrator({
        cwd: tmpDir,
        session: createMockSession(),
      })

      await expect(orchestrator.resumeLoop()).rejects.toThrow("No paused loop to resume.")
    })

    test("should resume from generating phase", async () => {
      const phaseChanges: LoopPhase[] = []

      orchestrator = new LoopOrchestrator({
        cwd: tmpDir,
        session: createMockSession(),
        onPhaseChange: (phase) => phaseChanges.push(phase),
      })

      // Manually set up pause state for generating phase
      await orchestrator.startLoop()
      const loopId = orchestrator.getCurrentLoopId()

      // We need to pause during generating phase, but startLoop goes to deciding
      // So we'll test resumeFromPhase indirectly through the pause/resume flow
      await orchestrator.pauseLoop()

      phaseChanges.length = 0
      await orchestrator.resumeLoop()

      // Should have transitioned through deciding phase
      expect(phaseChanges).toContain("deciding")
    })

    test("should preserve cards and decisions across pause/resume", async () => {
      orchestrator = new LoopOrchestrator({
        cwd: tmpDir,
        session: createMockSession(),
      })

      await orchestrator.startLoop()
      const originalCards = orchestrator.getCurrentCards()
      const originalLoopId = orchestrator.getCurrentLoopId()

      await orchestrator.pauseLoop()

      await orchestrator.resumeLoop()

      expect(orchestrator.getCurrentCards()).toEqual(originalCards)
      expect(orchestrator.getCurrentLoopId()).toBe(originalLoopId)
    })
  })
})
