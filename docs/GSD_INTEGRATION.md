# GSD Integration

更新日期：2026-03-21

## 结论先行

GSD 在当前仓库里已经不是单纯文档概念，而是以“accepted card -> execution plan -> local preflight -> evaluation”的形式部分落地。

当前最重要的事实：

1. 主链在 `opencode-dev/packages/eternity-code/src/meta/*`
2. `packages/loop-runner` 仍存在，但不是默认 TUI runtime
3. `/meta-execute` 当前的职责是“生成计划并做 preflight”，不是“默认自动改代码”

## 已落地能力

### Design State

- `.meta/design.yaml` 是核心状态源
- loop history 会同步写回 design
- rejected directions 会写入 negative space

### Decision Layer

- `/meta` 生成 cards
- `/meta-decide` + Loop UI 完成 accept / reject
- reject note 会一起写回

### GSD Execution Planning

- `/meta-execute` 为 accepted cards 生成 `.meta/plans/*.yaml`
- 每个 plan 被拆成多个 task
- 每个 plan / task 都会得到 preflight 结果

当前 preflight 会检查：

- 空的 `files_to_modify`
- glob 路径
- 越界路径
- 目录路径
- `.git/` / `node_modules/` 目标
- 缺失 task 依赖
- task dependency cycle
- 多 task 命中同一文件

### Visibility

- Loop route 会展示 execution preflight 状态
- Dashboard execution tab 会展示 blockers / warnings / touched files / task readiness

### Evaluation and Close

- `/meta-eval` 会写回 evaluation
- `/meta-optimize` 会写回 close summary 与优化结果

## 当前没有落地为默认行为的部分

以下能力仍然不是当前默认主链：

- 自动执行 plan task
- 自动改代码
- 自动创建 branch
- 自动 commit
- 自动 rollback

仓库里虽然有更激进的实验实现，但还没有被接进当前默认 `/meta-execute` 流程。

## 推荐理解方式

现在最准确的理解不是“GSD 已经全自动”，而是：

当前系统已经具备了 GSD 的计划层和检查层，正在从“生成计划”推进到“可安全执行的编排层”。

## 下一步建议

1. 在保留 preflight-first 的前提下，为 `/meta-execute` 增加更细的 execution orchestration。
2. 让 dashboard 继续吃 execution / evaluation 的更多细节。
3. 将 `packages/loop-runner` 中成熟的 phase 逻辑逐步吸收到当前主链，而不是直接切换运行入口。
