# Eternity Code — 项目调优方案

基于 Anthropic harness design 论文的发现，
对 Eternity Code 现有设计的具体改进。
本文件描述五个调优方向，opencode 按顺序实现。

---

## 调优一：card-reviewer 引入 Rubric 评分

### 现状问题

`card-reviewer` 当前的评分是主观的——
agent 看完卡片给一个综合判断，容易陷入"自评偏差"：
即使卡片质量平庸，reviewer 也倾向于批准，
因为它理解了提案方的意图，会替对方辩护。

### 改动

修改 `packages/opencode/src/meta/agents/roles/card-reviewer.ts`，
将综合判断拆成四个有权重的具体维度：

```typescript
export default {
  id: "card-reviewer",
  // ...
  system_prompt: `你是一个决策卡片审查 agent。
你不知道这张卡片是谁生成的。
你必须按照以下四个维度独立打分，不允许给出综合印象分。
每个维度 0-10 分，必须先给出分数，再给出理由（不允许先说理由再给分）。

维度定义：
req_alignment (0-10)：这张卡直接指向覆盖度最低的 REQ 吗？
  0 = 和当前最低覆盖度 REQ 完全无关
  5 = 间接相关
  10 = 直接且精准地指向最低覆盖度 REQ

neg_conflict (0-10)：是否存在与 active NEG 的冲突？（10 = 完全无冲突）
  0 = 明确命中某条 NEG 的核心意图
  5 = 接近某条 NEG 的边界，有争议
  10 = 完全不触碰任何 NEG

cost_honesty (0-10)：benefit 是否被高估，cost 是否被低估？
  0 = benefit 严重夸大，cost 刻意淡化
  5 = 基本准确但有乐观偏差
  10 = benefit 和 cost 对称诚实

feasibility (0-10)：在当前 tech_stack 约束下是否真实可行？
  0 = 需要引入被 constraints 明确禁止的技术
  5 = 可行但有重要前提未声明
  10 = 在当前约束内完全可行，前提清晰`,

  output_format: `严格按以下格式输出，不允许改变字段顺序：
---REVIEW START---
req_alignment_score: （0-10）
req_alignment_reason: （一句话）
neg_conflict_score: （0-10）
neg_conflict_reason: （一句话）
cost_honesty_score: （0-10）
cost_honesty_reason: （一句话）
feasibility_score: （0-10）
feasibility_reason: （一句话）
weighted_score: （按权重计算：req*0.35 + neg*0.30 + cost*0.20 + feasibility*0.15）
reviewer_note: （如果 weighted_score < 6，必须说明建议人类拒绝的理由）
---REVIEW END---`,
}
```

### Rubric 调优机制

每次你的判断和 reviewer 的判断出现分歧时，
在 `cognition/insights/` 记录一条 INS：

```yaml
# INS-NNN.yaml
id: INS-NNN
title: "card-reviewer 在 X 维度的判断偏差"
category: process
insight: |
  reviewer 给 neg_conflict 打了 8 分（认为无冲突），
  但实际上这张卡的手段间接触碰了 NEG-002 的"文件存储"意图。
  问题在于 reviewer 只做字面匹配，没有做意图推断。
implications:
  - "neg_conflict 的 system_prompt 需要增加意图推断的示例"
status: pending   # 等你确认后改为 adopted，会被注入到下一轮 context
```

---

## 调优二：Task 执行前引入 Sprint Contract

### 现状问题

`execution/runner.ts` 里的 Task 直接执行，
`definition_of_done` 是 planner 单方面写的，
没有经过独立确认——导致"做完了但做错了"。

### 改动

在 `execution/runner.ts` 的每个 Task 执行前，
插入一个 contract 阶段：

```typescript
// runner.ts 的 runPlan 函数，在 task 执行前插入：

async function negotiateContract(
  cwd: string,
  task: ExecutionTask,
  dispatcher: Dispatcher,
  loopId: string
): Promise<string> {

  // 1. task-executor 草拟可验证的完成标准
  const draft = await dispatcher.dispatch<ContractDraft>(
    "contract-drafter",
    { task_spec: task.spec },
    loopId
  )

  // 2. contract-validator 确认标准是否客观可验证
  const validation = await dispatcher.dispatch<ContractValidation>(
    "contract-validator",
    {
      task_spec: task.spec,
      proposed_criteria: draft.criteria,
    },
    loopId
  )

  if (validation.is_verifiable) {
    return draft.criteria
  }

  // 3. 如果不可验证，用 validator 建议的标准替代
  console.error(`[Contract] ${task.id}: 完成标准不可验证，使用修正版`)
  return validation.revised_criteria
}

// 在 runPlan 的 task 循环里：
for (const task of plan.tasks) {
  // ...
  const verifiedDod = await negotiateContract(cwd, task, dispatcher, plan.loop_id)
  task.spec.definition_of_done = verifiedDod   // 用协商后的标准替代原始版本
  // 然后执行...
}
```

