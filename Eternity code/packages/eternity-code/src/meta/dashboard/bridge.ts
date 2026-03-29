import path from "path"
import type { Session } from "../types.js"

export interface DashboardBridgeStatus {
  attached: boolean
  routeType?: "home" | "session" | "loop"
  sessionID?: string
  workspaceID?: string
  agent?: string
  model?: string
  variant?: string
  pendingLoopStart?: boolean
}

export interface DashboardStartLoopResult {
  sessionID: string
  createdSession: boolean
  routeType: "home" | "session" | "loop"
  agent?: string
  model?: string
  variant?: string
  message: string
}

export interface DashboardSessionBridge extends Session {
  getStatus(): DashboardBridgeStatus
  startLoop(): Promise<DashboardStartLoopResult>
}

const bridges = new Map<string, DashboardSessionBridge>()

function normalizeCwd(cwd: string) {
  return path.resolve(cwd)
}

export function registerDashboardSessionBridge(cwd: string, bridge: DashboardSessionBridge) {
  const key = normalizeCwd(cwd)
  bridges.set(key, bridge)
  return () => {
    if (bridges.get(key) === bridge) {
      bridges.delete(key)
    }
  }
}

export function getDashboardSessionBridge(cwd: string) {
  return bridges.get(normalizeCwd(cwd))
}
