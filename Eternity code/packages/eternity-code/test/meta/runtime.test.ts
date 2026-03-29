import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import yaml from "js-yaml"
import { tmpdir } from "../fixture/fixture"
import { loadExecutionPlansForLoop } from "../../src/meta/execute"
import { inferMetaRuntimeStatus, loadMetaRuntimeSnapshot } from "../../src/meta/runtime"

describe("meta runtime snapshot", () => {
  test("filters execution plans by loop id", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".meta", "plans"), { recursive: true })

        await fs.writeFile(
          path.join(dir, ".meta", "plans", "PLAN-001.yaml"),
          yaml.dump({
            id: "PLAN-001",
            card_id: "card-001",
            loop_id: "loop-001",
            interpretation: "accepted plan",
            tasks: [],
            status: "pending",
            git_sha_before: "abc123",
            created_at: "2026-03-27T10:00:00.000Z",
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "plans", "PLAN-002.yaml"),
          yaml.dump({
            id: "PLAN-002",
            card_id: "card-002",
            loop_id: "loop-002",
            interpretation: "pending plan",
            tasks: [],
            status: "pending",
            git_sha_before: "def456",
            created_at: "2026-03-28T10:00:00.000Z",
          }),
        )
      },
    })

    const plans = loadExecutionPlansForLoop(tmp.path, "loop-001")
    expect(plans.map((plan) => plan.id)).toEqual(["PLAN-001"])
  })

  test("builds a unified snapshot for latest and accepted loop views", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".meta", "loops"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "cards"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "plans"), { recursive: true })

        await fs.writeFile(
          path.join(dir, ".meta", "design.yaml"),
          yaml.dump({
            project: {
              name: "Snapshot Test",
              stage: "prototype",
              core_value: "Keep runtime state coherent",
              anti_value: "Mixed execution truth",
            },
            requirements: [],
            rejected_directions: [],
            loop_history: {
              total_loops: 2,
              loops: [],
            },
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "loops", "loop-001.yaml"),
          yaml.dump({
            id: "loop-001",
            sequence: 1,
            status: "completed",
            candidates: {
              presented_cards: ["card-001"],
            },
            decision_session: {
              accepted_cards: ["card-001"],
            },
            execution: {
              plan_ids: ["PLAN-001"],
            },
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "loops", "loop-002.yaml"),
          yaml.dump({
            id: "loop-002",
            sequence: 2,
            status: "running",
            candidates: {
              presented_cards: ["card-002"],
            },
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "cards", "card-001.yaml"),
          yaml.dump({
            id: "card-001",
            loop_id: "loop-001",
            req_refs: [],
            content: {
              objective: "accepted objective",
              approach: "accepted approach",
              benefit: "benefit",
              cost: "cost",
              risk: "risk",
              warnings: [],
            },
            prediction: { confidence: 0.9 },
            decision: { status: "accepted" },
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "cards", "card-002.yaml"),
          yaml.dump({
            id: "card-002",
            loop_id: "loop-002",
            req_refs: [],
            content: {
              objective: "pending objective",
              approach: "pending approach",
              benefit: "benefit",
              cost: "cost",
              risk: "risk",
              warnings: [],
            },
            prediction: { confidence: 0.7 },
            decision: { status: "pending" },
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "plans", "PLAN-001.yaml"),
          yaml.dump({
            id: "PLAN-001",
            card_id: "card-001",
            loop_id: "loop-001",
            interpretation: "accepted plan",
            tasks: [],
            status: "pending",
            git_sha_before: "abc123",
            created_at: "2026-03-27T10:00:00.000Z",
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "plans", "PLAN-002.yaml"),
          yaml.dump({
            id: "PLAN-002",
            card_id: "card-002",
            loop_id: "loop-002",
            interpretation: "latest plan",
            tasks: [],
            status: "pending",
            git_sha_before: "def456",
            created_at: "2026-03-28T10:00:00.000Z",
          }),
        )
      },
    })

    const snapshot = await loadMetaRuntimeSnapshot(tmp.path)

    expect(snapshot.latestLoop?.id).toBe("loop-002")
    expect(snapshot.pendingLoop?.id).toBe("loop-002")
    expect(snapshot.acceptedLoop?.id).toBe("loop-001")
    expect(snapshot.latestPlans.map((plan) => plan.id)).toEqual(["PLAN-002"])
    expect(snapshot.acceptedPlans.map((plan) => plan.id)).toEqual(["PLAN-001"])
    expect(snapshot.stats.totalLoops).toBe(2)
    expect(snapshot.stats.pendingCards).toBe(1)
    expect(snapshot.status.phase).toBe("deciding")
    expect(snapshot.status.loopId).toBe("loop-002")
  })

  test("infers evaluating and complete phases from accepted loop state", () => {
    const evaluating = inferMetaRuntimeStatus({
      latestLoop: undefined,
      pendingLoop: undefined,
      pendingCards: [],
      acceptedLoop: {
        id: "loop-101",
        phase: "optimize",
        evaluation: {
          composite_delta: 0.2,
        },
      },
      acceptedPlans: [],
    })

    const complete = inferMetaRuntimeStatus({
      latestLoop: undefined,
      pendingLoop: undefined,
      pendingCards: [],
      acceptedLoop: {
        id: "loop-102",
        phase: "complete",
        close: {
          summary: "Loop completed successfully",
        },
      },
      acceptedPlans: [],
    })

    expect(evaluating.phase).toBe("evaluating")
    expect(evaluating.loopId).toBe("loop-101")
    expect(complete.phase).toBe("complete")
    expect(complete.desc).toBe("Loop completed successfully")
  })
})
