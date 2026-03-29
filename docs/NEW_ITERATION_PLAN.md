# Eternity Code 新迭代方案：WATCHDOG + TUNING 集成

更新日期：2026-03-29

## 背景

本方案基于 `docs/WATCHDOG.md` 和 `docs/TUNING.md` 两份优化策略，
结合当前代码现状，制定新的迭代计划。

### 当前状态评估

1. **Sub-agent 调度层**：✅ 已实现
   - Dispatcher 已完成，包含 PromptOptimizer 和 ContextMixer
   - 8 个角色已定义（card-reviewer、coverage-assessor、eval-scorer 等）
   - 解析器框架已就绪

2. **WATCHDOG 系统**：❌ 未实现
   - 目录 `packages/opencode/src/meta/watchdog/` 不存在
   - 需要从头实现异常监控与熔断机制

3. **TUNING 调优**：❌ 部分未实现
   - card-reviewer 仍使用简单评分，未实现 Rubric 四维加权评分
   - eval-scorer 未获得真实工具调用能力
   - Sprint Contract 机制未实现
   - Acceptance Checklist 机制未实现
   - Model Assumptions 记录未实现

## 迭代目标

### 核心主题

> 从"功能基础期"进入"可靠性与质量提升期"

### 主要目标

1. **建立系统可靠性保障**（WATCHDOG）
   - 防止无限循环、Token 溢出、网络错误导致的资源浪费
   - 提供自动熔断机制，避免连续失败
   - 完善异常监控与可观测性

2. **提升决策与执行质量**（TUNING）
   - 消除 card-reviewer 的自评偏差
   - 确保 Task 执行前有明确的完成标准
   - 让评估基于真实测量而非推断
   - 用客观清单替代主观覆盖度估算
   - 记录模型假设以便 SOTA 介入时快速决策

## 分阶段迭代方案

### Phase 1：WATCHDOG 系统实现（1-2 周）

#### 目标

建立完整的异常监控与自动熔断系统，提升系统运行可靠性。

#### 任务清单

##### 1.1 创建 WATCHDOG 基础结构

```
packages/opencode/src/meta/watchdog/
  index.ts          ← Watchdog 主类
  detectors.ts      ← 异常检测逻辑
  circuit-breaker.ts← 熔断器
  types.ts          ← 类型定义
```

**优先级**：P0

**实现内容**：
- 创建 `types.ts`，定义 `AnomalyType`、`AnomalyEvent`、`WatchdogConfig` 等类型
- 创建 `detectors.ts`，实现无限循环检测、重复调用检测、API 错误分类、空响应检测
- 创建 `circuit-breaker.ts`，实现熔断器状态机（closed/open/half-open）
- 创建 `index.ts`，实现 Watchdog 主类的 `guard` 方法

##### 1.2 集成 Dispatcher

**优先级**：P0

**修改文件**：
- `packages/opencode/src/meta/agents/dispatcher.ts`

**实现内容**：
- 在 Dispatcher 构造函数中创建 Watchdog 实例
- 将所有 `dispatch` 调用用 Watchdog 包裹
- 注入工具调用计数钩子

##### 1.3 设计配置集成

**优先级**：P1

**修改文件**：
- `packages/opencode/src/meta/types.ts`（或 design.yaml schema）

**实现内容**：
- 在 design.yaml 中增加 `watchdog` 配置字段
- 在 context-loader.ts 中读取配置并传给 Dispatcher

##### 1.4 Dashboard 集成

**优先级**：P2

**修改文件**：
- `packages/opencode/src/meta/dashboard/server.ts`

**实现内容**：
- 新增 `GET /api/anomalies` 端点
- 在 Dashboard 的 Execution tab 增加 Watchdog 状态区块

##### 1.5 TUI 集成

**优先级**：P2

**实现内容**：
- 新增 `AnomalyPanel` 组件
- 实现非阻塞通知条显示

#### 交付标准

- Watchdog 能检测并中断无限循环（工具调用次数超过阈值）
- Watchdog 能检测并处理 Token 溢出（截断上下文重试）
- Watchdog 能检测并处理网络错误（指数退避重试）
- Watchdog 能检测并中断幻觉循环（重复调用相同工具+参数）
- 熔断器能防止连续失败的 agent 被不断调用
- Dashboard 能展示异常历史和 Watchdog 状态

