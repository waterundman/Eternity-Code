/**
 * Meta path registry and compatibility helpers.
 *
 * DIR_SPEC moved runtime state into grouped directories under `.meta/`.
 * Older projects still use the legacy flat layout (`.meta/design.yaml`,
 * `.meta/cards`, `.meta/plans`, `.meta/loops`, ...). The helpers below:
 * - prefer the active layout for the current workspace
 * - read from both layouts during transition
 * - update existing legacy files in place instead of creating split-brain copies
 */

import * as fs from "fs"
import * as path from "path"

export const MetaPaths = {
  root: (cwd: string) => path.join(cwd, ".meta"),

  // DIR_SPEC layout
  design: (cwd: string) => path.join(cwd, ".meta", "design", "design.yaml"),
  schema: (cwd: string) => path.join(cwd, ".meta", "design", "schema"),
  blueprints: (cwd: string) => path.join(cwd, ".meta", "cognition", "blueprints"),
  current: (cwd: string) => path.join(cwd, ".meta", "cognition", "blueprints", "BLUEPRINT-current.yaml"),
  insights: (cwd: string) => path.join(cwd, ".meta", "cognition", "insights"),
  cards: (cwd: string) => path.join(cwd, ".meta", "execution", "cards"),
  plans: (cwd: string) => path.join(cwd, ".meta", "execution", "plans"),
  loops: (cwd: string) => path.join(cwd, ".meta", "execution", "loops"),
  logs: (cwd: string) => path.join(cwd, ".meta", "execution", "logs"),
  agentTasks: (cwd: string) => path.join(cwd, ".meta", "execution", "agent-tasks"),
  anomalies: (cwd: string) => path.join(cwd, ".meta", "execution", "logs", "anomalies"),
  negatives: (cwd: string) => path.join(cwd, ".meta", "negatives"),
  restructures: (cwd: string) => path.join(cwd, ".meta", "restructures"),
  reports: (cwd: string) => path.join(cwd, ".meta", "reports"),
  feedback: (cwd: string) => path.join(cwd, ".meta", "feedback"),
  context: (cwd: string) => path.join(cwd, ".meta", "context"),

  // Legacy layout
  legacyDesign: (cwd: string) => path.join(cwd, ".meta", "design.yaml"),
  legacyCards: (cwd: string) => path.join(cwd, ".meta", "cards"),
  legacyPlans: (cwd: string) => path.join(cwd, ".meta", "plans"),
  legacyLoops: (cwd: string) => path.join(cwd, ".meta", "loops"),
  legacyLogs: (cwd: string) => path.join(cwd, ".meta", "logs"),
  legacyAgentTasks: (cwd: string) => path.join(cwd, ".meta", "agent-tasks"),
} as const

export type MetaPathKey = keyof typeof MetaPaths
export type MetaCompatDirectoryKey = "cards" | "plans" | "loops" | "logs" | "agentTasks"

const PRIMARY_META_DIRS: Record<MetaCompatDirectoryKey, (cwd: string) => string> = {
  cards: MetaPaths.cards,
  plans: MetaPaths.plans,
  loops: MetaPaths.loops,
  logs: MetaPaths.logs,
  agentTasks: MetaPaths.agentTasks,
}

const LEGACY_META_DIRS: Record<MetaCompatDirectoryKey, (cwd: string) => string> = {
  cards: MetaPaths.legacyCards,
  plans: MetaPaths.legacyPlans,
  loops: MetaPaths.legacyLoops,
  logs: MetaPaths.legacyLogs,
  agentTasks: MetaPaths.legacyAgentTasks,
}

export function resolveMetaDesignPath(cwd: string): string {
  const primary = MetaPaths.design(cwd)
  const legacy = MetaPaths.legacyDesign(cwd)

  if (fs.existsSync(primary)) return primary
  if (fs.existsSync(legacy)) return legacy
  return primary
}

export function resolveMetaDirectory(cwd: string, key: MetaCompatDirectoryKey): string {
  const primary = PRIMARY_META_DIRS[key](cwd)
  const legacy = LEGACY_META_DIRS[key](cwd)

  if (fs.existsSync(primary)) return primary
  if (fs.existsSync(legacy)) return legacy
  return primary
}

export function resolveMetaEntryPath(cwd: string, key: MetaCompatDirectoryKey, filename: string): string {
  const primaryPath = path.join(PRIMARY_META_DIRS[key](cwd), filename)
  const legacyPath = path.join(LEGACY_META_DIRS[key](cwd), filename)

  if (fs.existsSync(primaryPath)) return primaryPath
  if (fs.existsSync(legacyPath)) return legacyPath
  return path.join(resolveMetaDirectory(cwd, key), filename)
}

export function listMetaEntryPaths(
  cwd: string,
  key: MetaCompatDirectoryKey,
  extension?: string,
): string[] {
  const activeDir = resolveMetaDirectory(cwd, key)
  const primaryDir = PRIMARY_META_DIRS[key](cwd)
  const legacyDir = LEGACY_META_DIRS[key](cwd)
  const dirs = uniqueStrings([activeDir, primaryDir, legacyDir]).filter((dir) => fs.existsSync(dir))
  const entries = new Map<string, string>()

  for (const dir of dirs) {
    for (const filename of fs.readdirSync(dir)) {
      if (extension && !filename.endsWith(extension)) continue
      if (!entries.has(filename)) {
        entries.set(filename, path.join(dir, filename))
      }
    }
  }

  return [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, filePath]) => filePath)
}

export function listMetaEntryNames(
  cwd: string,
  key: MetaCompatDirectoryKey,
  extension?: string,
): string[] {
  return listMetaEntryPaths(cwd, key, extension).map((filePath) => path.basename(filePath))
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}