新增两个 AgentRole：

```typescript
// roles/contract-drafter.ts
export default {
  id: "contract-drafter",
  name: "Contract Drafter",
  description: "将 task spec 转化为客观可验证的完成标准",
  context_needs: ["constraints"],
  system_prompt: `你是一个任务合约起草 agent。
你的唯一任务是将一个模糊的完成描述转化为可以被脚本或命令客观验证的标准。
可以验证的标准必须满足：运行某个命令，输出结果是明确的 pass 或 fail，不需要人类判断。
不可接受的标准示例："功能正常运行" / "代码整洁" / "用户体验良好"
可接受的标准示例："bun typecheck 返回 0" / "curl /api/evaluate 返回包含 reason 字段的 JSON" / "test/evaluate.test.ts 全部通过"`,
  output_format: `---CONTRACT START---
criteria: （可以被命令行验证的完成标准，一句话）
verify_command: （具体的验证命令）
---CONTRACT END---`,
  output_parser: "contract-draft",
  timeout_ms: 20000,
}

// roles/contract-validator.ts
export default {
  id: "contract-validator",
  name: "Contract Validator",
  description: "验证完成标准是否真正客观可验证，如不可验证则给出修正版",
  context_needs: ["none"],
  system_prompt: `你是一个合约验证 agent。
你需要判断一个完成标准是否满足：可以被命令行工具在 30 秒内客观验证，结果是明确的 pass/fail。
如果不满足，给出修正版本。`,
  output_format: `---VALIDATION START---
is_verifiable: （true/false）
reason: （为什么可以或不可以验证）
revised_criteria: （如果不可验证，给出修正后的标准；如果可验证，重复原标准）
verify_command: （具体验证命令）
---VALIDATION END---`,
  output_parser: "contract-validation",
  timeout_ms: 20000,
}
```

---

## 调优三：eval-scorer 获得真实工具调用能力

### 现状问题

`eval-scorer` 只能读代码推断结果，
没有真正运行 `measurement_spec` 里定义的脚本。
评估是基于代码阅读的推断，不是真实测量。

### 改动

修改 `roles/eval-scorer.ts`，增加工具声明：

```typescript
export default {
  id: "eval-scorer",
  name: "Eval Scorer",
  description: "运行评估脚本，获取真实测量值",
  context_needs: ["eval_factors"],
  tools: ["bash", "read"],           // ← 新增：允许真实执行
  system_prompt: `你是一个评估执行 agent。
你必须真正运行 measurement_spec 里定义的命令来获取测量值，
不允许通过阅读代码来推断结果。
如果命令运行失败，报告失败原因，不要猜测结果。`,
  output_format: `---EVAL START---
factor_id: EVAL-001
command_run: （实际运行的命令）
raw_output: （命令的原始输出，截取关键部分）
measured_value: （从输出中提取的实际数值）
passed_floor: （true/false）
---EVAL END---`,
  output_parser: "eval-score",
  timeout_ms: 60000,
}
```

同时在 `design.yaml` 的 `eval_factors` 里，
确保每个 metric 类型的因子都有可执行的 `measurement_spec`：

```yaml
eval_factors:
  - id: EVAL-001
    name: 教师操作完成率
    measurement:
      type: metric
      spec: "node scripts/measure-completion.js --window 7d"
      # spec 必须是可以直接在 bash 里运行的命令
      # 不能是描述性文字
```

---

## 调优四：REQ 覆盖度改为 Acceptance Checklist

### 现状问题

覆盖度（0.0-1.0）是 agent 主观估算的，
不同 agent 对同一代码库的估算可能差距 0.2 以上，
导致 loop 的方向判断不稳定。

### 改动

在 `design.yaml` 的每条 requirement 下增加 `acceptance_checklist`：

```yaml
requirements:
  - id: REQ-002
    text: "评估输出必须对没有技术背景的教师完全可理解"
    priority: p0
    signal:
      type: llm_eval
      spec: "..."

    # 新增：替代 coverage 的客观验收清单
    acceptance_checklist:
      - id: AC-002-01
        check: "response.breakdown 数组存在且非空"
        verify: "curl -s /api/evaluate | jq '.breakdown | length > 0'"
        status: pass          # pass / fail / pending

      - id: AC-002-02
        check: "每个 breakdown item 包含 reason 字段"
        verify: "curl -s /api/evaluate | jq '[.breakdown[].reason] | all(. != null)'"
        status: fail

      - id: AC-002-03
        check: "LLM eval 打分 ≥ 3.0（最近 10 次均值）"
        verify: "node scripts/run-llm-eval.js --factor EVAL-003 --samples 10"
        status: pending

    # coverage 改为从 checklist 自动计算，不再手动填写
    # coverage = pass 数量 / 总数量
    # 此例：1/3 = 0.33
    coverage: 0.33            # 自动计算，不要手动修改
    last_checked: "2025-03-19T14:00:00Z"
```