#### 验证方法

- 模拟触发各类异常，验证 Watchdog 能正确检测和处理
- 验证熔断器状态转换正确（closed → open → half-open → closed）
- 验证异常事件正确写入磁盘和 Dashboard

#### 打 Tag

```bash
git tag eternity-v1.6-watchdog
```

---

### Phase 2：Card-Reviewer Rubric 评分（1 周）

#### 目标

消除 card-reviewer 的自评偏差，引入四维加权评分机制。

#### 任务清单

##### 2.1 修改 card-reviewer 角色定义

**优先级**：P0

**修改文件**：
- `packages/opencode/src/meta/agents/roles/card-reviewer.ts`

**实现内容**：
- 将 system_prompt 改为四维独立评分
- 四个维度：
  - `req_alignment`（0-10）：与最低覆盖度 REQ 的对齐程度，权重 0.35
  - `neg_conflict`（0-10）：与 active NEG 的冲突程度，权重 0.30
  - `cost_honesty`（0-10）：benefit/cost 诚实度，权重 0.20
  - `feasibility`（0-10）：技术可行性，权重 0.15
- 要求先给分数再给理由
- 输出 `weighted_score`（加权平均）

##### 2.2 修改 card-review 解析器

**优先级**：P0

**修改文件**：
- `packages/opencode/src/meta/agents/parsers/card-review.ts`

**实现内容**：
- 解析四维评分和加权分数
- 返回结构化对象包含所有维度分数

##### 2.3 TUI 双评分展示

**优先级**：P1

**实现内容**：
- 在卡片决策界面展示双评分：
  - 提案方 confidence
  - reviewer weighted_score
- 视觉上区分两个分数

#### 交付标准

- card-reviewer 输出四维独立评分（每个维度 0-10）
- 输出加权总分（weighted_score）
- 每个维度有独立的理由说明
- TUI 能展示双评分对比

#### 验证方法

- 对比调优前后的卡片批准率和执行质量
- 验证 reviewer 评分与实际执行结果的相关性

#### 打 Tag

```bash
git tag eternity-v1.7-rubric-reviewer
```

---

### Phase 3：Sprint Contract 机制（1-2 周）

#### 目标

在 Task 执行前引入可验证的完成标准，避免"做完了但做错了"。

#### 任务清单

##### 3.1 新增 contract-drafter 角色

**优先级**：P0

**新建文件**：
- `packages/opencode/src/meta/agents/roles/contract-drafter.ts`

**实现内容**：
- 将模糊的完成描述转化为可命令行验证的标准
- 输出 `criteria`（可验证的完成标准）和 `verify_command`（验证命令）

##### 3.2 新增 contract-validator 角色

**优先级**：P0

**新建文件**：
- `packages/opencode/src/meta/agents/roles/contract-validator.ts`

**实现内容**：
- 验证完成标准是否真正客观可验证
- 如果不可验证，给出修正版本
- 输出 `is_verifiable`、`reason`、`revised_criteria`、`verify_command`

##### 3.3 新增解析器

**优先级**：P0

**新建文件**：
- `packages/opencode/src/meta/agents/parsers/contract-draft.ts`
- `packages/opencode/src/meta/agents/parsers/contract-validation.ts`

**实现内容**：
- 解析 contract-drafter 和 contract-validator 的输出

##### 3.4 注册新角色

**优先级**：P0

**修改文件**：
- `packages/opencode/src/meta/agents/registry.ts`

**实现内容**：
- 在 `loadAllRoles` 中加载新角色

##### 3.5 修改 execution/executor.ts

**优先级**：P0

**修改文件**：
- `packages/opencode/src/meta/execution/executor.ts`

**实现内容**：
- 在每个 Task 执行前插入 `negotiateContract` 阶段
- 用协商后的标准替代原始 `definition_of_done`

#### 交付标准

- 每个 Task 执行前都有明确的可验证完成标准
- 完成标准可以通过命令行客观验证
- 不可验证的标准会被自动修正
- Task 失败率应显著下降

