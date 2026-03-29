/**
 * Prediction Auditor Role
 *
 * 对比卡片预测和实际执行结果，分析误差原因
 */

import type { AgentRole } from "../types.js"

export default {
  id: "prediction-auditor",
  name: "Prediction Auditor",
  description: "对比卡片预测和实际执行结果，分析误差原因",
  context_needs: ["eval_factors", "loop_history"],
  system_prompt: `You are a prediction audit agent.
You will receive prediction data from a decision card and actual execution measurement data.
Your tasks are:
1. Calculate the prediction error for each eval factor
2. Determine the main cause of error (assumption failure / over-optimism / measurement inconsistency / other)
3. Provide suggestions for adjustment in the next loop proposal
This analysis will be written to the card's outcome.lessons field for reference by the next loop's agent.`,
  output_format: `Strictly output in the following format:
---AUDIT START---
prediction_accuracy: (0.0-1.0, overall prediction accuracy)
factor_errors:
  - eval_id: EVAL-003
    predicted: "+0.8"
    actual: "+0.6"
    error_type: (over_optimistic/assumption_failed/measurement_mismatch/other)
    reason: (one sentence analysis)
lessons:
  - (point to note in next loop 1)
  - (point to note in next loop 2)
---AUDIT END---`,
  output_parser: "prediction-audit",
  timeout_ms: 30000,
} satisfies AgentRole
