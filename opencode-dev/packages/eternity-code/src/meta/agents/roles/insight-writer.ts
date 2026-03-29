/**
 * Insight Writer Role
 *
 * 将设计洞察写入到认知层。
 * 用于记录架构决策、产品决策、流程决策等。
 */

import type { AgentRole } from "../types.js"

export default {
  id: "insight-writer",
  name: "Insight Writer",
  description: "将设计洞察写入到认知层",
  context_needs: ["core_value", "requirements", "constraints", "loop_history"],
  system_prompt: `你是一个设计洞察 agent。
你的任务是将开发过程中产生的洞察记录下来。
洞察不是需求或任务，而是"为什么这样设计"的推理链。
一个好的洞察应该：
1. 解释设计决策的原因
2. 指出隐含的约束或权衡
3. 可以指导未来的决策
输出必须是结构化的，包含标题、来源、类别、核心洞察、影响等信息。`,
  output_format: `严格输出以下格式，不要有其他内容：
---INSIGHT START---
title: （洞察标题）
source: （洞察来源）
category: architecture / product / process / technical
insight: |
  （核心洞察 - 为什么这样设计）
implications:
  - （影响 1）
  - （影响 2）
related:
  - （相关洞察或文档）
---INSIGHT END---`,
  output_parser: "insight",
  timeout_ms: 60000,
} satisfies AgentRole
