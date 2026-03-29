# Eternity Code 技术方案融合迭代指导

更新日期：2026-03-28

---

## 一、方案总览

本项目已形成以下核心技术方案的完整文档：

| 方案 | 文档位置 | 成熟度 | 融合优先级 |
|------|----------|--------|------------|
| Core Loop Design | `CORE_LOOP_DESIGN.md` | ✅ 已落地 | P0 |
| MetaDesign Framework | `INSTRUCTION.md` | ✅ 已落地 | P0 |
| Sub-agent Dispatch | `SUBAGENT_DISPATCH.md` | ⚠️ 设计完成 | P1 |
| Context Management | `Context 管理策略.markdown` | ✅ 已落地 | P0 |
| Prompt Optimization | `prompt_optimization_guide.md` | ⚠️ 设计完成 | P2 |
| UI/TUI Design | `UI_INSTRUCTION.md` | ⚠️ 部分落地 | P1 |
| Execution Planning | `loop-runner.design.md` | ✅ 已落地 | P0 |

---

## 二、架构全景图

```
┌─────────────────────────────────────────────────────────────────┐
│                      Eternity Code 架构                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌─────────────────────────────────────┐   │
│  │   TUI 层     │     │          CLI / Commands             │   │
│  │  WelcomeScrn │◄────│ /meta /meta-init /meta-decide       │   │
│  │  Loop Route  │     │ /meta-execute /meta-eval /meta-opt  │   │
│  │  Sidebar     │     └──────────────────┬──────────────────┘   │
│  │  CardPanel   │                        │                      │
│  └──────────────┘                        ▼                      │
│                              ┌──────────────────────────────┐   │
│                              │        Session Layer         │   │
│                              │  prompt.ts / llm.ts          │   │
│                              │  MetaDesign Context Injection│   │
│                              └──────────────┬───────────────┘   │
│                                             │                    │
│  ┌─────────────────────────────────────────┼────────────────┐   │
│  │                    MetaDesign Core       │                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────▼──────────┐   │   │
│  │  │ design.ts   │  │ cards.ts    │  │ loop.ts        │   │   │
│  │  │ 状态读取    │  │ 卡片解析/   │  │ 6阶段状态管理  │   │   │
│  │  │ Context构建 │  │ 决策写回    │  │                │   │   │
│  │  └─────────────┘  └─────────────┘  └────────────────┘   │   │
│  │                                                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐   │   │
│  │  │ execute.ts  │  │ evaluator.ts│  │ optimizer.ts   │   │   │
│  │  │ 执行计划    │  │ 评估执行    │  │ 搜索策略优化   │   │   │
│  │  │ preflight   │  │ 结果写回    │  │ negative解锁   │   │   │
│  │  └─────────────┘  └─────────────┘  └────────────────┘   │   │
│  │                                                                │   │
│  │  ┌─────────────────────────┐  ┌────────────────────────┐  │   │
│  │  │ agents/ (未来融合)       │  │ dashboard/             │  │   │
│  │  │ dispatcher              │  │ Web UI                 │  │   │
│  │  │ registry                │  │ 只读浏览               │  │   │
│  │  │ context-builder         │  │ Execution View         │  │   │
│  │  └─────────────────────────┘  └────────────────────────┘  │   │
│  │                                                                │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                    Data Layer (.meta/)                         │   │
│  │  design.yaml | cards/*.yaml | loops/*.yaml | plans/*.yaml      │   │
│  │  negatives/*.yaml | agent-tasks/*.yaml                         │   │
│  └────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、迭代融合路线图

### Phase 1: 核心闭环巩固（P0）

**目标**：确保现有主链稳定运行

#### 1.1 类型统一（OPTIMIZATION_BLUEPRINT）

```
问题：
- ExecutionPreflightSummary vs PlanPreflight 功能重复
- ExecutionOptions vs ExecutorOptions 结构相似
- session 参数使用 any

