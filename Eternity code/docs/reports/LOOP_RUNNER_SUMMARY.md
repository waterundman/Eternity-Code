# Loop Runner 现状摘要

更新时间：2026-03-21

## 一句话结论

`packages/loop-runner` 是仓库内存在的独立 runner 包，但它不是当前 TUI 默认运行主链。

## 它是什么

`packages/loop-runner` 提供了一套独立的 6 阶段循环结构：

1. `analyze`
2. `generate`
3. `decide`
4. `execute`
5. `evaluate`
6. `close`

它包含：

- 独立 schema
- 独立 CLI
- 独立 phase 实现
- 独立 `LoopRunner` 类

## 它当前的价值

这个包的价值主要在于“提供完整 runner 结构参考”，而不是“已经替代当前 MetaDesign 主链”。

它对当前仓库仍然有帮助的地方：

- phase 分层比较完整
- schema 组织较系统
- 对完整自动循环的目标形态有参考意义

## 为什么它还不是默认主链

### 1. 当前 TUI 真实主链在别处

当前真正被 TUI / 本地命令 / Dashboard 使用的是：

- `packages/opencode/src/meta/*`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/cli/cmd/tui/*`

### 2. 执行策略不一致

`packages/loop-runner/src/phases/execute.ts` 仍偏向自动执行模型：

- 自动建 branch
- 自动执行
- budget breach 后 rollback branch
- 自动 commit

而当前 TUI 主链已经明确走向：

- 先生成安全 plan
- 先让状态可见
- 尽量避免高风险默认执行

### 3. 两套状态事实并存

如果不做整合，直接把 Loop Runner 当默认主链使用，会产生两类问题：

- 文档说法与实际运行不一致
- 同一概念在两套代码里各有一份实现

## 当前最合理的定位

当前应把 `packages/loop-runner` 视为：

- 可复用的实验 runner 包
- 未来可能吸收的架构参考
- 不是当前默认用户路径

## 推荐集成方式

不建议直接整包切换。更合理的方式是分段吸收：

1. 保持 `packages/opencode/src/meta/*` 为当前主链。
2. 从 Loop Runner 里提取可复用 schema / phase 抽象。
3. 保持当前 `/meta-execute` 的 plan-first 语义。
4. 在安全前提下，逐步补更真实的 preflight / execution 层。

## 当前文档应如何描述它

今后的文档不应再写：

- “Loop Runner 已经完全接管当前 TUI 主流程”
- “当前 `/meta-execute` 已默认自动执行 Loop Runner execute phase”

更准确的描述应是：

- “Loop Runner 包存在，且提供完整 runner 参考实现”
- “当前默认主链仍是 `packages/opencode/src/meta/*`”
- “两者尚未完全整合”
