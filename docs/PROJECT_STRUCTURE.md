# Eternity Code 项目结构

> 最新的主链说明请优先查看 [CURRENT_ARCHITECTURE.md](W:/项目仓库/Eternity%20code/docs/CURRENT_ARCHITECTURE.md)。
> 文档入口索引见 [README.md](W:/项目仓库/Eternity%20code/docs/README.md)。

## 总览

这个仓库分成两层：

1. 根目录的 `docs/`、`schema/`、`examples/` 负责文档、协议和示例。
2. `opencode-dev/` 才是实际运行的工程，TUI、命令系统、MetaDesign、Dashboard 都在这里。

## 目录结构

```text
Eternity code/
├── docs/                       # 根级文档与报告
├── schema/                     # design/card/loop schema
├── examples/                   # 示例配置与示例产物
│   └── design.yaml             # 示例 MetaDesign 配置
└── opencode-dev/               # 实际运行工程
    ├── start.bat
    ├── start.sh
    ├── package.json
    ├── bun.lock
    └── packages/
        └── eternity-code/
            └── src/
                ├── cli/cmd/tui/         # TUI 页面与组件
                ├── command/             # /meta 等命令定义
                ├── meta/                # MetaDesign 核心逻辑
                │   ├── cards.ts         # 卡片读写与决策结果写回
                │   ├── loop.ts          # loop 运行态、执行态、评估态
                │   ├── execute.ts       # 本地执行计划编排
                │   ├── init.ts          # /meta-init 本地初始化
                │   ├── evaluator.ts     # /meta-eval
                │   ├── optimizer.ts     # /meta-optimize
                │   ├── execution/       # planner/runner 与执行 plan 类型
                │   └── dashboard/       # Web dashboard
                ├── plugin/              # 插件系统
                ├── provider/            # 模型提供商
                ├── session/             # 会话与 prompt 主循环
                └── ...
```

## 运行入口

实际启动链路在 `opencode-dev/packages/eternity-code/src`：

- `index.ts`
  负责主程序入口。
- `cli/cmd/tui/thread.ts`
  负责 TUI 线程与界面启动。
- `session/prompt.ts`
  负责普通 prompt 和 `/meta*` 命令分发。
- `session/llm.ts`
  负责模型调用，并把 `.meta/design.yaml` 注入系统上下文。

## MetaDesign 关键模块

`opencode-dev/packages/eternity-code/src/meta/` 是这次改造的核心目录。

| 文件 | 作用 |
| --- | --- |
| `design.ts` | 读取 `design.yaml` 并构建 system context |
| `plugin.ts` | 解析 assistant 输出里的 card 并自动落盘 |
| `cards.ts` | card/negative/loop_history 写回 |
| `loop.ts` | loop 运行态、决策态、执行态、评估态管理 |
| `execute.ts` | 为已接受 card 生成或复用 `.meta/plans/*.yaml` |
| `init.ts` | 本地初始化 `.meta/` 目录与默认配置 |
| `evaluator.ts` | 评估结果与 baseline 更新 |
| `optimizer.ts` | 搜索策略优化与 negative 解锁 |
| `dashboard/` | Dashboard API 与 HTML 页面 |

## 命令语义

当前 MetaDesign 主命令含义如下：

| 命令 | 当前语义 |
| --- | --- |
| `/meta` | 生成新一轮候选 card |
| `/meta-init` | 本地初始化 `.meta/` |
| `/meta-decide` | 进入决策阶段，处理 pending cards |
| `/meta-execute` | 为已接受的 cards 生成安全执行计划，不直接跑危险执行器 |
| `/meta-eval` | 评估执行结果并写回 loop/design |
| `/meta-optimize` | 根据历史结果优化 search policy |

## Dashboard API

Dashboard 默认端口是 `7777`，由 `meta/dashboard/server.ts` 提供：

| 端点 | 说明 |
| --- | --- |
| `GET /` | Dashboard 页面 |
| `GET /api/state` | `design.yaml` 全量状态 |
| `GET /api/loops` | `.meta/loops/*.yaml` |
| `GET /api/cards` | `.meta/cards/*.yaml` |
| `GET /api/negatives` | `.meta/negatives/*.yaml` |
| `GET /api/plans` | `.meta/plans/*.yaml` |

## 开发常用命令

```bash
cd opencode-dev/packages/eternity-code
bun typecheck
```

```bash
cd opencode-dev
bun dev .
```
