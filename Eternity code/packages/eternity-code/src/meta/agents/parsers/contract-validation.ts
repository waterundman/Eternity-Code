/**
 * Contract Validation Parser
 *
 * 解析 contract-validator 角色的输出
 */

import yaml from "js-yaml"

export interface ContractValidationOutput {
  is_verifiable: boolean
  reason: string
  revised_criteria: string
  verify_command: string
}

export function parseContractValidation(text: string): ContractValidationOutput {
  const block = text.match(/---VALIDATION START---([\s\S]*?)---VALIDATION END---/)
  if (!block) {
    throw new Error("No VALIDATION block found in output")
  }

  try {
    const parsed = yaml.load(block[1].trim()) as any

    return {
      is_verifiable: parsed.is_verifiable === true || parsed.is_verifiable === "true",
      reason: String(parsed.reason ?? ""),
      revised_criteria: String(parsed.revised_criteria ?? ""),
      verify_command: String(parsed.verify_command ?? ""),
    }
  } catch (err) {
    throw new Error(`Failed to parse contract validation: ${err}`)
  }
}
