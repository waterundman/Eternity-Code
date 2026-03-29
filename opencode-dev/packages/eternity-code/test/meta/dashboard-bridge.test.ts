import { describe, expect, test } from "bun:test"
import {
  getDashboardSessionBridge,
  registerDashboardSessionBridge,
  type DashboardSessionBridge,
} from "../../src/meta/dashboard/bridge"

function createBridge(label: string): DashboardSessionBridge {
  return {
    getStatus() {
      return {
        attached: true,
        routeType: "loop",
        sessionID: `${label}-session`,
      }
    },
    async startLoop() {
      return {
        sessionID: `${label}-session`,
        createdSession: false,
        routeType: "loop",
        message: `${label}-started`,
      }
    },
    async prompt() {
      return `${label}-prompt`
    },
  }
}

describe("dashboard session bridge registry", () => {
  test("registers and unregisters bridges by normalized cwd", () => {
    const bridge = createBridge("alpha")
    const dispose = registerDashboardSessionBridge("workspace/demo", bridge)

    expect(getDashboardSessionBridge("workspace/demo")).toBe(bridge)
    expect(getDashboardSessionBridge("./workspace/demo")).toBe(bridge)

    dispose()

    expect(getDashboardSessionBridge("workspace/demo")).toBeUndefined()
  })

  test("does not let an old disposer remove a newer bridge", () => {
    const first = createBridge("first")
    const second = createBridge("second")

    const disposeFirst = registerDashboardSessionBridge("workspace/reused", first)
    const disposeSecond = registerDashboardSessionBridge("workspace/reused", second)

    disposeFirst()
    expect(getDashboardSessionBridge("workspace/reused")).toBe(second)

    disposeSecond()
    expect(getDashboardSessionBridge("workspace/reused")).toBeUndefined()
  })
})