在 `packages/opencode/src/meta/index.ts` 增加自动计算函数：

```typescript
export function computeCoverage(req: MetaRequirement): number {
  const checklist = req.acceptance_checklist
  if (!checklist || checklist.length === 0) {
    // 没有 checklist 的 REQ，保留手动填写的 coverage
    return req.coverage ?? 0
  }
  const passed = checklist.filter(item => item.status === "pass").length
  return passed / checklist.length
}
```

在 loop 的 ANALYZE 阶段，
用 `eval-scorer`（带 bash 工具）自动运行每个 `verify` 命令，
更新 `status` 字段，然后重新计算 `coverage`。

---

## 调优五：Blueprint 增加模型假设记录

### 现状问题

`BLUEPRINT-current.yaml` 记录了"做什么"，
但没有记录"为什么这样设计 harness"——
每个 harness 组件背后对模型能力的假设没有显式存档。
SOTA 介入时无法快速判断哪些假设需要重新测试。

### 改动

在 `cognition/blueprints/BLUEPRINT-current.yaml` 增加字段：

```yaml
# 在现有字段之后追加
model_assumptions:
  - component: "context_reset_between_tasks"
    assumption: "mimov2pro 在超过 50% context 后会产生质量下降"
    evidence: "loop-003 回滚记录：task-executor 在第 4 个 task 后开始走捷径"
    test_command: "运行 benchmark/context-degradation.js 对比不同 context 深度的输出质量"
    last_tested: "2025-03-20"
    model_version: "mimov2pro"
    status: confirmed         # confirmed / assumed / invalidated

  - component: "card_reviewer_fresh_context"
    assumption: "reviewer 必须用 fresh context 才能独立判断，在主 session 里会受主 agent 影响"
    evidence: "实验：主 session 里的 reviewer 批准率 92%，fresh context 批准率 71%"
    test_command: "运行 benchmark/reviewer-independence.js"
    last_tested: "2025-03-20"
    model_version: "mimov2pro"
    status: confirmed

  - component: "sprint_contract_required"
    assumption: "没有 contract 阶段时，约 30% 的 task 会做完但验收失败"
    evidence: "loop-001 到 loop-004 的执行记录统计"
    test_command: "分析 .meta/execution/logs/ 里的 incomplete 字段统计"
    last_tested: "2025-03-20"
    model_version: "mimov2pro"
    status: assumed           # 还没有足够数据确认
```

SOTA 介入时，执行 `restructure` 模式前，
先运行所有 `test_command`，
把 `status` 更新为当前模型版本下的实际情况。
`invalidated` 的假设意味着对应的 harness 组件可以简化或移除。

---

## 执行顺序

```
调优一（card-reviewer rubric）：
  改 roles/card-reviewer.ts 的 system_prompt 和 output_format
  改 parsers/card-review.ts 解析四维评分
  在 command.ts 展示双评分（提案方 confidence + reviewer weighted_score）
  打 tag: eternity-v1.7-rubric-reviewer

调优二（sprint contract）：
  新建 roles/contract-drafter.ts
  新建 roles/contract-validator.ts
  新建 parsers/contract-draft.ts
  新建 parsers/contract-validation.ts
  修改 execution/runner.ts 插入 negotiateContract
  打 tag: eternity-v1.8-sprint-contract

调优三（eval-scorer 真实执行）：
  修改 roles/eval-scorer.ts 增加 tools: ["bash", "read"]
  修改 parsers/eval-score.ts 解析命令输出
  确认 design.yaml 里所有 metric 因子的 spec 是可执行命令
  打 tag: eternity-v1.9-real-eval

调优四（acceptance checklist）：
  修改 types.ts 增加 AcceptanceChecklist 类型
  修改 index.ts 增加 computeCoverage 函数
  在 ANALYZE 阶段自动运行 verify 命令更新 status
  更新 design.yaml 示例文件增加 acceptance_checklist 字段
  打 tag: eternity-v2.0-checklist-coverage

调优五（model assumptions）：
  修改 blueprints.ts 的 Blueprint 类型增加 model_assumptions 字段
  更新 BLUEPRINT-current.yaml 写入初始假设
  在 restructure-planner 的 system_prompt 里增加"先测试所有假设"的指令
  打 tag: eternity-v2.1-model-assumptions
```

---

## 调优效果验证

每个调优完成后，跑三次 `/meta` 对比以下指标：

```
调优一：比较 card 被接受后实际执行是否比调优前更少出现"做完但方向错了"
调优二：比较 task 失败率（definition_of_done 模糊导致的失败应该下降）
调优三：比较 EVAL baseline 更新的准确性（和手动测量值的偏差应该 < 5%）
调优四：比较 coverage 数值的稳定性（同一代码库不同 loop 的估算应该一致）
调优五：SOTA 介入时，能在 10 分钟内完成假设测试并决定是否简化 harness
```

把对比结果写入 `cognition/insights/`，状态设为 `adopted` 后自动注入后续 loop。