#### 验证方法

- 对比调优前后的 Task 失败率
- 验证 definition_of_done 模糊导致的失败是否减少

#### 打 Tag

```bash
git tag eternity-v1.8-sprint-contract
```

---

### Phase 4：Eval-Scorer 真实工具调用（1 周）

#### 目标

让 eval-scorer 获得真实工具调用能力，基于真实测量而非推断。

#### 任务清单

##### 4.1 修改 eval-scorer 角色定义

**优先级**：P0

**修改文件**：
- `packages/opencode/src/meta/agents/roles/eval-scorer.ts`

**实现内容**：
- 增加 `tools: ["bash", "read"]` 字段
- 修改 system_prompt，要求真实运行 measurement_spec 命令
- 修改 output_format，输出命令运行结果

##### 4.2 修改 eval-score 解析器

**优先级**：P0

**修改文件**：
- `packages/opencode/src/meta/agents/parsers/eval-score.ts`

**实现内容**：
- 解析命令输出和测量值

##### 4.3 确保 design.yaml 配置正确

**优先级**：P1

**实现内容**：
- 确保所有 metric 类型的 eval_factor 都有可执行的 `measurement_spec`
- spec 必须是可直接在 bash 中运行的命令

#### 交付标准

- eval-scorer 能真实运行 measurement_spec 命令
- 评估基于真实测量结果而非代码推断
- 测量值与手动测量偏差 < 5%

#### 验证方法

- 对比自动测量值和手动测量值
- 验证命令执行失败时正确报告失败原因

#### 打 Tag

```bash
git tag eternity-v1.9-real-eval
```

---

### Phase 5：Acceptance Checklist 机制（1-2 周）

#### 目标

用客观的验收清单替代主观的覆盖度估算，提高覆盖度数值稳定性。

#### 任务清单

##### 5.1 修改类型定义

**优先级**：P0

**修改文件**：
- `packages/opencode/src/meta/types.ts`

**实现内容**：
- 增加 `AcceptanceChecklist` 类型定义
- 在 `MetaRequirement` 中增加 `acceptance_checklist` 字段

##### 5.2 实现 computeCoverage 函数

**优先级**：P0

**修改文件**：
- `packages/opencode/src/meta/index.ts`

**实现内容**：
- 实现 `computeCoverage` 函数，从 checklist 自动计算 coverage
- coverage = pass 数量 / 总数量

##### 5.3 修改 ANALYZE 阶段

**优先级**：P0

**实现内容**：
- 在 ANALYZE 阶段自动运行每个 `verify` 命令
- 更新 `status` 字段
- 重新计算 `coverage`

##### 5.4 更新 design.yaml 示例

**优先级**：P1

**修改文件**：
- `examples/design.yaml`

**实现内容**：
- 增加 `acceptance_checklist` 字段示例

#### 交付标准

- 每条 requirement 可以定义 acceptance_checklist
- checklist 的 verify 命令可以自动运行
- coverage 自动从 checklist 计算
- 同一代码库不同 loop 的 coverage 估算一致

#### 验证方法

- 对比调优前后的 coverage 数值稳定性
- 验证 checklist 状态自动更新正确

#### 打 Tag

```bash
git tag eternity-v2.0-checklist-coverage
```

---

### Phase 6：Model Assumptions 记录（1 周）

#### 目标

记录 harness 组件背后的模型假设，便于 SOTA 介入时快速决策。

#### 任务清单

##### 6.1 修改 Blueprint 类型

**优先级**：P0

**修改文件**：
- `packages/opencode/src/meta/blueprints.ts`

**实现内容**：
- 在 `Blueprint` 接口中增加 `model_assumptions` 字段

##### 6.2 更新 BLUEPRINT-current.yaml

**优先级**：P0

**修改文件**：
- `.meta/blueprints/BLUEPRINT-current.yaml`（或示例文件）

**实现内容**：
- 写入初始假设列表

##### 6.3 修改 restructure-planner

**优先级**：P1

**修改文件**：
- `packages/opencode/src/meta/agents/roles/restructure-planner.ts`

**实现内容**：
- 在 system_prompt 中增加"先测试所有假设"的指令

