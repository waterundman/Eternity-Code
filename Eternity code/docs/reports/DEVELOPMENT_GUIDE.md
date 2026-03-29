# MetaDesign 开发指南

更新时间：2026-03-21

本文档面向继续迭代当前 MetaDesign / GSD / UI 链路的开发者。

## 先记住当前事实

当前默认主链不是抽象文档，也不是 `packages/loop-runner`，而是：

- `packages/opencode/src/meta/*`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/cli/cmd/tui/*`
- `packages/opencode/src/meta/dashboard/*`

如果你要继续做功能，请优先读这些目录。

## 关键入口

### 1. 设计文件与上下文

- `packages/opencode/src/meta/design.ts`
  - 读取 `.meta/design.yaml`
  - 构建 system context

### 2. 本地命令链

- `packages/opencode/src/session/prompt.ts`
  - 处理 `/meta-init`
  - 处理 `/meta-decide`
  - 处理 `/meta-execute`
  - 处理 `/meta-eval`
  - 处理 `/meta-optimize`

### 3. TUI 入口

- `packages/opencode/src/cli/cmd/tui/routes/home.tsx`
- `packages/opencode/src/cli/cmd/tui/components/meta/WelcomeScreen.tsx`
- `packages/opencode/src/cli/cmd/tui/routes/loop/index.tsx`
- `packages/opencode/src/cli/cmd/tui/components/meta/CardPanel.tsx`
- `packages/opencode/src/cli/cmd/tui/components/meta/Sidebar.tsx`

### 4. 运行态文件

- `.meta/design.yaml`
- `.meta/cards/*.yaml`
- `.meta/loops/*.yaml`
- `.meta/plans/*.yaml`

## 当前命令语义

请以当前代码语义为准，不要按旧文档理解：

- `/meta-init`
  - 本地初始化 `.meta/`

- `/meta`
  - 进入新一轮 loop，生成卡片

- `/meta-decide`
  - 决策待处理卡片

- `/meta-execute`
  - 生成安全执行计划
  - 不是默认自动代码执行器

- `/meta-eval`
  - 写回评估结果

- `/meta-optimize`
  - 写回 close / optimize 结果

## 当前最值得推进的方向

### 1. 执行层

如果要继续加强 GSD，请优先做：

- preflight
- plan validation
- execution state 展示
- execution 后评估回写

不要直接回到高风险自动执行。

### 2. 决策层

当前 `CardPanel` 已能记录 reject note。后续可以继续做：

- 更好的批量拒绝备注流
- 决策恢复
- 卡片筛选与排序

### 3. Dashboard

当前 Dashboard 已能展示基础状态。后续适合补：

- execution task 级展示
- evaluation 详情
- optimize 结果对比

## 修改代码后的最小验证

每轮改完至少跑：

```bash
bun run --cwd packages/opencode typecheck
```

如果改动涉及 MetaDesign 文件读写，建议手动检查：

```bash
.meta/design.yaml
.meta/cards/
.meta/loops/
.meta/plans/
```

## 文档维护原则

继续维护文档时，请遵守以下原则：

1. 以当前代码为准，不以旧报告为准。
2. 明确区分“已运行”和“仅存在代码/方案”。
3. 明确区分当前主链与 `packages/loop-runner`。
4. 不要再把 `/meta-execute` 写成默认自动执行命令。

## 推荐阅读顺序

如果是第一次接手当前链路，建议按以下顺序读代码：

1. `packages/opencode/src/meta/design.ts`
2. `packages/opencode/src/meta/loop.ts`
3. `packages/opencode/src/meta/execute.ts`
4. `packages/opencode/src/session/prompt.ts`
5. `packages/opencode/src/cli/cmd/tui/routes/loop/index.tsx`
6. `packages/opencode/src/cli/cmd/tui/components/meta/CardPanel.tsx`
7. `packages/opencode/src/meta/dashboard/server.ts`
8. `packages/opencode/src/meta/dashboard/html.ts`
