/**
 * Loop context loader.
 *
 * This follows the DIR_SPEC loading order:
 * 1. design (full)
 * 2. negatives (full)
 * 3. current blueprint
 * 4. adopted insights
 * 5. recent execution logs
 */

import * as fs from "fs"
import * as path from "path"
import yaml from "js-yaml"
import { loadMetaDesign } from "./design.js"
import { loadCurrentBlueprint, type Blueprint } from "./blueprints.js"
import { loadAdoptedInsights, type Insight } from "./insights.js"
import { loadRecentLogs } from "./execution/logs.js"
import type { MetaDesign, RejectedDirection } from "./types.js"
import { MetaPaths } from "./paths.js"

export interface LoopContext {
  design: MetaDesign | null
  negatives: RejectedDirection[]
  blueprint: Blueprint | null
  insights: Insight[]
  recentLogs: string[]
}

export async function loadLoopContext(cwd: string): Promise<LoopContext> {
  return {
    design: await loadMetaDesign(cwd),
    negatives: loadActiveNegatives(cwd),
    blueprint: loadCurrentBlueprint(cwd),
    insights: loadAdoptedInsights(cwd),
    recentLogs: loadRecentLogs(cwd, 3),
  }
}

function loadActiveNegatives(cwd: string): RejectedDirection[] {
  const dir = MetaPaths.negatives(cwd)
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .map((file) => {
      try {
        return yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) as RejectedDirection
      } catch {
        return null
      }
    })
    .filter((entry): entry is RejectedDirection => entry !== null && entry.status === "active")
}