修复步骤：
→ Step 1: 统一使用 PlanPreflight
→ Step 2: 让 ExecutionOptions 继承 ExecutorOptions
→ Step 3: 删除 prompt-meta.ts 中重复的 DEFAULT_CONFIG
→ Step 4: 为 session 定义具体类型
→ 验证: bun typecheck
```

#### 1.2 执行编排增强（loop-runner.design.md 已描述）

```
已落地：
- /meta-execute 生成 plans/*.yaml
- preflight 检查

待增强：
- 为每个 Task 生成具体 diff 指令
- 支持 Task 级自动执行与人工确认
- 自动生成 git branch（可选）
```

#### 1.3 Evaluation 闭环

```
已落地：
- /meta-eval 后结果写回 loop 和 cards

待增强：
- 自动执行 Eval Factor 的测量脚本
- 支持 llm_eval 类型的自动评分
- 生成评估报告
```

---

### Phase 2: Sub-agent 调度层（P1）

**目标**：统一 sub-agent 调用，参照 `SUBAGENT_DISPATCH.md`

```
实现顺序：
1. 创建 agents/ 目录结构
   → agents/types.ts      (AgentRole, AgentTask 定义)
   → agents/registry.ts   (角色注册表)
   → agents/dispatcher.ts (调度器核心)
   → agents/context-builder.ts (上下文组装)

2. 实现内置角色
   → card-reviewer.ts   (卡片评分)
   → coverage-assessor.ts (覆盖度评估)
   → planner.ts         (Plan 分解，迁移自 execution/planner.ts)
   → task-executor.ts   (Task 执行)
   → eval-scorer.ts     (LLM eval 打分)
   → prediction-auditor.ts (预测审计)

3. 实现解析器
   → parsers/card-review.ts
   → parsers/coverage.ts
   → parsers/plan.ts
   → parsers/eval-score.ts
   → parsers/prediction-audit.ts
   → parsers/index.ts (解析器注册)

4. 与现有代码集成
   step 1: 将 planner.ts 的调用迁移到 dispatcher
   step 2: 将 runner.ts 的 task-executor 迁移
   step 3: 在卡片生成后插入 card-reviewer
   step 4: 在 loop close 阶段插入 prediction-auditor
   step 5: 将 eval_factor 的 llm_eval 迁移到 eval-scorer

验证：每步完成后运行 bun typecheck
```

---

### Phase 3: UI/Dashboard 完善（P1）

**目标**：提升可视化与交互体验，参照 `UI_INSTRUCTION.md`

#### 3.1 TUI Loop 界面增强

```
已完成：
- WelcomeScreen (形态 A/B)
- Sidebar 组件基本展示

待实现：
- 实时展示 Task 执行状态（pending→running→completed/failed）
- 执行过程中的代码 diff 预览
- 失败 Task 的错误信息展示
- 支持在 TUI 中手动确认或跳过 Task

优先级：高（直接关系用户体验）
```

#### 3.2 Dashboard 交互增强

```
当前状态：只读浏览

待增强：
- 在浏览器中查看 Task 执行详情
- 支持浏览器中触发 rollback
- 展示 Evaluation 结果趋势图
- 展示 Search Policy 优化历史
```

#### 3.3 实时更新机制

```
评估选项：
- WebSocket
- Server-Sent Events
- 轮询间隔优化
- 缓存机制

推荐：SSE（实现简单，资源消耗低）
```

---

### Phase 4: Prompt 优化系统（P2）

**目标**：建立三层 prompt 优化架构，参照 `prompt_optimization_guide.md`

#### 4.1 元层实现

```
核心约束：
- 核心任务用 1-2 句话说清楚
- 约束只写影响输出质量的必要项
- 给模型留出填充细节的自由度
- 输出格式只规定结构，不规定措辞
```

#### 4.2 优化 Pass 实现

```
检查项：
- 指令密度检查（token / 核心意图）
- 冲突检测（关键词对匹配）
- 冗余约束检测（语义相似度）
- 留白检查（over-specify 字段）
```

#### 4.3 反馈环设计

```
信号流：
卡片评分 → 聚合为 prompt 模板评分 → 更新元层 → 下一轮生成更优

约束：
- 使用 N 次以上均值（N ≥ 5）
- 区分噪音类型：内容/结构/Prompt质量
```

---

## 四、文件依赖关系

### 核心入口

```
index.ts (主程序入口)
  └── session/prompt.ts (命令分发)
        └── meta/command.ts (/meta* 命令实现)
              ├── meta/design.ts (状态读取)
              ├── meta/cards.ts (卡片管理)
              └── meta/loop.ts (循环状态)
```

### 状态文件依赖

```
.meta/design.yaml
  ├── requirements[]
  ├── constraints{}
  ├── rejected_directions[]
  ├── eval_factors[]
  ├── search_policy{}
  └── loop_history{}

.meta/cards/CARD-XXX.yaml
  ├── content{}
  ├── decision{status}
  └── outcome{}

.meta/loops/loop-XXX.yaml
  ├── phase
  ├── candidates{}
  └── execution{}

.meta/plans/PLAN-XXX.yaml
  ├── tasks[]
  └── preflight{}
```

---

## 五、融合检查清单

### 每次迭代前检查

```
□ 当前文件是否已通过 bun typecheck
□ 没有 .meta/ 的项目是否行为完全透明
□ 新增模块是否放在 meta/ 目录下
□ TypeScript 严格类型，无 any
```

### Phase 1 验收

```
□ 类型统一完成，无重复定义
□ bun typecheck 无错误
□ /meta-execute 生成 plans 正常
□ /meta-eval 评估结果正确写回
```

### Phase 2 验收

```
□ dispatcher 可正确调用所有内置角色
□ context-builder 按需注入 MetaDesign 上下文
□ 解析器正确解析各角色输出
□ 与现有 planner/runner 代码正确集成
□ agent-tasks/*.yaml 记录完整
```

### Phase 3 验收

```
□ TUI 实时展示 Task 执行状态
□ Dashboard 支持浏览器交互
□ 轮询/SSE 延迟 < 1s
```

### Phase 4 验收

```
□ 指令密度在甜点区间
□ 无冲突约束
□ 反馈环 N ≥ 5 次均值可用
```

---

## 六、风险与回滚

### 技术风险

| 风险 | 缓解措施 |
|------|----------|
| Sub-agent 调度层破坏现有功能 | 逐步迁移，每步独立可回滚 |
| 类型修改导致编译错误 | 每步后运行 typecheck |
| 自动执行安全性 | 保留 preflight-first 策略 |

### 回滚方案

```
# 如果某步出错
git stash  # 回退到上一个干净状态
# 检查具体文件，模仿已有模式修复
```

---

## 七、重要约束

1. **不破坏现有功能**：对没有 `.meta/` 的项目，所有改动必须透明
2. **优先使用已有依赖**：不引入新 npm 包（js-yaml 已在项目）
3. **新文件放 meta/**：所有 MetaDesign 相关文件放在 `packages/eternity-code/src/meta/`
4. **严格 TypeScript 类型**：不使用 `any`
5. **上下文 Token 控制**：遵循 `Context 管理策略.markdown`，总 token ≤ 40% max context

---

## 八、下一步行动

**立即执行（本周）**：
1. 执行 Phase 1.1 类型统一（OPTIMIZATION_BLUEPRINT）
2. 运行 `bun typecheck` 验证

**短期目标（下周）**：
1. 创建 agents/ 目录结构
2. 实现 dispatcher + registry + context-builder
3. 迁移 planner.ts 到 dispatcher

**中期目标（两周内）**：
1. 实现内置 6 角色
2. TUI Loop 界面增强
3. Dashboard 交互增强

---

*文档版本：2026-03-28*
*维护者：opencode iteration guidance*