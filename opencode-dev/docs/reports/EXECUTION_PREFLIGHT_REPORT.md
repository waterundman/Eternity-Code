# Execution Preflight Report

更新日期：2026-03-21

## 背景

MetaDesign 当前最大的认知偏差集中在 execute 阶段：

- 旧设计稿更接近“自动执行器”
- 当前主链实际更接近“计划生成器 + 本地 preflight 检查器”

这份报告用于固定这轮新增的执行语义，避免后续把 `/meta-execute` 再误读成默认自动改代码入口。

## 本轮新增事实

### 1. `/meta-execute` 现在会做 preflight

执行计划生成完成后，系统会立即对 `.meta/plans/*.yaml` 做本地检查，并把结果写回 plan 与 loop：

- plan 级：
  - `preflight.status`
  - `preflight.summary`
  - `preflight.warnings`
  - `preflight.blockers`
  - `preflight.touched_files`
- task 级：
  - `preflight.status`
  - `preflight.summary`
  - `preflight.warnings`
  - `preflight.blockers`

### 2. 当前 preflight 检查范围

当前检查项包括：

- 空的 `files_to_modify`
- glob 路径
- 越界路径
- 目录路径
- `.git/` / `node_modules/` 目标
- 缺失 task 依赖
- task dependency cycle
- 多 task 命中同一文件
- touches `.meta/` 的提醒

### 3. loop 元数据已同步 readiness

loop execution 现在不再只是“有计划 / 没计划”，而是会显式记录：

- `preflight_status`
- `ready_plans`
- `warning_plans`
- `blocked_plans`
- `warnings`
- `blockers`

## UI 对齐

### TUI Loop route

Loop route 现在会在 execution 阶段显示：

- preflight 状态
- ready / warning / blocked plan 数量
- blockers / warnings 摘要

### Dashboard execution tab

Dashboard 现在会显示：

- runtime plan status
- preflight status
- blockers
- warnings
- touched files
- task 级 preflight 摘要

## 当前结论

执行阶段现在已经进入“可判断是否可安全推进”的状态，但还没有进入“系统默认自动执行 task”的状态。

更准确的表述是：

`/meta-execute` 已经是安全执行准备入口，不是默认自动执行入口。

## 下一轮建议

1. 基于 preflight 状态增加更明确的 execution orchestration。
2. 让 evaluation / optimization 结果继续回流到 execution 视图。
3. 继续把 `packages/loop-runner` 中成熟的 phase 逻辑有选择地吸收到当前主链。
