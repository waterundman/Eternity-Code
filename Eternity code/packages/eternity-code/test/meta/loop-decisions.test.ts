import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import yaml from "js-yaml"
import { tmpdir } from "../fixture/fixture"
import { applyLoopDecisions } from "../../src/meta/loop"

describe("loop decisions", () => {
  test("persists dashboard decisions, notes, negatives, and feedback signals", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".meta", "loops"), { recursive: true })
        await fs.mkdir(path.join(dir, ".meta", "cards"), { recursive: true })

        await fs.writeFile(
          path.join(dir, ".meta", "design.yaml"),
          yaml.dump({
            project: {
              id: "loop-decisions-test",
              name: "Loop Decisions Test",
              stage: "prototype",
              core_value: "Persist decisions coherently",
              anti_value: "Shadow decision state",
            },
            requirements: [],
            rejected_directions: [],
            loop_history: {
              total_loops: 1,
              loops: [
                {
                  loop_id: "loop-001",
                  status: "cards_generated",
                  cards_proposed: 2,
                  cards_accepted: 0,
                  cards_rejected: 0,
                  summary: "Pending review",
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
            status: "cards_generated",
            phase: "decide",
            candidates: {
              presented_cards: ["CARD-001", "CARD-002"],
            },
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "cards", "CARD-001.yaml"),
          yaml.dump({
            id: "CARD-001",
            loop_id: "loop-001",
            req_refs: [],
            content: {
              objective: "Accept this improvement",
              approach: "Implement the safe change",
              benefit: "More coherent state",
              cost: "Small implementation effort",
              risk: "Limited",
              warnings: [],
            },
            prediction: {
              confidence: 0.85,
            },
            source: {
              template_id: "template-accept",
              generator: "meta",
            },
            decision: {
              status: "pending",
              chosen_by: null,
              resolved_at: null,
              note: null,
            },
          }),
        )

        await fs.writeFile(
          path.join(dir, ".meta", "cards", "CARD-002.yaml"),
          yaml.dump({
            id: "CARD-002",
            loop_id: "loop-001",
            req_refs: [],
            content: {
              objective: "Reject this risky improvement",
              approach: "Touch too many modules",
              benefit: "Potentially faster development",
              cost: "High refactor risk",
              risk: "Constraint breach",
              warnings: [],
            },
            prediction: {
              confidence: 0.55,
            },
            source: {
              template_id: "template-reject",
              generator: "meta",
            },
            decision: {
              status: "pending",
              chosen_by: null,
              resolved_at: null,
              note: null,
            },
          }),
        )
      },
    })

    const result = await applyLoopDecisions(
      tmp.path,
      "loop-001",
      {
        "CARD-001": "accepted",
        "CARD-002": "rejected",
      },
      {
        "CARD-002": "Breaks scope and constraint boundaries",
      },
      {
        chosenBy: "dashboard",
        recordFeedback: true,
      },
    )

    expect(result.acceptedCards).toEqual(["CARD-001"])
    expect(result.rejectedCards).toEqual(["CARD-002"])
    expect(result.newNegatives.length).toBe(1)

    const acceptedCard = yaml.load(
      await fs.readFile(path.join(tmp.path, ".meta", "cards", "CARD-001.yaml"), "utf8"),
    ) as any
    const rejectedCard = yaml.load(
      await fs.readFile(path.join(tmp.path, ".meta", "cards", "CARD-002.yaml"), "utf8"),
    ) as any

    expect(acceptedCard.decision.status).toBe("accepted")
    expect(acceptedCard.decision.chosen_by).toBe("dashboard")
    expect(rejectedCard.decision.status).toBe("rejected")
    expect(rejectedCard.decision.note).toBe("Breaks scope and constraint boundaries")
    expect(rejectedCard.decision.chosen_by).toBe("dashboard")

    const feedbackDir = path.join(tmp.path, ".meta", "feedback")
    const feedbackFiles = await fs.readdir(feedbackDir)
    const signalFiles = feedbackFiles.filter((file) => file.startsWith("signal-"))
    expect(signalFiles.length).toBe(2)

    const signals = await Promise.all(
      signalFiles.map(async (file) => {
        const content = await fs.readFile(path.join(feedbackDir, file), "utf8")
        return yaml.load(content) as any
      }),
    )

    expect(signals.some((signal) => signal.template_id === "template-accept" && signal.acceptance === true)).toBe(true)
    expect(
      signals.some(
        (signal) =>
          signal.template_id === "template-reject" &&
          signal.acceptance === false &&
          signal.noise_type === "structure",
      ),
    ).toBe(true)
  })
})
