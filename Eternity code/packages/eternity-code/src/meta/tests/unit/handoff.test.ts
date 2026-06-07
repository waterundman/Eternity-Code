import { describe, test, expect, mock } from "bun:test"
import {
  isHandoffCycle,
  isHandoffDepthExceeded,
  validateHandoffRoute,
  MAX_HANDOFF_DEPTH,
  MAX_VISITS_PER_ROLE,
} from "../../utils/handoff.js"
import { HandoffTrace, isHandoffResult } from "../../agents/handoff.js"

describe("isHandoffCycle", () => {
  test("should return false when role not visited", () => {
    const visited = new Map<string, number>()
    expect(isHandoffCycle("planner", visited)).toBe(false)
  })

  test("should return false when role visited once (below default max=2)", () => {
    const visited = new Map([["planner", 1]])
    expect(isHandoffCycle("planner", visited)).toBe(false)
  })

  test("should return true when role visited >= maxVisits", () => {
    const visited = new Map([["planner", 2]])
    expect(isHandoffCycle("planner", visited)).toBe(true)
  })

  test("should return true when role visited > maxVisits", () => {
    const visited = new Map([["planner", 5]])
    expect(isHandoffCycle("planner", visited)).toBe(true)
  })

  test("should respect custom maxVisits parameter", () => {
    const visited = new Map([["planner", 3]])
    expect(isHandoffCycle("planner", visited, 3)).toBe(true)
    expect(isHandoffCycle("planner", visited, 4)).toBe(false)
  })

  test("should check different roles independently", () => {
    const visited = new Map([
      ["planner", 2],
      ["reviewer", 0],
    ])
    expect(isHandoffCycle("planner", visited)).toBe(true)
    expect(isHandoffCycle("reviewer", visited)).toBe(false)
  })
})

describe("isHandoffDepthExceeded", () => {
  test("should return false when depth is 0", () => {
    expect(isHandoffDepthExceeded(0)).toBe(false)
  })

  test("should return false when depth below default max", () => {
    expect(isHandoffDepthExceeded(5)).toBe(false)
  })

  test("should return true when depth >= default max", () => {
    expect(isHandoffDepthExceeded(MAX_HANDOFF_DEPTH)).toBe(true)
  })

  test("should return true when depth > default max", () => {
    expect(isHandoffDepthExceeded(100)).toBe(true)
  })

  test("should respect custom maxDepth parameter", () => {
    expect(isHandoffDepthExceeded(3, 3)).toBe(true)
    expect(isHandoffDepthExceeded(2, 3)).toBe(false)
  })
})

describe("validateHandoffRoute", () => {
  test("should return false for unregistered roles", () => {
    // 未注册的角色无法进行 handoff
    expect(validateHandoffRoute("planner", "executor")).toBe(false)
  })

  test("should return false for unknown roles", () => {
    expect(validateHandoffRoute("unknown-role", "another-unknown")).toBe(false)
  })

  test("should return false when from role has no handoffs", () => {
    // 如果角色没有定义 handoffs，返回 false
    expect(validateHandoffRoute("nonexistent", "target")).toBe(false)
  })
})

describe("HandoffTrace", () => {
  test("should start with empty entries", () => {
    const trace = new HandoffTrace()
    expect(trace.getEntries()).toHaveLength(0)
    expect(trace.getChain()).toEqual([])
  })

  test("should record handoff entries", () => {
    const trace = new HandoffTrace()
    trace.record({
      handoff_id: "ho-1",
      from_role_id: "planner",
      to_role_id: "executor",
      context_variables: {},
      reason: "test",
    })
    expect(trace.getEntries()).toHaveLength(1)
  })

  test("should build correct chain", () => {
    const trace = new HandoffTrace()
    trace.record({
      handoff_id: "ho-1",
      from_role_id: "planner",
      to_role_id: "executor",
      context_variables: {},
      reason: "first",
    })
    trace.record({
      handoff_id: "ho-2",
      from_role_id: "executor",
      to_role_id: "reviewer",
      context_variables: {},
      reason: "second",
    })
    expect(trace.getChain()).toEqual(["planner", "executor", "reviewer"])
  })

  test("should serialize to JSON", () => {
    const trace = new HandoffTrace()
    trace.record({
      handoff_id: "ho-1",
      from_role_id: "planner",
      to_role_id: "executor",
      context_variables: { key: "value" },
      reason: "test",
    })
    const json = trace.toJSON()
    expect(json).toHaveLength(1)
    expect(json[0]!.handoff_id).toBe("ho-1")
    expect(json[0]!.context_variables).toEqual({ key: "value" })
  })
})

describe("isHandoffResult", () => {
  test("should return true for valid HandoffResult", () => {
    const result = {
      type: "handoff" as const,
      target_role_id: "executor",
      context_variables: {},
      reason: "test",
      handoff_id: "ho-123",
    }
    expect(isHandoffResult(result)).toBe(true)
  })

  test("should return false for non-handoff object", () => {
    expect(isHandoffResult({ type: "other" })).toBe(false)
    expect(isHandoffResult({ foo: "bar" })).toBe(false)
  })

  test("should return false for null/undefined", () => {
    expect(isHandoffResult(null)).toBe(false)
    expect(isHandoffResult(undefined)).toBe(false)
  })

  test("should return false for primitives", () => {
    expect(isHandoffResult("handoff")).toBe(false)
    expect(isHandoffResult(42)).toBe(false)
  })
})
