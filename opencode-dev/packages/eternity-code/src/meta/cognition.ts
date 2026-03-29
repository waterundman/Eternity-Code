/**
 * Compatibility facade for cognition-layer helpers.
 *
 * The implementation lives in `blueprints.ts` and `insights.ts`.
 * Keep this file as a thin wrapper so older imports continue to work.
 */

import { buildBlueprintContext, loadAllBlueprints, loadCurrentBlueprint, writeBlueprint, type Blueprint } from "./blueprints.js"
import { buildInsightsContext, loadAdoptedInsights, loadInsights, updateInsightStatus, writeInsight, type Insight } from "./insights.js"

export type { Blueprint, Insight }

export { loadCurrentBlueprint, loadAllBlueprints, writeBlueprint, loadInsights, loadAdoptedInsights, writeInsight, updateInsightStatus }

export function buildContextFromCognition(cwd: string): string {
  return [buildBlueprintContext(cwd), buildInsightsContext(cwd)].filter(Boolean).join("\n")
}
