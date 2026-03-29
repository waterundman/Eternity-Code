import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import yaml from "js-yaml"
import { tmpdir } from "../fixture/fixture"
import { loadDashboardBootstrap } from "../../src/meta/dashboard/data"

describe("dashboard bootstrap", () => {
  test("aggregates runtime, task, feedback, and usage state into one snapshot", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".meta", "loops"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "cards"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "plans"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "agent-tasks"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "feedback"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "context"), { recursive: true })

        await fs.writeFile(
          path.join(dir, ".meta", "design.yaml"),
          yaml.dump({
            project: {
              id: "dashboard-test",
              name: "Dashboard Test",
              stage: "mvp",
              core_value: "Keep dashboard state coherent",
              anti_value: "Multiple conflicting truths",
            },
            requirements: [
              {
                id: "REQ-001",
                text: "Render a single runtime view",
                priority: "p1",
                coverage: 0.8,
              },
              {
                id: "REQ-002",
                text: "Show weak spots clearly",
                priority: "p1",
                coverage: 0.2,
              },
            ],
            rejected_directions: [],
            loop_history: {
              total_loops: 1,
              loops: [
                {
                  loop_id: "loop-001",
                  status: "completed",
                  tokens_used: 3210,
                  cost: 0.1234,
                },
              ],
            },
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "loops", "loop-001.yaml"),
          yaml.dump({
            id: "loop-001",
            sequence: 1,
            status: "completed",
            decision_session: {
              accepted_cards: ["card-001"],
            },
            execution: {
              plan_ids: ["PLAN-001"],
            },
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "cards", "card-001.yaml"),
          yaml.dump({
            id: "card-001",
            loop_id: "loop-001",
            req_refs: ["REQ-001"],
            content: {
              objective: "Use a bootstrap payload",
              approach: "Aggregate dashboard state server-side",
              benefit: "Less drift",
              cost: "Small refactor",
              risk: "Need to keep contracts aligned",
              warnings: [],
            },
            prediction: { confidence: 0.9 },
            decision: { status: "accepted" },
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "plans", "PLAN-001.yaml"),
          yaml.dump({
            id: "PLAN-001",
            card_id: "card-001",
            loop_id: "loop-001",
            interpretation: "unify dashboard loading",
            tasks: [],
            status: "pending",
            git_sha_before: "abc123",
            created_at: "2026-03-28T10:00:00.000Z",
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "agent-tasks", "task-001.yaml"),
          yaml.dump({
            id: "task-001",
            role_id: "coverage-assessor",
            triggered_by: "loop-001",
            input: {},
            status: "done",
            duration_ms: 120,
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "agent-tasks", "task-002.yaml"),
          yaml.dump({
            id: "task-002",
            role_id: "planner",
            triggered_by: "loop-001",
            input: {},
            status: "failed",
            duration_ms: 80,
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "feedback", "quality-template-bootstrap.yaml"),
          yaml.dump({
            template_id: "template-bootstrap",
            sample_count: 6,
            acceptance_rate: 0.4,
            avg_user_rating: 2,
            execution_success_rate: 0.5,
            quality_score: 0.45,
            last_updated: "2026-03-28T10:00:00.000Z",
            noise_analysis: {
              content_noise: 0.1,
              structure_noise: 0.2,
              prompt_quality_signal: 0.5,
            },
          }),
        )

        await fs.writeFile(
          path.join(dir, "eternity-code.json"),
          JSON.stringify(
            {
              model: "openai/gpt-5.4",
            },
            null,
            2,
          ),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "context", "task-ctx-001.yaml"),
          yaml.dump({
            taskId: "task-ctx-001",
            roleId: "planner",
            triggeredBy: "loop-001",
            createdAt: "2026-03-28T10:05:00.000Z",
            task: "Investigate loop planning",
            targetFiles: ["src/meta/execute.ts"],
            rolePromptTokens: 120,
            finalSystemPromptTokens: 480,
            preview: "[Project State]\\nGoal: Keep state coherent",
            diagnostics: {
              totalTokens: 360,
              recommendedMaxTokens: 400,
              withinBudget: true,
              layerUsage: {
                system: { tokens: 40, limit: 50, truncated: false },
                midTerm: { tokens: 120, limit: 150, truncated: false },
                shortTerm: { tokens: 100, limit: 150, truncated: false },
                longTerm: { tokens: 100, limit: 100, truncated: true },
              },
              longTermSources: [".meta/loops/loop-001.yaml"],
            },
            layers: {
              shortTerm: {
                task: "Investigate loop planning",
                targetFiles: ["src/meta/execute.ts"],
                recentActions: [],
                codeSnippets: [],
              },
              midTerm: {
                currentModule: "Dashboard Test",
                primaryGoal: "Keep dashboard state coherent",
                completed: [],
                pending: ["REQ-002"],
                constraints: [],
              },
              longTerm: {
                results: [
                  {
                    content: "loop-001 execution data",
                    source: ".meta/loops/loop-001.yaml",
                    relevance: 0.8,
                  },
                ],
              },
            },
          }),
        )
      },
    })

    const bootstrap = await loadDashboardBootstrap(tmp.path)

    expect(bootstrap.runtime.acceptedLoop?.id).toBe("loop-001")
    expect(bootstrap.runtime.acceptedPlans.map((plan) => plan.id)).toEqual(["PLAN-001"])
    expect(bootstrap.agentTasks.map((task) => task.id)).toEqual(["task-002", "task-001"])
    expect(bootstrap.agentTaskStats.total).toBe(2)
    expect(bootstrap.agentTaskStats.byStatus.done).toBe(1)
    expect(bootstrap.agentTaskStats.byStatus.failed).toBe(1)
    expect(bootstrap.agentTaskStats.avgDurationMs).toBe(100)
    expect(bootstrap.coverage?.total).toBe(2)
    expect(bootstrap.coverage?.lowCoverage.map((req) => req.id)).toEqual(["REQ-002"])
    expect(bootstrap.latestContext?.taskId).toBe("task-ctx-001")
    expect(bootstrap.latestContext?.diagnostics.longTermSources).toEqual([".meta/loops/loop-001.yaml"])
    expect(bootstrap.feedback.scores.map((score) => score.template_id)).toEqual(["template-bootstrap"])
    expect(bootstrap.feedback.suggestions.length).toBeGreaterThan(0)
    expect(bootstrap.usage.tokens).toBe(3210)
    expect(bootstrap.usage.cost).toBeCloseTo(0.1234)
    expect(bootstrap.currentModel).toBe("openai/gpt-5.4")
  })
})
