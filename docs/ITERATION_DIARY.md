# 迭代日记

## 2026-03-31 — 入口链分析与启动修复

### 程序启动链路分析

完整启动链路：
```
eternity-code [project] [--cwd DIR]
  │
  ▼
bin/eternity-code (Node.js launcher — 查找 native binary)
  │  (开发模式: bun run src/index.ts)
  ▼
src/index.ts (yargs CLI)
  │  中间件: Log.init, env vars, DB migration
  ▼
TuiThreadCommand ($0 默认命令)
  │  解析 [project] 和 --cwd
  │  process.chdir(next)
  │  启动 Worker 线程 (worker.ts → Server.listen)
  │  启动 Dashboard (startDashboard)
  ▼
tui({ url, directory, config, fetch, events, args })
  │  app.tsx → render() → @opentui/solid
  ▼
Provider 链 (20+ 层)
  │  ArgsProvider → SDKProvider → SyncProvider → MetaDesignProvider → ...
  ▼
WelcomeScreen / Home / Session / Loop
```

### 发现的问题

1. **工作区指定不够灵活**：只能通过 `[project]` 位置参数，没有 `--cwd` 选项
2. **Workspace 管理默认关闭**：`Flag.OPENCODE_EXPERIMENTAL_WORKSPACES` 需要手动开启
3. **MetaDesign 不响应目录切换**：只在 `onMount` 加载一次
4. **SSE 连接失败无反馈**：空白屏幕，用户不知道是连接问题还是加载问题

### 本轮修复

#### 1. 添加 `--cwd` CLI 参数

**文件**：`src/cli/cmd/tui/thread.ts`
- 新增 `--cwd` 选项，优先级高于 `[project]`
- 目录解析逻辑更新：`targetDir = args.cwd ?? args.project`

**文件**：`src/cli/cmd/tui/context/args.tsx`
- Args 接口新增 `project?: string` 和 `cwd?: string`

#### 2. Workspace 管理默认开启

**文件**：`src/flag/flag.ts`
- `OPENCODE_EXPERIMENTAL_WORKSPACES` 从 `OPENCODE_EXPERIMENTAL || env` 改为 `!falsy(env)`
- 现在默认开启，除非显式设置 `OPENCODE_EXPERIMENTAL_WORKSPACES=false`

#### 3. MetaDesign 自动重载

**文件**：`src/cli/cmd/tui/context/metadesign.tsx`
- 新增 `createEffect` 监听 `sdk.directory` 变化
- 切换工作区后自动重新加载 design

#### 4. SSE 连接诊断

**文件**：`src/cli/cmd/tui/context/sdk.tsx`
- 新增 `connected` 和 `connectionError` 信号
- SSE 连接失败自动重试（3s 间隔）
- 切换 workspace 时重置连接状态

**文件**：`src/cli/cmd/tui/components/meta/WelcomeScreen.tsx`
- 新增连接错误诊断页面
- SSE 连接失败时显示 "Server connection failed" + 错误信息 + "Retrying automatically..."
- 不再显示空白屏幕

#### 5. 测试修复

**文件**：`test/cli/tui/thread.test.ts`
- 新增 `cwd: undefined` 字段匹配更新后的 Args 类型

### 启动方式验证

| 启动方式 | 命令 | 状态 |
|----------|------|------|
| 开发模式 | `bun run dev` | ✅ 正常 |
| 开发模式+指定目录 | `bun run dev -- /path/to/project` | ✅ 正常 |
| 开发模式+cwd | `bun run dev -- --cwd /path/to/project` | ✅ 新增 |
| 生产模式 | `eternity-code` | ✅ 正常 |
| 生产模式+指定目录 | `eternity-code /path/to/project` | ✅ 正常 |
| 生产模式+cwd | `eternity-code --cwd /path/to/project` | ✅ 新增 |
| Attach 模式 | `eternity-code attach http://localhost:4096` | ✅ 正常 |
| Server 模式 | `eternity-code serve` | ✅ 正常 |

### 类型检查

仅剩 1 个预先存在的 plugin 类型错误（`src/plugin/index.ts`），与本次改动无关。

---

## 2026-03-31 — Claude Code 使用逻辑分析与问题诊断（早期记录）

### 背景

对比 Claude Code 演示代码与 Eternity Code 的 TUI 实现，发现两个关键问题：

1. **无法随意指定工作区**
2. **TUI 不会正常显示**

### 根因分析

#### 问题 1：工作区指定机制差异

**Claude Code 演示代码**：纯 Python CLI，工作区 = 当前目录
**Eternity Code**：C/S 架构，workspace 由 SDK 连接参数决定

#### 问题 2：TUI 显示异常

- 20+ 层 Provider 链依赖，任何一环失败导致空白屏幕
- SSE 连接失败无反馈
- MetaDesign 只在 onMount 加载一次

### 修复方案（已实施）

- 方案 A：简化工作区切换 ✅
- 方案 B：TUI 显示修复 ✅
- 方案 C：独立运行模式（长期）⏸
