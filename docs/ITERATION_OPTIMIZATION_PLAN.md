# Eternity Code 迭代优化方案

## 1. 目标与判断

本方案基于 `docs/` 文档和当前代码结构整理，目标不是继续堆叠功能，而是先把已经存在的能力收敛成一条稳定、可维护、可迭代的主链。

当前系统的核心判断如下：

1. MetaDesign、Loop、Dashboard、SubAgent、Prompt Optimization 等能力已经有较多代码落地，不是从零开始。
2. 但“设计主线”“实验主线”“演示主线”仍然混在一起，导致认知成本、维护成本和接入成本都偏高。
3. 下一轮优化优先级不应继续扩展新能力，而应先完成“主链收敛 + 状态统一 + 执行可靠性增强 + 文档真相同步”。

一句话总结当前阶段：

> 系统不是功能不足，而是功能已经前置落地，但主链还没有完全收敛。

## 2. 当前系统现状

### 2.1 代码结构现状

当前真正的主项目位于 `opencode-dev/`，其中关键模块包括：

- `packages/eternity-code`：当前主运行时、MetaDesign、Dashboard、TUI、Tool 主体都在这里。
- `packages/loop-runner`：六阶段循环的实验性实现，更像验证场，不应再与主链并列。
- `packages/sdk`、`packages/ui`、`packages/plugin`：外围能力层。

### 2.2 已经比较清晰的能力

- MetaDesign 可以注入系统上下文。
- `/meta-init`、`/meta-decide`、`/meta-execute`、`/meta-eval`、`/meta-optimize` 已经接入命令体系。
- TUI 中已经存在 loop 路由和卡片/任务状态展示。
- Dashboard 已经具备 loop、plan、agent-task、coverage、feedback、execute 等接口雏形。
- Dispatcher、角色模板、上下文混合、Prompt 优化器都已有代码基础。

### 2.3 当前的主要问题

1. 执行链路重复
   `meta/execute.ts`、`meta/executor.ts`、`meta/execution/runner.ts`、`meta/execution/executor.ts` 同时存在，职责边界不够清晰。
2. 主链与实验链混用
   `packages/loop-runner` 的设计目标和 `packages/eternity-code` 的真实运行时并存，容易让后续迭代分叉。
3. Dashboard 功能很多，但存在演示级实现
   部分接口仍带 mock/fallback 路径，不能完全代表真实执行闭环。
4. 统一状态源不足
   TUI、Dashboard、Tool、Loop Runtime 虽然都在读写 `.meta`，但状态模型还没有完全收敛成唯一真相源。
5. Git 执行安全性有隐患
   存在默认分支写死、硬回滚策略较激进的问题。
6. 评估与优化链条已存在，但数据质量还不够
   Prompt Feedback、Coverage、Evaluation 已有框架，但“真实有效的反馈样本”还偏弱。
7. 文档叙事不一致
   一部分文档描述的是“目标态”，另一部分描述的是“当前真实态”，容易让后续开发误判完成度。

## 3. 本轮优化总原则

### 原则一：先收敛主链，再扩展功能

后续所有新能力必须围绕一条标准主链接入：

`MetaDesign -> Card Generation -> Decision -> Plan/Preflight -> Execute -> Evaluate -> Optimize`

### 原则二：一类能力只保留一个权威入口

- 一个权威执行编排器
- 一个权威状态模型
- 一个权威回滚策略
- 一个权威 Dashboard 数据接口定义

### 原则三：实验能力显式隔离

实验模块可以保留，但必须明确标注 `experimental`，不能再与主运行时平行抢占解释权。

### 原则四：文档必须反映真实代码状态

从本轮开始，文档需要分成三类：

- `Current State`：当前真实已落地
- `Roadmap`：明确计划中
- `Experimental`：实验功能或未接主链能力

## 4. 分阶段迭代方案

### Phase 0：主链收敛与文档校准

### 目标

明确唯一主运行时，结束“多条主线并存”的状态。

### 重点工作

1. 定义权威主链
   以 `packages/eternity-code` 为唯一主链实现，`packages/loop-runner` 降级为实验参考实现。
2. 梳理执行模块职责
   明确：
   - `meta/execute.ts` 负责计划生成与 preflight
   - `meta/execution/executor.ts` 负责实际执行
   - 其余重复执行器逐步合并或废弃
3. 合并重复的数据结构
   将 `ExecutionPreflightSummary` 与 `PlanPreflight` 收敛为一个统一模型。
4. 整理文档分层
   把现有文档拆成“现状 / 路线图 / 实验说明”，避免版本历史和设计稿混淆。

### 交付标准

- 主链文件和实验文件边界明确。
- 新成员能在 30 分钟内看懂系统真实架构。
- 文档描述与当前代码行为基本一致。

### Phase 1：执行链路可靠性增强

### 目标

让 loop 真正具备“可预览、可确认、可执行、可回滚、可追踪”的工程化能力。

### 重点工作

1. 建立统一执行编排器
   统一 `plan -> preflight -> task execution -> commit -> evaluation -> optimization` 的调用入口。
2. 强化 preflight
   在现有路径检查基础上，补齐：
   - 分支状态检查
   - workspace 脏状态策略
   - 多任务文件冲突检查
   - 依赖顺序约束检查
