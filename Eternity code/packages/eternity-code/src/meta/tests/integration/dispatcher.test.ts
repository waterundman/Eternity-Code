import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import type { Session } from "../../types.js"
import type { AgentRole } from "../../agents/types.js"

// Mock design loading to return null (no design file needed for tests)
mock.module("../../design.js", () => ({
  loadMetaDesign: async () => null,
}))

// Mock context-mixer to avoid file system dependencies
mock.module("../../context-mixer.js", () => ({
  createContextMixer: () => null,
  estimateTokens: (text: string) => Math.ceil(text.length / 4),
  saveContextMixSnapshot: () => {},
  truncateToTokens: (text: string) => text,
}))

// Mock prompt optimizer to pass through unchanged
mock.module("../../prompt/index.js", () => ({
  PromptOptimizer: class {
    optimize(prompt: string) {
      return { optimized_prompt: prompt, changes: [] }
    }
    calculateMetrics(prompt: string) {
      return { score: 1, issues: [], suggestions: [] }
    }
    analyzeQuality(prompt: string) {
      return { score: 1, issues: [], suggestions: [] }
    }
  },
  DEFAULT_PROMPT_CONFIG: {},
}))

// Mock parsers to add a JSON passthrough parser for testing handoff detection
mock.module("../../agents/parsers/index.js", () => ({
  getParser: (id: string) => {
    if (id === "test-json") {
      return (text: string) => {
        try {
          return JSON.parse(text)
        } catch {
          return text
        }
      }
    }
    // Fallback: return a passthrough parser
    return (text: string) => text
  },
}))

import { registerRole, resetRegistry } from "../../agents/registry.js"
import { Dispatcher } from "../../agents/dispatcher.js"
import { HandoffTrace, isHandoffResult } from "../../agents/handoff.js"

// ─── Test Roles ───

const plannerRole: AgentRole = {
  id: "test-planner",
  name: "Test Planner",
  description: "Plans tasks for testing",
  context_needs: ["none"],
  system_prompt: "You are a test planner.",
  output_format: "Return a JSON plan.",
  output_parser: "test-json",
  timeout_ms: 5000,
  handoffs: [
    {
      target_role_id: "test-executor",
      description: "Hand off to executor for implementation",
    },
  ],
}

const executorRole: AgentRole = {
  id: "test-executor",
  name: "Test Executor",
  description: "Executes tasks for testing",
  context_needs: ["none"],
  system_prompt: "You are a test executor.",
  output_format: "Return execution result.",
  output_parser: "test-json",
  timeout_ms: 5000,
}

const handoffChainRole: AgentRole = {
  id: "test-chain-starter",
  name: "Test Chain Starter",
  description: "Starts a handoff chain",
  context_needs: ["none"],
  system_prompt: "You start handoff chains.",
  output_format: "Return result.",
  output_parser: "test-json",
  timeout_ms: 5000,
  handoffs: [
    {
      target_role_id: "test-chain-middle",
      description: "Hand off to middle",
    },
  ],
}

const chainMiddleRole: AgentRole = {
  id: "test-chain-middle",
  name: "Test Chain Middle",
  description: "Middle of handoff chain",
  context_needs: ["none"],
  system_prompt: "You are in the middle.",
  output_format: "Return result.",
  output_parser: "test-json",
  timeout_ms: 5000,
  handoffs: [
    {
      target_role_id: "test-executor",
      description: "Hand off to executor",
    },
  ],
}

// ─── Mock Session Factory ───

function createMockSession(response: unknown): Session {
  return {
    prompt: mock(async () => response),
    createSubtask: mock(async () => response),
  }
}

function createHandoffSession(
  handoffResponse: unknown,
  finalResponse: unknown,
): Session {
  let callCount = 0
  return {
    prompt: mock(async () => {
      callCount++
      return callCount === 1 ? handoffResponse : finalResponse
    }),
    createSubtask: mock(async () => {
      callCount++
      return callCount === 1 ? handoffResponse : finalResponse
    }),
  }
}

// ─── Helper: Create temp directory for test ───

function createTempCwd(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatcher-test-"))
  fs.mkdirSync(path.join(tmpDir, ".meta"), { recursive: true })
  return tmpDir
}

