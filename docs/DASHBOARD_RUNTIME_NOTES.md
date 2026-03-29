# Dashboard Runtime Notes

## Current Rule

Dashboard 页面现在应优先把 `/api/dashboard/bootstrap` 视为主读取入口。

它聚合了以下状态：

- `runtime`
- `agentTasks`
- `agentTaskStats`
- `coverage`
- `feedback`
- `usage`
- `currentModel`

## Why

之前 Dashboard 会在一次 `refresh()` 里并行读取多份状态，再在前端重新拼装。这会带来两个问题：

- 前端可能在不同时间点拿到不同轮次的 loop / plan / feedback 数据
- 高频刷新和 SSE 同时触发时，会放大请求数量和状态抖动

## Frontend Contract

- 首屏和定时刷新默认读 `/api/dashboard/bootstrap`
- `runtime.status` 仍然是 phase/status 的权威来源
- 决策卡片渲染要兼容 `MetaDecisionCard` 的真实结构，也就是 `content.*` 和 `prediction.confidence`

## SSE Contract

服务端当前发送的是命名事件，不是默认 `message` 事件。

前端应通过 `addEventListener()` 监听命名事件，例如：

- `state`
- `loops`
- `cards`
- `plans`
- `config`
- `loop`
- `execution`
- `optimization`
- `coverage`
- `negatives`
- `reports`

## Follow-up

下一轮如果继续硬化，优先做这两件事：

1. 把 `html.ts` 的内联脚本拆成模块化前端逻辑。
2. 让 `/api/loop/*` 接到真实 session，而不是继续停留在 experimental 占位。
