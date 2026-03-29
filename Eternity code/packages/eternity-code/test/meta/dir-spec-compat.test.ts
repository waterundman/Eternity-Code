import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import yaml from "js-yaml"
import { tmpdir } from "../fixture/fixture"
import { loadLoopContext } from "../../src/meta/context-loader"
import { loadDashboardBootstrap } from "../../src/meta/dashboard/data"
import { loadMetaRuntimeSnapshot } from "../../src/meta/runtime"

describe("DIR_SPEC compatibility", () => {
  test("reads runtime, cognition, and dashboard state from the new directory layout", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".meta", "design"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "cognition", "blueprints"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "cognition", "insights"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "execution", "cards"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "execution", "plans"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "execution", "loops"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "execution", "logs"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "execution", "agent-tasks"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "negatives"), { recursive: true })

        await fs.writeFile(
          path.join(dir, ".meta", "design", "design.yaml"),
          yaml.dump({
            project: {
              id: "dir-spec",
              name: "DIR_SPEC Test",
              stage: "mvp",
              core_value: "Single runtime truth",
              anti_value: "Split-brain meta state",
            },
            requirements: [],
            rejected_directions: [],
            loop_history: {
              total_loops: 1,
              loops: [],
            },
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "cognition", "blueprints", "BLUEPRINT-current.yaml"),
          yaml.dump({
            version: "v1",
            created_at: "2026-03-29T10:00:00.000Z",
            created_by: "test",
            current_state: "Unified runtime",
            priorities: [],
            constraints: ["Keep meta state converged"],
            known_debt: [],
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "cognition", "insights", "INS-001.yaml"),
          yaml.dump({
            id: "INS-001",
            title: "Keep runtime converged",
            source: "test",
            category: "architecture",
            insight: "Use one runtime truth for dashboard and loop execution.",
            implications: ["Read both new and legacy paths during migration."],
            status: "adopted",
            created_at: "2026-03-29T10:05:00.000Z",
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "execution", "loops", "loop-001.yaml"),
          yaml.dump({
            id: "loop-001",
            sequence: 1,
            status: "completed",
            decision_session: {
              accepted_cards: ["CARD-001"],
            },
            execution: {
              plan_ids: ["PLAN-001"],
            },
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "execution", "cards", "CARD-001.yaml"),
          yaml.dump({
            id: "CARD-001",
            loop_id: "loop-001",
            req_refs: [],
            content: {
              objective: "Unify meta runtime reads",
              approach: "Read from DIR_SPEC paths",
              benefit: "No state drift",
              cost: "Refactor path helpers",
              risk: "Migration regressions",
              warnings: [],
            },
            prediction: { confidence: 0.92 },
            decision: { status: "accepted" },
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "execution", "plans", "PLAN-001.yaml"),
          yaml.dump({
            id: "PLAN-001",
            card_id: "CARD-001",
            loop_id: "loop-001",
            interpretation: "Patch runtime path helpers",
            tasks: [],
            status: "pending",
            git_sha_before: "abc123",
            created_at: "2026-03-29T10:10:00.000Z",
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "execution", "agent-tasks", "task-001.yaml"),
          yaml.dump({
            id: "task-001",
            role_id: "restructure-planner",
            triggered_by: "manual",
            input: {},
            status: "done",
            duration_ms: 250,
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "execution", "logs", "LOG-20260329-loop-001.md"),
          "# LOG - loop-001\n\n## 完成的工作\n- Unified runtime path access\n",
        )

        await fs.writeFile(
          path.join(dir, ".meta", "negatives", "NEG-001.yaml"),
          yaml.dump({
            id: "NEG-001",
            text: "Do not fork runtime truth again",
            reason: "State drift",
            status: "active",
          }),
        )
      },
    })

    const runtime = await loadMetaRuntimeSnapshot(tmp.path)
    const dashboard = await loadDashboardBootstrap(tmp.path)
    const loopContext = await loadLoopContext(tmp.path)

    expect(runtime.latestLoop?.id).toBe("loop-001")
    expect(runtime.acceptedPlans.map((plan) => plan.id)).toEqual(["PLAN-001"])
    expect(dashboard.agentTasks.map((task) => task.id)).toEqual(["task-001"])
    expect(loopContext.blueprint?.version).toBe("v1")
    expect(loopContext.insights.map((insight) => insight.id)).toEqual(["INS-001"])
    expect(loopContext.negatives.map((negative) => negative.id)).toEqual(["NEG-001"])
    expect(loopContext.recentLogs).toHaveLength(1)
  })
})
