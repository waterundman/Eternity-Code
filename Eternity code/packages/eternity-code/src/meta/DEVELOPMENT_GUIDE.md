# MetaDesign 开发指南

> 本文档整合了所有指导文件和蓝图，是后续开发的唯一参考。
> 开始任何开发任务前，必须先阅读本文档。

---

## 项目目标

**一句话**：给 AI 写代码这件事本身，设计一套工程框架。

**核心问题**：语义漂移 - coding agent 知道"怎么写"，但不知道"为什么写"

**解法**：MetaDesign - 元设计框架

---

## 核心概念

### MetaDesign 是什么

类比基因和生物体的关系：
- 基因不是蛋白质本身，但决定了什么蛋白质可以被合成
- **元设计不是代码本身，但决定了什么代码是合法的**

### design.yaml 记录四件事

1. **正向定义**：产品是什么、为谁做、核心价值、绝对不能做什么
2. **需求覆盖度**：每条需求被代码覆盖了多少（0-1）
3. **负空间**：所有被人类明确拒绝过的优化方向
4. **决策卡片历史**：每条建议的接受/拒绝记录

### Loop 运行机制

```
分析 → 生成卡片 → 人类选择 → 执行 → 评估 → 写回
```

人类只在一个地方做决策：**选卡片**

---

## 项目结构

### 文件布局

```
.meta/
├── design.yaml      # 元设计文件（单一事实源）
├── cards/           # 决策卡片
│   ├── CARD-001.yaml
│   └── CARD-002.yaml
├── loops/           # 循环记录
│   ├── loop-001.yaml
│   └── loop-002.yaml
└── negatives/       # 被拒绝的方向
    ├── NEG-001.yaml
    └── NEG-002.yaml

plugin/
└── metadesign.ts    # MetaDesign 插件

packages/opencode/src/
├── meta/
│   ├── types.ts     # 类型定义
│   ├── index.ts     # 核心功能
│   ├── cards.ts     # 卡片管理
│   ├── command.ts   # 命令实现
│   ├── plugin.ts    # 插件实现
│   ├── executor.ts  # 执行器
│   └── evaluator.ts # 评估器
├── session/
│   └── llm.ts       # System prompt 注入点
└── command/
    └── index.ts     # 命令注册点
```

### 关键文件位置

| 变量 | 实际路径 | 说明 |
|------|---------|------|
| `SYSTEM_PROMPT_FILE` | `packages/opencode/src/session/llm.ts` | system prompt 组装位置 |
| `LLM_CALL_FILE` | `packages/opencode/src/session/llm.ts` | LLM API 调用位置 |
| `COMMAND_REGISTRY_FILE` | `packages/opencode/src/command/index.ts` | 命令注册位置 |
| `CWD_SOURCE` | `Instance.directory` | cwd 来源 |

---

## 已实现功能

### Phase 1: 完整 Loop 流程 ✅

| 子任务 | 状态 | 实现 |
|--------|------|------|
| 1.1 自动保存卡片 | ✅ | `plugin/metadesign.ts` |
| 1.2 TUI 决策界面 | ✅ | `/meta-decide` 命令 |
| 1.3 自动生成 NEG | ✅ | `cards.ts:writeRejectedDirection()` |
| 1.4 Loop 历史记录 | ✅ | `cards.ts:updateLoopHistory()` |

### 核心 API

```typescript
// 加载 design.yaml
loadMetaDesign(cwd: string): Promise<MetaDesign | null>

// 构建 system context
buildSystemContext(design: MetaDesign): string

// 解析卡片
parseCardsFromText(text: string): RawCard[]

// 写入卡片
writeCard(cwd: string, card: RawCard, loopId: string): Promise<string>

// 解决卡片（接受/拒绝）
resolveCard(cwd: string, cardId: string, decision: CardDecision): Promise<void>

// 写入被拒绝的方向
writeRejectedDirection(cwd, cardId, cardObjective, cardReason, note): Promise<string>

// 更新 loop 历史
updateLoopHistory(cwd, loopId, status, cardsProposed, cardsAccepted, cardsRejected, summary): Promise<void>

// 分析卡片 scope
analyzeCardScope(cwd: string, cardId: string): CardScope

// 执行验证
validateExecution(cwd: string): Promise<ValidationResult>

// 创建 git 快照
createGitSnapshot(cwd: string): Promise<string>

// 回滚到快照
rollbackToSnapshot(cwd: string, snapshotHash: string): Promise<void>

// 运行评估
runEvaluation(cwd: string, design: MetaDesign): Promise<EvaluationOutput>

// 更新卡片 outcome
updateCardOutcome(cwd: string, cardId: string, evaluation: EvaluationOutput): Promise<void>

// 更新 baseline
updateBaselines(cwd: string, results: EvalResult[]): Promise<void>
```

