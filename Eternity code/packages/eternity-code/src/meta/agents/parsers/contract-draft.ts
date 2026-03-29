/**
 * Contract Draft Parser
 *
 * 解析 contract-drafter 角色的输出
 */

import yaml from "js-yaml"

export interface ContractDraftOutput {
  criteria: string
  verify_command: string
}

export function parseContractDraft(text: string): ContractDraftOutput {
  const block = text.match(/---CONTRACT START---([\s\S]*?)---CONTRACT END---/)
  if (!block) {
    throw new Error("No CONTRACT block found in output")
  }

  try {
    const parsed = yaml.load(block[1].trim()) as any

    return {
      criteria: String(parsed.criteria ?? ""),
      verify_command: String(parsed.verify_command ?? ""),
    }
  } catch (err) {
    throw new Error(`Failed to parse contract draft: ${err}`)
  }
}