function cleanupTempCwd(cwd: string): void {
  try {
    fs.rmSync(cwd, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
}

// ─── Tests ───

describe("Dispatcher Integration", () => {
  let tmpCwd: string

  beforeEach(() => {
    resetRegistry()
    tmpCwd = createTempCwd()
  })

  afterEach(() => {
    resetRegistry()
    cleanupTempCwd(tmpCwd)
  })

  describe("dispatch() normal flow", () => {
    test("should dispatch to a registered role and return parsed output", async () => {
      registerRole(plannerRole)
      const mockOutput = {
        goal: "test goal",
        steps: ["step1", "step2"],
      }
      const session = createMockSession(JSON.stringify(mockOutput))
      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
      })

      const result = await dispatcher.dispatch("test-planner", { task: "plan something" })

      expect(result).toBeDefined()
      expect(session.createSubtask).toHaveBeenCalledTimes(1)
    })

    test("should throw for unknown role", async () => {
      registerRole(plannerRole)
      const session = createMockSession("ok")
      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
      })

      await expect(
        dispatcher.dispatch("nonexistent-role", { task: "test" }),
      ).rejects.toThrow("Unknown agent role: nonexistent-role")
    })

    test("should call onTaskStart and onTaskComplete callbacks", async () => {
      registerRole(plannerRole)
      const session = createMockSession(JSON.stringify({ goal: "test" }))
      const onTaskStart = mock(() => {})
      const onTaskComplete = mock(() => {})

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
        onTaskStart,
        onTaskComplete,
      })

      await dispatcher.dispatch("test-planner", { task: "test" })

      expect(onTaskStart).toHaveBeenCalledTimes(1)
      expect(onTaskComplete).toHaveBeenCalledTimes(1)
    })

    test("should call onTaskFail on error", async () => {
      registerRole(plannerRole)
      const session: Session = {
        prompt: mock(async () => {
          throw new Error("LLM failure")
        }),
      }
      const onTaskFail = mock(() => {})

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
        onTaskFail,
      })

      await expect(
        dispatcher.dispatch("test-planner", { task: "test" }),
      ).rejects.toThrow("LLM failure")

      expect(onTaskFail).toHaveBeenCalledTimes(1)
    })

    test("should use createSubtask when available", async () => {
      registerRole(plannerRole)
      const session = createMockSession(JSON.stringify({ goal: "test" }))
      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
      })

      await dispatcher.dispatch("test-planner", { task: "test" })

      expect(session.createSubtask).toHaveBeenCalledTimes(1)
    })
  })

  describe("dispatchWithTrace() handoff routing", () => {
    test("should return DispatchResult with no handoff trace for normal dispatch", async () => {
      registerRole(plannerRole)
      const mockOutput = { goal: "planned" }
      const session = createMockSession(JSON.stringify(mockOutput))
      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
      })

      const result = await dispatcher.dispatchWithTrace("test-planner", { task: "test" })

      expect(result.value).toBeDefined()
      expect(result.handed_off).toBe(false)
      expect(result.handoff_trace).toBeNull()
    })

    test("should route handoff to target agent and return final result", async () => {
      registerRole(plannerRole)
      registerRole(executorRole)

      const handoffResult = {
        type: "handoff",
        target_role_id: "test-executor",
        context_variables: { plan: "do something" },
        reason: "needs execution",
        handoff_id: "ho-test-001",
      }
      const finalResult = { status: "executed" }

      const session = createHandoffSession(
        JSON.stringify(handoffResult),
        JSON.stringify(finalResult),
      )

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
      })

      const result = await dispatcher.dispatchWithTrace("test-planner", { task: "test" })

      expect(result.handed_off).toBe(true)
      expect(result.handoff_trace).not.toBeNull()
      expect(result.handoff_trace!.getEntries()).toHaveLength(1)
      expect(result.handoff_trace!.getChain()).toEqual(["test-planner", "test-executor"])
    })

    test("should throw when handoff target role not found", async () => {
      const roleWithBadHandoff: AgentRole = {
        ...plannerRole,
        id: "test-bad-planner",
        handoffs: [
          {
            target_role_id: "nonexistent-agent",
            description: "Bad handoff target",
          },
        ],
      }
      registerRole(roleWithBadHandoff)

      const handoffResult = {
        type: "handoff",
        target_role_id: "nonexistent-agent",
        context_variables: {},
        reason: "test",
        handoff_id: "ho-bad-001",
      }
      const session = createMockSession(JSON.stringify(handoffResult))

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
      })

      await expect(
        dispatcher.dispatchWithTrace("test-bad-planner", { task: "test" }),
      ).rejects.toThrow("Handoff target role not found: nonexistent-agent")
    })

    test("should throw when handoff route is not allowed", async () => {
      // Register roles without handoff definition from planner to executor
      const isolatedRole: AgentRole = {
        ...plannerRole,
        id: "test-isolated",
        handoffs: undefined,
      }
      registerRole(isolatedRole)
      registerRole(executorRole)

      const handoffResult = {
        type: "handoff",
        target_role_id: "test-executor",
        context_variables: {},
        reason: "test",
        handoff_id: "ho-illegal-001",
      }
      const session = createMockSession(JSON.stringify(handoffResult))

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
      })

      await expect(
        dispatcher.dispatchWithTrace("test-isolated", { task: "test" }),
      ).rejects.toThrow("is not allowed to handoff to")
    })

    test("should handle multi-step handoff chain", async () => {
      registerRole(handoffChainRole)
      registerRole(chainMiddleRole)
      registerRole(executorRole)

      let callIndex = 0
      const responses = [
        JSON.stringify({
          type: "handoff",
          target_role_id: "test-chain-middle",
          context_variables: { step: 1 },
          reason: "first handoff",
          handoff_id: "ho-chain-001",
        }),
        JSON.stringify({
          type: "handoff",
          target_role_id: "test-executor",
          context_variables: { step: 2 },
          reason: "second handoff",
          handoff_id: "ho-chain-002",
        }),
        JSON.stringify({ status: "done", step: 3 }),
      ]

      const session: Session = {
        prompt: mock(async () => responses[callIndex++]!),
        createSubtask: mock(async () => responses[callIndex++]!),
      }

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
      })

      const result = await dispatcher.dispatchWithTrace("test-chain-starter", { task: "chain test" })

      expect(result.handed_off).toBe(true)
      expect(result.handoff_trace!.getEntries()).toHaveLength(2)
      expect(result.handoff_trace!.getChain()).toEqual([
        "test-chain-starter",
        "test-chain-middle",
        "test-executor",
      ])
    })

    test("should merge context_variables into input for handoff target", async () => {
      registerRole(plannerRole)
      registerRole(executorRole)

      const handoffResult = {
        type: "handoff",
        target_role_id: "test-executor",
        context_variables: { plan_details: "detailed plan" },
        reason: "execution needed",
        handoff_id: "ho-merge-001",
      }
      const session = createHandoffSession(
        JSON.stringify(handoffResult),
        JSON.stringify({ done: true }),
      )

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
      })

      await dispatcher.dispatchWithTrace("test-planner", { task: "original task" })

      // Verify createSubtask was called (used for handoff target)
      expect(session.createSubtask).toHaveBeenCalled()
    })
  })

  describe("watchdog guard integration", () => {
    test("should wrap dispatch with watchdog guard when enabled", async () => {
      registerRole(plannerRole)
      const session = createMockSession(JSON.stringify({ goal: "test" }))

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: true,
        enablePromptOptimization: false,
        enableContextMixer: false,
        watchdogConfig: {
          max_tool_calls: 10,
          max_repeated_calls: 3,
          call_timeout_ms: 10000,
          max_retries: 1,
          retry_base_delay_ms: 100,
          circuit_breaker_threshold: 3,
          circuit_reset_ms: 60000,
        },
      })

      const result = await dispatcher.dispatch("test-planner", { task: "test" })
      expect(result).toBeDefined()
    })

    test("should provide watchdog status when enabled", async () => {
      registerRole(plannerRole)
      const session = createMockSession(JSON.stringify({ goal: "test" }))

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: true,
        enablePromptOptimization: false,
        enableContextMixer: false,
      })

      const status = dispatcher.getWatchdogStatus()
      expect(status).not.toBeNull()
      expect(status!.healthy).toBe(true)
      expect(status!.open_breakers).toEqual([])
    })

    test("should return null watchdog status when disabled", async () => {
      registerRole(plannerRole)
      const session = createMockSession(JSON.stringify({ goal: "test" }))

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
      })

      const status = dispatcher.getWatchdogStatus()
      expect(status).toBeNull()
    })

    test("should provide performance monitor", async () => {
      registerRole(plannerRole)
      const session = createMockSession(JSON.stringify({ goal: "test" }))

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
      })

      const monitor = dispatcher.getPerformanceMonitor()
      expect(monitor).toBeDefined()
      expect(typeof monitor.getStats).toBe("function")
    })
  })

  describe("analyzePrompt and optimization", () => {
    test("should return null analysis when optimization disabled", async () => {
      registerRole(plannerRole)
      const session = createMockSession("ok")

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: false,
        enableContextMixer: false,
      })

      const analysis = dispatcher.analyzePrompt("test-planner")
      expect(analysis).toBeNull()
    })

    test("should return analysis when optimization enabled", async () => {
      registerRole(plannerRole)
      const session = createMockSession("ok")

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: true,
        enableContextMixer: false,
      })

      const analysis = dispatcher.analyzePrompt("test-planner")
      expect(analysis).toBeDefined()
    })

    test("should return null for unknown role analysis", async () => {
      registerRole(plannerRole)
      const session = createMockSession("ok")

      const dispatcher = new Dispatcher({
        cwd: tmpCwd,
        session,
        enableWatchdog: false,
        enablePromptOptimization: true,
        enableContextMixer: false,
      })

      const analysis = dispatcher.analyzePrompt("nonexistent")
      expect(analysis).toBeNull()
    })
  })
})
