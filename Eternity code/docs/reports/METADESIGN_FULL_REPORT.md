# MetaDesign 全量状态报告

更新时间：2026-03-21

本文档以当前代码为准，描述 `opencode-dev` 内 MetaDesign 的真实实现状态。

## 结论

MetaDesign 已经不再是单纯 prompt 设计，而是形成了一个真实可运行的本地状态系统：

- 有真实设计文件。
- 有真实 loop / card / plan 文件。
- 有真实 TUI 路由与欢迎页。
- 有真实本地命令链。
- 有真实 Dashboard 展示。

但它仍然没有走到“完全自动执行代码”的阶段，当前默认策略是“计划优先，执行保守”。

## 当前运行主链

### 状态与上下文

- `packages/opencode/src/meta/design.ts`
  - 负责读取 `.meta/design.yaml`
  - 负责构建 system context

- `packages/opencode/src/session/llm.ts`
  - 把 MetaDesign context 注入模型调用

### 命令入口

- `packages/opencode/src/session/prompt.ts`
  - 本地处理 `/meta-init`
  - 本地处理 `/meta-decide`
  - 本地处理 `/meta-execute`
  - 本地处理 `/meta-eval`
  - 本地处理 `/meta-optimize`

- `packages/opencode/src/command/index.ts`
  - 暴露命令描述与命令注册

### TUI

- `packages/opencode/src/cli/cmd/tui/routes/home.tsx`
  - 当前启动页
  - 已接入真实 `WelcomeScreen`

- `packages/opencode/src/cli/cmd/tui/components/meta/WelcomeScreen.tsx`
  - 真实显示 `.meta/design.yaml` 项目状态

- `packages/opencode/src/cli/cmd/tui/routes/loop/index.tsx`
  - 当前 Loop 主路由
  - 负责读取 loop runtime 并驱动决策/执行/评估状态显示

- `packages/opencode/src/cli/cmd/tui/components/meta/CardPanel.tsx`
  - 决策面板
  - 支持 accept / reject
  - 支持 reject note 录入与补录

### 本地运行文件

- `.meta/design.yaml`
- `.meta/cards/*.yaml`
- `.meta/loops/*.yaml`
- `.meta/plans/*.yaml`

## 已完成能力

### 1. 设计初始化

- `/meta-init` 已本地创建 `.meta/` 和默认 `design.yaml`
- 不再依赖模型输出来完成初始化

### 2. Loop 生成

- `/meta` 已能触发 loop 卡片生成
- 卡片可写入 `.meta/cards/`
- loop 可写入 `.meta/loops/`

### 3. 人工决策

- Loop route 已能读取 pending cards
- `CardPanel` 已支持：
  - Tab / 方向键切换
  - `a` 接受
  - `r` 拒绝
  - `n` 编辑 reject note
  - `A` / `R` 批量标记
  - `Ctrl+Enter` 保存决策

- 拒绝卡片会要求补齐 reject note，避免 negative space 缺少原因

### 4. 执行规划

- `/meta-execute` 当前语义为“生成安全执行计划”
- 会生成 `.meta/plans/*.yaml`
- 会把计划信息写回 loop 的 execution 字段

### 5. 评估与优化

- `/meta-eval` 会写回 evaluation
- `/meta-optimize` 会写回 close summary
- loop history 与 design 汇总可同步刷新

### 6. UI 与 Dashboard

- 启动页已是 MetaDesign-aware
- Loop 页面已读取真实 loop/card/plan 状态
- Dashboard 已可读取 design / loops / cards / negatives / plans

## 当前没有完成的能力

### 1. 自动代码执行闭环

当前默认主链没有自动把 `.meta/plans/*.yaml` 变成真实代码改动。

换句话说：

- 计划已是真实的。
- 执行仍然主要依赖人工或后续更安全的执行层。

### 2. `packages/loop-runner` 主链合并

当前 TUI 主链和 `packages/loop-runner` 是并行存在，不是同一套执行事实。

### 3. 文档全面同步

虽然核心报告已开始清理，但仓库中仍有一些旧文档带有乱码或过时描述。

## 当前最值得继续做的事

1. 补 preflight / execute 的更安全本地闭环。
2. 让 Dashboard 对 execution / evaluation 状态展示得更细。
3. 继续清理旧报告，把事实文档统一到一套。
4. 评估如何吸收 `packages/loop-runner` 中可复用而不过时的部分。