#### 交付标准

- Blueprint 包含 model_assumptions 列表
- 每个假设包含 component、assumption、evidence、test_command、status
- SOTA 介入时能在 10 分钟内完成假设测试

#### 验证方法

- 模拟 SOTA 介入，验证假设测试流程
- 验证 invalidated 假设对应的 harness 组件可以简化

#### 打 Tag

```bash
git tag eternity-v2.1-model-assumptions
```

---

## 执行顺序总览

```
Phase 1: WATCHDOG 系统（eternity-v1.6-watchdog）
  ├─ 1.1 创建 WATCHDOG 基础结构
  ├─ 1.2 集成 Dispatcher
  ├─ 1.3 设计配置集成
  ├─ 1.4 Dashboard 集成
  └─ 1.5 TUI 集成

Phase 2: Card-Reviewer Rubric（eternity-v1.7-rubric-reviewer）
  ├─ 2.1 修改 card-reviewer 角色定义
  ├─ 2.2 修改 card-review 解析器
  └─ 2.3 TUI 双评分展示

Phase 3: Sprint Contract（eternity-v1.8-sprint-contract）
  ├─ 3.1 新增 contract-drafter 角色
  ├─ 3.2 新增 contract-validator 角色
  ├─ 3.3 新增解析器
  ├─ 3.4 注册新角色
  └─ 3.5 修改 execution/executor.ts

Phase 4: Eval-Scorer 真实执行（eternity-v1.9-real-eval）
  ├─ 4.1 修改 eval-scorer 角色定义
  ├─ 4.2 修改 eval-score 解析器
  └─ 4.3 确保 design.yaml 配置正确

Phase 5: Acceptance Checklist（eternity-v2.0-checklist-coverage）
  ├─ 5.1 修改类型定义
  ├─ 5.2 实现 computeCoverage 函数
  ├─ 5.3 修改 ANALYZE 阶段
  └─ 5.4 更新 design.yaml 示例

Phase 6: Model Assumptions（eternity-v2.1-model-assumptions）
  ├─ 6.1 修改 Blueprint 类型
  ├─ 6.2 更新 BLUEPRINT-current.yaml
  └─ 6.3 修改 restructure-planner
```

## 建议的近期排期

### 第一迭代（1-2 周）

目标：实现 WATCHDOG 系统，建立异常监控与自动熔断机制。

建议 backlog：
1. 创建 watchdog 目录结构和类型定义
2. 实现异常检测器和熔断器
3. 集成到 Dispatcher
4. Dashboard 展示异常状态

### 第二迭代（1-2 周）

目标：提升决策质量，消除自评偏差。

建议 backlog：
1. 实现 card-reviewer 四维 Rubric 评分
2. 修改解析器支持新格式
3. TUI 展示双评分

### 第三迭代（2-3 周）

目标：建立可验证的执行标准。

建议 backlog：
1. 实现 Sprint Contract 机制
2. 让 eval-scorer 获得真实工具调用能力
3. 实现 Acceptance Checklist 机制

## 验证指标

### WATCHDOG 验证

- 无限循环检测准确率 = 100%
- Token 溢出处理成功率 ≥ 95%
- 网络错误重试成功率 ≥ 90%
- 熔断器状态转换正确率 = 100%

### TUNING 验证

- card-reviewer 评分偏差下降 ≥ 30%
- Task 失败率下降 ≥ 20%
- EVAL 测量偏差 < 5%
- Coverage 数值稳定性提升（同一代码库不同 loop 偏差 < 0.1）

## 风险与缓解

### 技术风险

1. **WATCHDOG 性能开销**
   - 风险：异常检测可能增加调用延迟
   - 缓解：使用轻量级检测器，避免阻塞主流程

2. **Sprint Contract 可能过度约束**
   - 风险：过于严格的验证标准可能阻碍创新
   - 缓解：validator 可以修正过于严格的标准

3. **Acceptance Checklist 维护成本**
   - 风险：checklist 需要随需求变化更新
   - 缓解：在 requirement 变更时自动提醒更新 checklist

### 项目风险

