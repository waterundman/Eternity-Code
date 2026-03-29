# Current Architecture

## 定位

这份文档描述的是当前代码里的真实主链，不是目标态设计稿。

当前主链以 `opencode-dev/packages/eternity-code` 为准，其他实现如果没有明确接入这里，都应视为实验性或辅助性实现。

## 仓库分层

- `docs/`
  文档、报告、设计稿。
- `schema/`
  design/card/loop 相关 schema。
- `examples/`
  示例配置。
- `opencode-dev/`
  实际运行工程。

## 当前权威运行时

主运行时位于：

- `opencode-dev/packages/eternity-code/src`

其中当前最关键的主链模块是：

- `session/llm.ts`
  把 `.meta/design.yaml` 注入系统上下文。
- `session/prompt.ts`
  负责 `/meta-init`、`/meta-decide`、`/meta-execute`、`/meta-eval`、`/meta-optimize` 的本地命令入口。
- `meta/loop.ts`
  维护 loop、cards、execution、evaluation 的运行态。
- `meta/execute.ts`
  为 accepted cards 生成/复用 plan，并执行 preflight。
- `meta/runtime.ts`
  汇总当前统一 runtime 快照，供 Dashboard、Tool、后续交互层共享读取。
- `meta/execution/executor.ts`
  当前统一的执行入口，负责 plan 执行、任务状态持久化、回滚。
- `meta/dashboard/server.ts`
  Dashboard API。

## 当前推荐主链

当前建议统一按下面这条链路理解系统：

`MetaDesign -> Card Generation -> Decision -> Plan/Preflight -> Execute -> Evaluate -> Optimize`

对应到代码大致是：

- 生成阶段：`/meta` 与 `cards.ts`
- 决策阶段：`loop.ts`
- 计划与预检：`execute.ts`
- 执行阶段：`execution/executor.ts`
- 评估阶段：`evaluator.ts`
- 优化阶段：`optimizer.ts`

## 已收敛的实现约定

本轮迭代后，执行层按以下原则收敛：

- `execution/runner.ts`
  保留兼容入口，但内部统一转发到 `execution/executor.ts`。
- `execution/executor.ts`
  作为当前唯一权威执行器，负责 plan 运行、任务状态落盘、回滚状态更新。
- `execution/types.ts`
  统一承载 execution plan / task / preflight 的共享类型。
- `runtime.ts`
  提供 latest loop、accepted loop、pending cards、按 loop 过滤后的 plans 统一快照。

## 当前状态读取约定

从第二轮收敛开始，状态读取推荐优先基于 runtime 快照，而不是分别手动拼：

- Dashboard 推荐走 `/api/runtime`
- Tool 推荐使用 `loadMetaRuntimeSnapshot()`
- 需要读取执行计划时，优先按 loop 使用 `loadExecutionPlansForLoop()`
- loop phase/status 推荐由 runtime 推导，不再单独维护 dashboard 专用影子状态文件

这样可以避免多 loop 并存时把不同轮次的 plans 混在一起。

## 当前实验/未完全收敛区域

- `packages/loop-runner`
  保留为实验性六阶段 loop 实现，不应与主运行时并列理解。
- Dashboard 中依赖真实 session 的闭环操作
  当前没有接入正式 session 时，不再使用 mock session 伪造执行结果。
- Prompt Feedback、Coverage、Context Mixer
  已有框架，但数据质量和主链接入仍在持续收敛。

## 当前状态真相

当前系统的真实状态不是“没有能力”，而是：

1. 多数核心能力已经进入代码库。
2. 但部分能力还存在历史并行实现。
3. 本轮优化的重点是继续减少“双轨实现”和“演示型闭环”。

## 后续维护约束

- 新能力默认接入 `packages/eternity-code` 主链。
- 新文档需要标明自己属于 `current-state`、`roadmap` 或 `experimental`。
- 如果某个入口只能靠 mock session 跑通，就不能再标注为默认主链能力。
