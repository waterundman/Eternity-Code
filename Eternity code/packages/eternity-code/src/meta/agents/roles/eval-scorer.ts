/**
 * Eval Scorer Role
 *
 * 对评估因子进行打分
 * 支持真实工具调用，基于真实测量而非推断
 */

import type { AgentRole } from "../types.js"

export default {
  id: "eval-scorer",
  name: "Eval Scorer",
  description: "运行评估脚本，获取真实测量值",
  context_needs: ["eval_factors"],
  tools: ["bash", "read"],
  system_prompt: `你是一个评估执行 agent。
你必须真正运行 measurement_spec 里定义的命令来获取测量值，
不允许通过阅读代码来推断结果。
如果命令运行失败，报告失败原因，不要猜测结果。

请严格按照以下步骤执行：
1. 读取 eval_factor 的 measurement_spec
2. 运行 spec 中定义的命令
3. 从命令输出中提取测量值
4. 判断是否达到 floor 阈值`,
  output_format: `严格按以下格式输出，不允许改变字段顺序：
---EVAL START---
factor_id: （评估因子 ID）
command_run: （实际运行的命令）
raw_output: （命令的原始输出，截取关键部分）
measured_value: （从输出中提取的实际数值）
passed_floor: （true/false）
---EVAL END---`,
  output_parser: "eval-score",
  timeout_ms: 60000,
} satisfies AgentRole
