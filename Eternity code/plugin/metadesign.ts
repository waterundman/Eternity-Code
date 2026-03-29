import * as path from "path"
import * as fs from "fs"
import yaml from "js-yaml"

/**
 * MetaDesign plugin for OpenCode
 * 
 * This plugin automatically parses and saves cards from model output
 * when it detects the card markers.
 */
export default async (input: any) => {
  const { directory } = input

  // Dynamic import to avoid circular dependency
  const { parseCardsFromText, writeCard, loadMetaDesign } = await import("../packages/eternity-code/src/meta/index.js")

  return {
    /**
     * Hook into text completion to parse cards from model output
     */
    "experimental.text.complete": async (input: any, output: any) => {
      const design = await loadMetaDesign(directory)
      if (!design) return

      // Check if the text contains card markers
      if (!output.text.includes("---CARD START---")) return

      // Parse cards from the text
      const cards = parseCardsFromText(output.text)
      if (cards.length === 0) return

      // Generate loop id
      const loopNum = (design.loop_history?.total_loops ?? 0) + 1
      const loopId = `loop-${String(loopNum).padStart(3, "0")}`

      // Create loop directory if it doesn't exist
      const loopDir = path.join(directory, ".meta", "loops")
      if (!fs.existsSync(loopDir)) fs.mkdirSync(loopDir, { recursive: true })

      // Write cards to disk
      const cardIds: string[] = []
      for (const card of cards) {
        const id = await writeCard(directory, card, loopId)
        cardIds.push(id)
      }

      // Create loop record
      const loopPath = path.join(loopDir, `${loopId}.yaml`)
      const loopRecord = {
        _schema_type: "loop_record",
        id: loopId,
        sequence: loopNum,
        started_at: new Date().toISOString(),
        status: "cards_generated",
        phase: "decide",
        candidates: {
          presented_cards: cardIds,
        },
      }
      fs.writeFileSync(loopPath, yaml.dump(loopRecord, { lineWidth: 100 }))

      console.log(`\n[MetaDesign] Generated ${cardIds.length} cards: ${cardIds.join(", ")}`)
      console.log(`[MetaDesign] Cards saved to .meta/cards/`)
      console.log(`[MetaDesign] Loop record: .meta/loops/${loopId}.yaml`)
    },
  }
}