### 命令列表

| 命令 | 功能 |
|------|------|
| `/meta` | 生成决策卡片 |
| `/meta-decide` | 决策阶段（接受/拒绝） |
| `/meta-execute` | 为已接受的卡片生成安全执行计划 |
| `/meta-eval` | 评估执行结果 |

---

## 迭代蓝图

### Phase 2: 自动执行 ✅

接受的卡片自动执行代码修改。

**子任务：**
- [x] 2.1 解析卡片 scope，确定修改范围
- [x] 2.2 调用 opencode 工具执行修改
- [x] 2.3 运行 linter/type-check 验证
- [x] 2.4 失败自动回滚

### Phase 3: 评估闭环 ✅

执行后自动评估，对比预测 vs 实际。

**子任务：**
- [x] 3.1 运行 eval_factors 定义的评估
- [x] 3.2 更新卡片 outcome
- [x] 3.3 计算预测准确度
- [x] 3.4 更新 design.yaml baseline

### Phase 4: 智能优化

基于历史数据优化生成策略。

**子任务：**
- [ ] 4.1 分析历史卡片接受率
- [ ] 4.2 调整 search_policy 权重
- [ ] 4.3 条件性 NEG 自动解锁
- [ ] 4.4 需求覆盖度自动更新

---

## Loop 6 阶段详解

### Phase 1 · ANALYZE
**输入**: design.yaml, 代码库, git HEAD
**输出**: loop.analysis

步骤：
1. 读取 design.yaml，验证 schema
2. 遍历代码库，构建文件索引
3. 重新评估每条 REQ 的 coverage
4. 检查每个 constraint 的接近度
5. 验证每个 active NEG 仍然有效
6. 检查 NEG 条件是否解锁

### Phase 2 · GENERATE
**输入**: loop.analysis, search_policy, negatives/
**输出**: CARD-NNN.yaml 文件

步骤：
1. 按 search_policy.candidate_sources 权重评分候选方向
2. 生成 N*2 个原始候选
3. 过滤掉命中 NEG 的候选
4. 检查 constraint 接近度
5. 评估 eval_deltas
6. 排序取前 max_cards_per_loop 个

### Phase 3 · DECIDE
**输入**: CARD-NNN.yaml (pending)
**输出**: CARD-NNN.yaml (resolved), decision_session

**唯一需要人类输入的阶段**

TUI 布局：
```
┌─────────────────────────────────────────────────────────┐
│ topbar: project · stage · loop #N · phase indicator     │
├──────────────┬──────────────────────────────────────────┤
│ sidebar      │ output stream (phase log)                │
│  · REQs      │                                          │
│  · constraints│                                         │
│  · NEGs      ├──────────────────────────────────────────┤
│  · evals     │ cards area (DECIDE phase only)           │
│              │  [CARD-A] [CARD-B] [CARD-C]              │
│              │  [accept all] [reject all] [confirm →]   │
└──────────────┴──────────────────────────────────────────┘
```

按键操作：
- Arrow keys / Tab 导航卡片
- Space 循环: unset → accepted → rejected → unset
- Enter 展开卡片详情
- `a` = accept all, `r` = reject all, `c` = confirm
- `n` = 方向覆盖（自由文本）
- `q` = 中止 loop

### Phase 4 · EXECUTE
**输入**: accepted CARD-NNN.yaml
**输出**: 修改后的代码, git commit, loop.execution

