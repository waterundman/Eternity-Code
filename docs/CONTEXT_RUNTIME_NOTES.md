# Context Runtime Notes

## Current Rule

`ContextMixer` 现在不再只是返回一段混合字符串，它还会输出可追踪的预算诊断信息，并在 sub-agent 调度时落盘到 `.meta/context/`。

## What Changed

- `ContextMixer.mixDetailed()` 会返回 token 用量、分层预算、是否超预算、long-term 来源列表。
- Long-term retrieval 现在会递归扫描 `.meta/` 下的 `yaml/yml/md` 文件，而不是只看顶层目录。
- Dispatcher 在启用 Context Mixer 时会为每个 agent task 生成对应的 context snapshot。
- Dashboard bootstrap 会附带最新一份 context snapshot，供 UI 展示预算和检索来源。

## Snapshot Contract

每份 `.meta/context/*.yaml` 快照至少应包含：

- `taskId`
- `roleId`
- `triggeredBy`
- `task`
- `targetFiles`
- `rolePromptTokens`
- `finalSystemPromptTokens`
- `diagnostics`
- `layers`

## Budget Rule

当前预算控制分两层：

1. 每层先遵守自己的 `maxTokens` 和 `maxPercent`。
2. 最终混合结果再被压到 `total * 0.4` 的推荐上限内。

如果总量超线，会优先压缩：

1. `longTerm`
2. `shortTerm`
3. `midTerm`

`system` 层默认不主动牺牲。

## Dashboard Rule

Dashboard 里的 Context Budget 卡片当前只展示最新一份快照，不做历史对比。

如果下一轮要继续增强，优先考虑：

1. 增加 context snapshot 历史视图。
2. 展示不同 role 的平均 budget 命中率和截断率。
3. 把 prompt optimization 前后 token 变化一起记录进快照。
