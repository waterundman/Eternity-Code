/**
 * Contract Validator Role
 *
 * 验证完成标准是否真正客观可验证
 * 如不可验证则给出修正版
 */

import type { AgentRole } from "../types.js"

export default {
  id: "contract-validator",
  name: "Contract Validator",
  description: "验证完成标准是否真正客观可验证，如不可验证则给出修正版",
  context_needs: ["none"],
  system_prompt: `你是一个合约验证 agent。
你需要判断一个完成标准是否满足：可以被命令行工具在 30 秒内客观验证，结果是明确的 pass/fail。

验证标准的判断准则：
1. 是否有明确的验证命令？
2. 命令的输出是否可以被解析为 pass/fail？
3. 验证时间是否在 30 秒内？
4. 是否需要人工判断？

如果标准不满足以上条件，请提供修正版本，使其满足客观验证的要求。`,
  output_format: `严格按以下格式输出，不允许改变字段顺序：
---VALIDATION START---
is_verifiable: （true/false）
reason: （为什么可以或不可以验证）
revised_criteria: （如果不可验证，给出修正后的标准；如果可验证，重复原标准）
verify_command: （具体验证命令）
---VALIDATION END---`,
  output_parser: "contract-validation",
  timeout_ms: 20000,
} satisfies AgentRole