3. 改造 git 安全策略
   - 默认分支动态探测，不再写死 `main`
   - 优先使用可审计的回滚策略
   - 保留执行前快照与执行后变更摘要
4. 统一任务执行记录
   每个任务都记录：
   - 输入上下文
   - 计划摘要
   - 实际修改文件
   - commit / rollback 信息
   - evaluation 结果

### 交付标准

- 一条标准 loop 可以从卡片接受一直跑到执行与评估闭环。
- 失败任务具备明确可见的错误上下文和回滚记录。
- 执行过程不依赖临时 mock 路径。

### Phase 2：状态模型与交互层统一

### 目标

让 TUI、Dashboard、Tool 使用同一份 loop/runtime 状态，而不是各自拼装。

### 重点工作

1. 定义统一 runtime schema
   统一 loop、card、decision、plan、task、evaluation、optimization、feedback 的 schema。
2. 收敛 Dashboard 数据接口
   现有 Dashboard API 保留能力，但要去掉 demo 级 stub，全部改为真实 runtime 驱动。
3. 重构 Dashboard 前端实现
   将当前大体量单文件 HTML/JS 拆分为更清晰的模块结构，降低维护成本。
4. 统一实时更新机制
   保留一种主机制，优先 SSE，减少轮询和重复刷新。

### 交付标准

- Dashboard、TUI、CLI Tool 看到的是同一份运行时状态。
- 相同操作在不同入口表现一致。
- Dashboard 不再依赖大段硬编码逻辑来兜底业务状态。

### Phase 3：SubAgent / Context / Prompt 优化链闭环

### 目标

让“代理调度、上下文注入、提示优化、评估反馈”形成真正可持续迭代的闭环。

### 重点工作

1. Dispatcher 成为唯一代理入口
   规划器、执行器、评估器、覆盖度分析器优先统一走 Dispatcher。
2. 强化 Context Mixer
   从当前启发式拼接升级为：
   - 任务相关代码上下文
   - 历史卡片与计划上下文
   - 长期知识上下文
   - token budget 控制
3. 强化 Prompt Feedback 数据质量
   反馈不只记录成功/失败，还要记录：
   - 是否一次成功
   - 是否需要人工修正
   - 返工原因类别
   - 与执行结果的关联
4. 优化 Coverage / Evaluation 的真实接入
   从框架可用提升为结果可信，减少仅用于展示的假数据。

### 交付标准

- 相同类型任务在多轮运行中能看到提示效果改善。
- agent-task 历史可用于复盘与优化，而不只是日志堆积。
- evaluation/coverage 输出可真正用于下一轮决策。

### Phase 4：产品化与默认体验优化

### 目标

把系统从“可研究、可实验”提升为“可默认使用”。

### 重点工作

1. 建立默认模板工程
   让用户快速初始化 `.meta`、角色、看板和工作流。
2. 建立任务类型模板
   例如 bugfix、refactor、feature、doc、test 等不同卡片模板。
3. 补齐可观测性
   增加执行耗时、成功率、返工率、回滚率、覆盖率变化等指标。
4. 增加集成测试与回归测试
   覆盖核心命令与 loop 主链。

### 交付标准

- 新仓库可以低成本启用 MetaDesign 工作流。
- 常见迭代任务有稳定默认体验。
- 系统升级不会频繁破坏核心 loop 行为。

## 5. 建议的近期排期

### 第一迭代（1-2 周）

目标：收敛主链，停掉结构性发散。

建议 backlog：

1. 输出一份“权威架构说明”，明确主链与实验链边界。
2. 合并执行模块职责，确定唯一执行入口。
3. 统一 preflight 数据结构和 plan/task 状态模型。
4. 清理 Dashboard 中的 mock/stub 执行路径。
5. 重写文档索引，把“现状”和“目标态”拆开。

### 第二迭代（2-3 周）

目标：打通真实执行闭环。

建议 backlog：

1. 完成统一执行编排器。
2. 完成安全回滚与默认分支探测。
3. 让 TUI 的任务确认/跳过/执行控制真正接到运行时。
4. 给 loop 主链增加集成测试。

### 第三迭代（2-3 周）

目标：建立反馈优化闭环。

建议 backlog：

1. 统一 Dispatcher 接入。
2. 提升 Context Mixer 与 Prompt Feedback 的质量。
3. 让 evaluation/coverage 真正参与优化决策。
4. 输出一版可用的运行指标面板。

## 6. 建议的里程碑验收指标

本轮优化不建议只看“功能数量”，应看以下指标：

- Loop 主链从初始化到执行完成的成功率
- 单任务失败后的可定位性
- 回滚成功率
- Dashboard 与 TUI 状态一致性
- Prompt 优化后的返工率变化
- 文档与代码一致性

## 7. 最终建议

接下来的迭代方向应该是：

1. 不再以“新增功能”为主目标。
2. 先把主链收敛成一个稳定的工程系统。
3. 再在统一主链之上逐步增强自动化、代理协作、评估和优化。

如果要给这一轮定一个主题，我建议使用：

> 从“功能并行试验期”进入“主链收敛工程期”

这会比继续加功能更能提升系统的真实可用性和后续迭代效率。
