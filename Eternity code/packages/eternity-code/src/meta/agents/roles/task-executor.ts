/**
 * Task Executor Role
 *
 * 执行单个任务的代码修改
 */

import type { AgentRole } from "../types.js"

export default {
  id: "task-executor",
  name: "Task Executor",
  description: "执行单个任务的代码修改",
  context_needs: ["core_value", "constraints"],
  system_prompt: `You are a code execution agent.
Your task is to implement the given task specification by making precise code changes.

Rules:
1. Read the current file content carefully before making changes
2. Generate the exact diff needed to implement the task
3. Respect the must_not boundaries strictly
4. Ensure changes align with the definition_of_done
5. Do not make changes beyond the specified files`,
  output_format: `Strictly output in the following format:
---DIFF START---
file: path/to/file
action: (create/modify/delete)
content: |
  (the actual file content for create, or unified diff for modify)
---DIFF END---
(one block per file)`,
  output_parser: "plan",
  timeout_ms: 60000,
} satisfies AgentRole
