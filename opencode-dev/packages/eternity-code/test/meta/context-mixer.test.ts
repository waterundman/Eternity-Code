import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import {
  ContextMixer,
  estimateTokens,
  loadLatestContextMixSnapshot,
  saveContextMixSnapshot,
} from "../../src/meta/context-mixer"
import { tmpdir } from "../fixture/fixture"

describe("context mixer", () => {
  test("enforces layer budgets and persists context snapshots", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".meta"), { recursive: true })
      },
    })

    const mixer = new ContextMixer({
      budget: {
        total: 200,
        system: { maxTokens: 40, maxPercent: 0.2 },
        midTerm: { maxTokens: 80, maxPercent: 0.4 },
        shortTerm: { maxTokens: 80, maxPercent: 0.4 },
        longTerm: { maxTokens: 60, maxPercent: 0.3 },
      },
    })

    const shortTerm = mixer.buildShortTermContext(
      "Investigate execution planning drift " + "task ".repeat(80),
      ["src/meta/execute.ts", "src/meta/runtime.ts"],
      ["opened runtime snapshot", "checked plan filtering"],
      [
        {
          file: "src/meta/execute.ts",
          content: "const plan = createPlan();\n".repeat(120),
          relevance: 0.95,
        },
      ],
    )

    const midTerm = {
      currentModule: "Meta runtime",
      primaryGoal: "Keep context stable across iterations",
      completed: ["runtime bootstrap", "dashboard aggregation"],
      pending: Array.from({ length: 12 }, (_, i) => `REQ-${String(i + 1).padStart(3, "0")}`),
      constraints: ["no destructive rewrite", "keep loop-scoped state isolated", "stay within budget"],
    }

    const longTerm = {
      results: [
        {
          content: "execution planning history ".repeat(80),
          source: ".meta/loops/loop-001.yaml",
          relevance: 0.9,
        },
        {
          content: "evaluation rollback summary ".repeat(80),
          source: ".meta/reports/eval-loop-001.md",
          relevance: 0.7,
        },
      ],
    }

    const result = await mixer.mixDetailed(shortTerm, midTerm, longTerm, "MetaDesign system ".repeat(40))

    expect(result.diagnostics.totalTokens).toBeLessThanOrEqual(result.diagnostics.recommendedMaxTokens)
    expect(result.diagnostics.layerUsage.system.limit).toBe(40)
    expect(result.diagnostics.layerUsage.longTerm.truncated).toBe(true)

    saveContextMixSnapshot(tmp.path, {
      taskId: "task-context-001",
      roleId: "planner",
      triggeredBy: "loop-101",
      createdAt: "2026-03-28T12:00:00.000Z",
      task: shortTerm.task,
      targetFiles: shortTerm.targetFiles,
      rolePromptTokens: 120,
      finalSystemPromptTokens: estimateTokens(result.text) + 120,
      preview: result.text,
      diagnostics: result.diagnostics,
      layers: {
        shortTerm,
        midTerm,
        longTerm,
      },
    })

    const latest = loadLatestContextMixSnapshot(tmp.path)
    expect(latest?.taskId).toBe("task-context-001")
    expect(latest?.diagnostics.totalTokens).toBe(result.diagnostics.totalTokens)
  })

  test("retrieves relevant nested .meta sources recursively", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".meta", "loops"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "reports"), { recursive: true })

        await fs.writeFile(
          path.join(dir, ".meta", "loops", "loop-001.yaml"),
          [
            "loop: loop-001",
            "summary: execution planning improved runtime state",
            "notes: execution planning preflight runtime alignment",
          ].join("\n"),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "reports", "eval-loop-001.md"),
          [
            "# Evaluation",
            "rollback risk analysis",
            "runtime health remained stable",
          ].join("\n"),
        )
      },
    })

    const mixer = new ContextMixer({ ragTopK: 2 })
    const memory = await mixer.buildLongTermMemory("execution planning runtime", tmp.path)

    expect(memory.results.length).toBeGreaterThan(0)
    expect(memory.results[0]?.source).toBe(".meta/loops/loop-001.yaml")
    expect(memory.results.some((result) => result.source === ".meta/reports/eval-loop-001.md")).toBe(true)
  })
})