步骤：
1. 创建 git 分支: meta/loop-NNN
2. 对每个 accepted card：
   - 读取 card.content.scope 获取文件
   - 实施更改
   - 运行 linter/type-check
3. 运行 performance_budget 测量
4. 提交分支

### Phase 5 · EVALUATE
**输入**: 修改后的代码, eval_factors
**输出**: loop.evaluation, card.outcome

步骤：
1. 对每个 eval_factor：
   - type=metric → 运行 measurement_spec
   - type=llm_eval → 运行 LLM 评估
   - type=guardrail → 检查 floor
2. 计算 normalized scores 和 composite_score
3. 运行冲突检测
4. 检查强制回滚条件
5. 计算 prediction_accuracy

### Phase 6 · CLOSE
**输入**: loop-NNN.yaml, design.yaml
**输出**: 更新的 design.yaml

步骤：
1. 更新 requirements[*].coverage
2. 更新 eval_factors[*].threshold.baseline
3. 处理解锁的 NEGs
4. 追加 loop_history 条目
5. 写入 next_loop_hints
6. 显示 loop 摘要

---

## 开发原则

### 1. 不破坏现有功能
对没有 `.meta/` 目录的项目，所有改动完全透明。

### 2. 每步验证
每完成一个阶段，立即运行：
```bash
bun typecheck
bun dev .
```

### 3. 使用已有依赖
不引入新 npm 包（js-yaml 已在项目中）。

### 4. 文件位置
所有新文件放在 `packages/opencode/src/meta/` 目录下。

### 5. 类型安全
TypeScript 严格类型，不用 `any`。

### 6. 模仿已有模式
遇到不确定的 API，先读相邻的已有代码，模仿已有模式，不要发明新的。

---

## 卡片格式

模型输出格式：
```
---CARD START---
objective: 一句话描述目标
approach: 具体技术方案
benefit: 预期收益（尽量量化）
cost: 代价或副作用
risk: 可能出错的地方
confidence: 0.0-1.0
req_refs: REQ-001, REQ-002
warnings: none 或具体约束
---CARD END---
```

---

## design.yaml 结构

```yaml
_schema_version: "1.0.0"
_schema_type: meta_design

project:
  id: string
  name: string
  stage: prototype | mvp | growth | mature
  core_value: string
  anti_value: string
  tech_stack:
    primary: string[]
    forbidden: [{ path, reason, until }]

requirements:
  - id: REQ-001
    text: string
    priority: p0 | p1 | p2
    signal: { type, spec }
    coverage: 0.0-1.0
    coverage_note: string

constraints:
  immutable_modules: [{ path, reason }]
  stable_interfaces: [{ name, spec }]
  performance_budget: [{ metric, threshold, hard }]
  compliance: string[]

rejected_directions:
  - id: NEG-001
    text: string
    reason: string
    scope: { type, condition?, until_phase? }
    source_card: string
    status: active | pending_review | lifted

eval_factors:
  - id: EVAL-001
    name: string
    role: { type, proxies_for? }
    measurement: { type, spec, llm_prompt?, llm_scale? }
    threshold: { target, floor, baseline }
    relations: { conflicts_with?, weight }

search_policy:
  mode: conservative | balanced | exploratory
  max_cards_per_loop: number
  exploration_rate: 0.0-1.0
  candidate_sources: [{ source, weight }]

loop_history:
  total_loops: number
  last_loop_id: string
  loops: [{ loop_id, status, cards_*, summary }]
```

---

## 故障排除

### /meta 命令不可用
- 确保 `.meta/design.yaml` 存在
- 检查文件格式是否正确
- 重启 opencode

### 卡片解析失败
- 检查 `---CARD START---` 和 `---CARD END---` 标记
- 确认 YAML 语法正确

### System context 未注入
- 检查 `.meta/design.yaml` 是否存在
- 查看控制台警告信息

---

## 参考资源

- [loop-runner.design.md](../../../loop-runner.design.md) - Loop Runner 架构设计
- [design.schema.yaml](../../../design.schema.yaml) - design.yaml schema
- [card.schema.yaml](../../../card.schema.yaml) - 卡片 schema
- [loop.schema.yaml](../../../loop.schema.yaml) - 循环记录 schema
