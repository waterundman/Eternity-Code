import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"
import type { Plugin } from "@eternity-code/plugin"
import { parseCardsFromText, writeCard } from "./cards.js"
import { loadMetaDesign } from "./design.js"
import { MetaPaths } from "./paths.js"

/**
 * MetaDesign plugin for Eternity Code.
 *
 * This plugin hooks into text completion events and automatically persists
 * generated decision cards when the assistant emits the expected card format.
 */
export const metaDesignPlugin: Plugin = async (input) => {
  const { directory } = input

  return {
    "experimental.text.complete": async (hookInput, output) => {
      const design = await loadMetaDesign(directory)
      if (!design) return

      if (!output.text.includes("---CARD START---")) return

      const cards = parseCardsFromText(output.text)
      if (cards.length === 0) return

      const loopNum = (design.loop_history?.total_loops ?? 0) + 1
      const loopId = `loop-${String(loopNum).padStart(3, "0")}`

      const loopDir = MetaPaths.loops(directory)
      if (!fs.existsSync(loopDir)) fs.mkdirSync(loopDir, { recursive: true })

      const cardIds: string[] = []
      for (const card of cards) {
        const id = await writeCard(directory, card, loopId)
        cardIds.push(id)
      }

      const loopPath = path.join(loopDir, `${loopId}.yaml`)
      const loopRecord = {
        _schema_type: "loop_record",
        id: loopId,
        sequence: loopNum,
        started_at: new Date().toISOString(),
        status: "cards_generated",
        phase: "decide",
        message_id: hookInput.messageID,
        candidates: {
          presented_cards: cardIds,
        },
      }
      fs.writeFileSync(loopPath, yaml.dump(loopRecord, { lineWidth: 100 }))

      console.log(`\n[MetaDesign] Generated ${cardIds.length} cards: ${cardIds.join(", ")}`)
      console.log(`[MetaDesign] Cards saved to ${MetaPaths.cards(directory)}`)
      console.log(`[MetaDesign] Loop record: ${loopPath}`)
      console.log("[MetaDesign] Review the generated cards with /meta-decide.")
    },

    "command.execute.before": async (hookInput) => {
      if (hookInput.command !== "meta") return

      const design = await loadMetaDesign(directory)
      if (!design) {
        console.log("[MetaDesign] No design.yaml found in this project.")
        console.log("Run /meta-init first, or create design.yaml manually.")
      }
    },
  }
}

export default metaDesignPlugin
