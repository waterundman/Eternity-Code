import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import yaml from "js-yaml"
import { tmpdir } from "../fixture/fixture"
import { handleInsightOutput } from "../../src/meta/insight-handler"
import { handleRestructureOutput } from "../../src/meta/restructure-handler"

describe("cognition handlers", () => {
  test("persists parsed insight payloads without reparsing text", async () => {
    await using tmp = await tmpdir()

    const result = handleInsightOutput(tmp.path, {
      title: "Runtime truth must stay unified",
      source: "manual",
      category: "architecture",
      insight: "Dashboard and loop execution should read one shared runtime snapshot.",
      implications: ["Converge path loading first."],
      related: ["CURRENT_ARCHITECTURE.md"],
    })

    expect(result.success).toBe(true)
    expect(result.insightId).toBe("INS-001")

    const saved = yaml.load(
      await fs.readFile(path.join(tmp.path, ".meta", "cognition", "insights", "INS-001.yaml"), "utf8"),
    ) as any

    expect(saved.title).toBe("Runtime truth must stay unified")
    expect(saved.status).toBe("pending")
  })

  test("persists parsed restructure payloads without forcing text serialization", async () => {
    await using tmp = await tmpdir()

    const result = handleRestructureOutput(tmp.path, {
      diagnosis: {
        overall_health: 0.42,
        primary_issues: ["Split runtime paths", "Unwired commands"],
        path_dependencies: ["session/prompt.ts -> meta command handlers"],
      },
      restructure_plan: {
        approach: "targeted_refactor",
        scope: ["src/meta", "src/session/prompt.ts"],
        preserve: ["dashboard UI contracts"],
        new_architecture: "Introduce a single compatibility layer and route all commands through it.",
      },
      docs_to_update: ["DIR_SPEC.md", "CURRENT_ARCHITECTURE.md"],
      acceptance: ["New and legacy layouts both work", "meta-restructure is persisted end-to-end"],
    })

    expect(result.success).toBe(true)
    expect(result.restructureId).toBe("RESTRUCTURE-001")

    const saved = yaml.load(
      await fs.readFile(path.join(tmp.path, ".meta", "restructures", "RESTRUCTURE-001.yaml"), "utf8"),
    ) as any

    expect(saved.diagnosis.primary_issues).toEqual(["Split runtime paths", "Unwired commands"])
    expect(saved.status).toBe("pending")
  })
})
