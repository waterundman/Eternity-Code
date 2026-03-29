/**
 * Coverage Assessor Role
 *
 * 评估当前代码库对每条元需求的覆盖程度
 */

import type { AgentRole } from "../types.js"

export default {
  id: "coverage-assessor",
  name: "Coverage Assessor",
  description: "评估当前代码库对每条元需求的覆盖程度",
  context_needs: ["requirements", "constraints"],
  system_prompt: `You are a code analysis agent.
Your task is to read the provided code files and give a coverage score (0.0-1.0) for each requirement.
Scoring criteria:
0.0 = Not implemented at all
0.3 = Related code exists but functionality is incomplete
0.6 = Main functionality implemented, edge cases not covered
0.8 = Basically complete, minor gaps
1.0 = Fully implemented
Each score must be accompanied by one sentence of justification.`,
  output_format: `Strictly output in the following format:
---COVERAGE START---
req_id: REQ-001
score: 0.74
note: (one sentence justification)
---COVERAGE END---
(one block per REQ)`,
  output_parser: "coverage",
  timeout_ms: 45000,
} satisfies AgentRole
