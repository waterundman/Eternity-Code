/**
 * Insight Handler
 *
 * 处理 meta-insight 命令的输出，解析并写入到 insights 目录。
 */

import { parseInsight, type ParsedInsight } from "./agents/parsers/insight.js"
import { writeInsight } from "./insights.js"

export interface InsightWriteResult {
  success: boolean
  insightId?: string
  error?: string
}

export function handleInsightOutput(cwd: string, output: string | ParsedInsight): InsightWriteResult {
  const parsed = typeof output === "string" ? parseInsight(output) : output
  if (!parsed) {
    return {
      success: false,
      error: "Failed to parse insight from output",
    }
  }

  try {
    const insightId = writeInsight(cwd, {
      ...parsed,
      status: "pending",
      created_at: new Date().toISOString(),
    })

    return {
      success: true,
      insightId,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function formatInsightResult(result: InsightWriteResult): string {
  if (result.success) {
    return `✅ Insight written: ${result.insightId}`
  } else {
    return `❌ Failed to write insight: ${result.error}`
  }
}