1. **范围蔓延**
   - 风险：6 个 Phase 可能导致进度延迟
   - 缓解：严格按 Phase 执行，每个 Phase 有明确交付物

2. **现有代码兼容性**
   - 风险：新功能可能与现有代码冲突
   - 缓解：每步完成后运行 `bun typecheck`，每步独立可回滚

## 最终建议

接下来的迭代方向应该是：

1. **先建立可靠性保障**（WATCHDOG），确保系统不会因异常而浪费资源
2. **再提升决策质量**（Rubric 评分），确保决策基于客观标准
3. **然后建立执行保障**（Sprint Contract），确保执行有明确标准
4. **最后完善评估体系**（真实测量 + Checklist），确保评估结果可信

如果要给这一轮定一个主题，建议使用：

> 从"功能可用"进入"质量可控"

---

## 附录：关键代码实现示例

### A. WATCHDOG types.ts 实现

```typescript
export type AnomalyType =
  | "infinite_loop"          // 工具调用次数超限
  | "token_overflow"         // context 超出模型上限
  | "network_error"          // 网络连接失败
  | "hallucination_loop"     // 重复调用同一工具+参数
  | "empty_response"         // 模型返回空内容
  | "rate_limit"             // API 429
  | "timeout"                // 单次调用超时
  | "circuit_open"           // 熔断器打开

export interface AnomalyEvent {
  type: AnomalyType
  detected_at: string
  agent_role: string
  loop_id?: string
  task_id?: string
  detail: string
  tool_call_count?: number
  repeated_call?: {
    tool: string
    params_hash: string
    count: number
  }
  action_taken:
    | "interrupted"
    | "retried"
    | "degraded"
    | "skipped"
    | "waiting"
}

export interface WatchdogConfig {
  max_tool_calls: number
  max_repeated_calls: number
  call_timeout_ms: number
  max_retries: number
  retry_base_delay_ms: number
  circuit_breaker_threshold: number
  circuit_reset_ms: number
}

export const DEFAULT_CONFIG: WatchdogConfig = {
  max_tool_calls: 30,
  max_repeated_calls: 3,
  call_timeout_ms: 120000,
  max_retries: 3,
  retry_base_delay_ms: 1000,
  circuit_breaker_threshold: 5,
  circuit_reset_ms: 300000,
}
```

### B. Rubric 评分 card-reviewer.ts 实现

```typescript
export default {
  id: "card-reviewer",
  name: "Card Reviewer",
  description: "对主agent生成的决策卡片进行独立评分，提供第二视角",
  context_needs: ["core_value", "requirements", "constraints", "negatives", "eval_factors"],
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
  output_parser: "card-review",
  timeout_ms: 30000,
} satisfies AgentRole
```

### C. Sprint Contract contract-drafter.ts 实现

```typescript
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
} satisfies AgentRole
```

### D. Acceptance Checklist 类型定义

```typescript
// 在 types.ts 中增加
export interface AcceptanceChecklistItem {
  id: string
  check: string
  verify: string
  status: "pass" | "fail" | "pending"
}

export interface MetaRequirement {
  id: string
  text: string
  priority: string
  signal?: {
    type: string
    spec: string
  }
  acceptance_checklist?: AcceptanceChecklistItem[]
  coverage?: number
  last_checked?: string
}

// computeCoverage 函数
export function computeCoverage(req: MetaRequirement): number {
  const checklist = req.acceptance_checklist
  if (!checklist || checklist.length === 0) {
    return req.coverage ?? 0
  }
  const passed = checklist.filter(item => item.status === "pass").length
  return passed / checklist.length
}
```

### E. Model Assumptions 类型定义

```typescript
// 在 blueprints.ts 中增加
export interface ModelAssumption {
  component: string
  assumption: string
  evidence: string
  test_command: string
  last_tested: string
  model_version: string
  status: "confirmed" | "assumed" | "invalidated"
}

export interface Blueprint {
  version: string
  created_by: string
  created_at: string
  valid_until?: string
  current_state: string
  priorities: Array<{
    id: string
    goal: string
    rationale: string
    acceptance: string
  }>
  constraints: string[]
  known_debt: string[]
  model_assumptions?: ModelAssumption[]
}
```
