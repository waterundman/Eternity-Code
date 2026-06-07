# Eternity Code — 完整项目文档（融合版）

> 来源：根目录 `docs/` 全部文件 + 嵌套 `Eternity code/docs/reports/` 全部报告 + `Eternity code/docs/AGENTS.md` & `CONTRIBUTING.md`。
> 时间锚点：2026-03-21（runtime 对齐）/ 2026-06-01（本融合版生成日）。
> 阅读顺序：自上而下即可建立完整心智模型。

---

## 0. 一句话定位

Eternity Code（基于 OpenCode fork 改造）是 **MetaDesign 驱动的本地 TUI 自主软件工程系统**：以 `.meta/` 文件系统为状态，以"卡片决策 → 计划 → preflight → 评估 → 优化"为循环，以 Web Dashboard + TUI 协同为交互，以 Bun + TypeScript 为运行时。**当前默认策略是"计划优先，执行保守"——不会默认自动改代码。**

---

## 1. 项目结构与目录

```
Eternity code/
├── README.md                       # 项目总入口
├── docs/                           # 项目主文档（根）
│   ├── README.md                   # docs 索引
│   ├── PROJECT_DESCRIPTION.md      # 项目说明
│   ├── CURRENT_ARCHITECTURE.md     # 当前真实主链（最高优先级事实）
│   ├── PROJECT_STRUCTURE.md        # 目录结构
│   ├── USAGE_GUIDE.md / USAGE.md   # 使用说明
│   ├── BLUEPRINT.md                # 项目蓝图 P1/P2
│   ├── TWO_SPEED_SYSTEM.md         # 双速认知
│   ├── CORE_LOOP_DESIGN.md         # 核心循环抽象
│   ├── INSTRUCTION.md              # MetaDesign 改造指令
│   ├── DIR_SPEC.md                 # .meta 目录规范（权威）
│   ├── UI_INSTRUCTION.md           # TUI 改造指令
│   ├── DASHBOARD_INSTRUCTION.md    # Dashboard 风格指南
│   ├── SUBAGENT_DISPATCH.md        # SubAgent 调度
│   ├── TOOL_CALLING_GUIDE.md       # 工具调用
│   ├── Context 管理策略.md         # 三层 Context
│   ├── WATCHDOG.md / TUNING.md     # 稳定性与调优
│   ├── OPTIMIZATION_*.md / STABILITY_OPTIMIZATION.md
│   ├── NEW_ITERATION_PLAN.md / ITERATION_DIARY.md
│   ├── ITERATION_OPTIMIZATION_PLAN.md / CLAUDE_CODE_ANALYSIS_ITERATION_PLAN.md
│   ├── ITERATION_GUIDANCE.md / loop-runner.design.md
│   ├── VERSION_HISTORY.md
│   ├── prompt_optimization_guide.md
│   ├── DASHBOARD_*.md / CONTEXT_RUNTIME_NOTES.md
│   └── GSD_*.md / OPTIMIZATION_REPORT.md
├── schema/                         # 设计 schema
├── examples/                       # 示例
├── start.bat / start.sh            # 启动脚本
└── opencode-dev/                   # 实际工程（子仓库）
    └── packages/
        ├── eternity-code/          # 实际承载 MetaDesign 的包
        │   └── src/
        │       ├── meta/           # ★ 当前主链
        │       │   ├── design.ts
        │       │   ├── loop.ts
        │       │   ├── execute.ts
        │       │   ├── runtime.ts
        │       │   ├── dashboard/
        │       │   │   ├── server.ts
        │       │   │   ├── bridge.ts
        │       │   │   └── html.ts
        │       │   ├── cards.ts
        │       │   ├── plans.ts
        │       │   ├── init.ts
        │       │   ├── types.ts
        │       │   └── command.ts
        │       ├── session/llm.ts       # system prompt 注入
        │       ├── session/prompt.ts    # /meta-* 命令处理
        │       ├── command/index.ts     # 命令注册
        │       └── cli/cmd/tui/         # TUI（SolidJS + opentui）
        │           ├── app.tsx
        │           ├── routes/
        │           │   ├── home.tsx
        │           │   └── loop/index.tsx
        │           └── components/meta/
        │               ├── WelcomeScreen.tsx
        │               ├── Sidebar.tsx
        │               ├── CardPanel.tsx
        │               └── LoopHistory.tsx
        └── loop-runner/            # ⚠ 实验 runner，非默认主链
            └── src/phases/         # analyze/generate/decide/execute/evaluate/close
```

**重要事实**：以 `opencode-dev/packages/eternity-code/src/meta/*` 为当前主链；`packages/loop-runner` **不是**默认 TUI runtime。

---

## 2. `.meta/` 目录规范（DIR_SPEC，权威）

```
.meta/
├── design.yaml           # 项目设计主源
├── cognition/
│   ├── insights/         # 长期记忆碎片
│   └── blueprints/       # 已沉淀的方法论
├── execution/
│   ├── cards/            # 决策卡片（生成中/已决策）
│   ├── plans/            # 执行计划
│   ├── loops/            # loop 历史
│   ├── logs/             # 执行日志
│   └── agent-tasks/      # SubAgent 调度结果
├── context/              # Context Mixer 落盘的快照（.yaml）
└── negatives/            # 被拒绝的方向（NEG 负空间）
```

**design.yaml 字段**（参考 `BLUEPRINT.md` & `TWO_SPEED_SYSTEM.md`）：
- `project.name / .stage / .core_value / .anti_value`
- `requirements[]`：覆盖度会出现在 Dashboard
- `constraints`：immutable_modules、performance_budget
- `rejected_directions[]`：负空间，自动注入 system prompt
- `eval_factors[]`：评估基线
- `loop_history[]`：每次 loop 自动 append
- `cognition`：insights/blueprints 长期记忆入口

---

## 3. 七层架构

```
Human
  ↓
TUI (SolidJS + opentui)         ← 交互层
  ↓
META Core                      ← 决策核心
  ↓
Agent Dispatcher               ← SubAgent 调度
  ↓
Execution                      ← 计划 + preflight（不自动改代码）
  ↓
.meta/ 文件系统                 ← 状态持久化
  ↓
Web Dashboard (port 7777)      ← 观测与轻交互
```

---

## 4. 当前主链（最高优先级事实）

**标准主链**：`MetaDesign → Card Generation → Decision → Plan/Preflight → Execute → Evaluate → Optimize`

**核心入口**：
| 角色 | 路径 |
|---|---|
| 设计与上下文 | `opencode-dev/packages/eternity-code/src/meta/design.ts` |
| LLM 注入 | `opencode-dev/packages/eternity-code/src/session/llm.ts` |
| 命令处理 | `opencode-dev/packages/eternity-code/src/session/prompt.ts` |
| Loop 主路由 | `opencode-dev/packages/eternity-code/src/meta/loop.ts` |
| 执行 | `opencode-dev/packages/eternity-code/src/meta/execute.ts` |
| 运行时快照 | `opencode-dev/packages/eternity-code/src/meta/runtime.ts` |
| 执行器 | `opencode-dev/packages/eternity-code/src/meta/execution/executor.ts` |
| Dashboard | `opencode-dev/packages/eternity-code/src/meta/dashboard/server.ts` |
| TUI Bridge | `opencode-dev/packages/eternity-code/src/meta/dashboard/bridge.ts` |
| 卡片管理 | `opencode-dev/packages/eternity-code/src/meta/cards.ts` |

**收敛原则**：
- 执行层统一走 `execution/executor.ts`，不要在 TUI/Dashboard 内部独立起执行器
- 状态读取走 `runtime.ts` 快照，避免散点 IO
- `/meta-execute` 当前语义是「生成安全执行计划 + 本地 preflight」，**不是**默认自动改代码入口

---

## 5. MetaDesign 命令系统

| 命令 | 真实语义（以代码为准） |
|---|---|
| `/meta-init` | 本地初始化 `.meta/`，创建 `design.yaml` 与默认目录 |
| `/meta` | 启动新一轮 loop，生成决策卡片写入 `.meta/cards/` |
| `/meta-decide` | 决策待处理卡片（accept/reject + reject note） |
| `/meta-execute` | 为 accepted cards 生成 `.meta/plans/*.yaml` + preflight |
| `/meta-eval` | 写回 evaluation 结果 |
| `/meta-optimize` | 写回 close summary + 优化结果 |

**禁止误读**：`/meta-execute` 不会默认自动改代码、自动 branch、自动 commit、自动 rollback。

---

## 6. 启动与使用

### 6.1 启动

```bash
# Windows
start.bat
# Linux/macOS
./start.sh
# 或手动
export PATH="$PATH:/c/Users/wxy/.bun/bin"   # Windows Git Bash
export OPENROUTER_API_KEY=...                 # 或其他 provider key
bun dev .
```

启动后：TUI 启动 + Dashboard `http://localhost:7777` 自动可用（如有 `.meta/`）。

### 6.2 第一次使用流程

1. 启动后看到 `WelcomeScreen` 形态 B（无 `.meta/`）→ 引导初始化
2. 输入 `/meta-init` 填写项目名/阶段/核心价值/反价值/需求/约束
3. 输入 `/meta` 触发第一轮 loop
4. 卡片生成后进入 Loop 路由，使用 `CardPanel` 做 accept/reject
5. `/meta-execute` 生成 plan + preflight
6. `/meta-eval` → `/meta-optimize` 收尾

### 6.3 端口

- Dashboard: `7777`（`ETERNITY_DASHBOARD_PORT` 可覆盖）
- OpenCode API server: `4096`（默认）

---

## 7. SubAgent 调度（已部分落地）

**目标**：6-8 个角色（planner / critic / implementer / tester / reviewer / researcher / architect / synthesizer）。

**当前已实现**：
- `ContextMixer.mixDetailed()` 返回 `token` 用量、分层预算、是否超预算、long-term 来源列表
- Long-term retrieval 递归扫描 `.meta/` 下 yaml/yml/md
- Dispatcher 启用 Context Mixer 时为每个 agent task 落盘 `.meta/context/<taskId>-<roleId>.yaml`

**Snapshot 契约**（每份 context 快照必含）：
- `taskId`、`roleId`、`triggeredBy`、`task`、`targetFiles`
- `rolePromptTokens`、`finalSystemPromptTokens`
- `diagnostics`、`layers`

---

## 8. 三层 Context 管理

**四层结构**：
1. `system`（不主动牺牲）
2. `longTerm`（来自 `.meta/cognition/insights` + 历史，递归扫描 .meta 下所有 yaml/yml/md）
3. `midTerm`（当前 loop 的 cards/plans/loops）
4. `shortTerm`（任务即时上下文）

**预算控制**：
1. 每层先遵守自己的 `maxTokens` 和 `maxPercent`
2. 最终混合结果压到 `total * 0.4` 推荐上限
3. 超限时压缩顺序：`longTerm → shortTerm → midTerm`（`system` 不主动牺牲）

**Dashboard 规则**：Context Budget 卡片当前只展示最新一份快照，不做历史对比。

---

## 9. Dashboard 架构

### 9.1 状态聚合

主读取入口：`GET /api/dashboard/bootstrap`，聚合 `runtime / agentTasks / agentTaskStats / coverage / feedback / usage / currentModel`。避免一次 refresh 并行读多份状态造成时间点不一致。

### 9.2 SSE 契约

服务端发送**命名事件**，前端用 `addEventListener()` 监听：
- `state`、`loops`、`cards`、`plans`、`config`
- `loop`、`execution`、`optimization`
- `coverage`、`negatives`、`reports`

### 9.3 已落地能力

- `POST /api/loop/start`：创建/复用真实 session，queue `/meta`，导航 TUI 进入 loop 路由
- `POST /api/loop/decide`：对已生成的 pending loop 持久化决策（**真实**），会校验卡片仍为 pending、要求完整决策集、写回 `.meta/cards` 与 `.meta/loops`、写 NEG、写 prompt feedback
- `POST /api/coverage/assess`：通过 TUI-backed session bridge 运行

**Guardrails**：
- `loop/start` 在 phase ≠ `idle/complete` 时拒绝
- 在另一个 in-flight 启动请求存在时拒绝
- 需要 TUI runtime 提供有效 current model

### 9.4 Dashboard 限制

- 仍**未**自起 loop（loop/start 走 session bridge，但仍是最近才接通的）
- 决策 UI 要求每张 pending card 显式 accept/reject
- 拒绝卡片可填可选 reject note
- `html.ts` 大块内联脚本待拆模块

---

## 10. TUI 路由与交互

### 10.1 启动形态

- 形态 A（已有 `.meta/design.yaml`）：`WelcomeScreen` 显示项目状态
- 形态 B（无 `.meta/`）：`WelcomeScreen` 显示初始化引导
- Home 路由 = 混合 `welcome + prompt`（**不是**独立 `/chat` 路由）

### 10.2 Loop 路由全局快捷键

- `c` 切换对话区
- `h` 切换历史侧栏
- `q` 中止当前 loop
- `/` 聚焦命令输入

### 10.3 CardPanel 快捷键（决策阶段）

| 键 | 行为 |
|---|---|
| `Tab` / `→` / `←` / `↑` / `↓` | 卡片导航 |
| `a` / `r` | 接受/拒绝当前卡片（循环切换） |
| `A` / `R` | 全部接受/拒绝 |
| `Enter` | 展开/折叠详情 |
| `Ctrl+Enter` | 确认所有决策 |
| `Esc` | 清除选择/折叠详情 |
| `n` | 编辑 reject note（拒卡必填） |
| `0` | 跳到第一张卡 |

### 10.4 Sidebar 内容

- 项目名 + stage
- 需求覆盖度（8 格条形图 + %）
- 约束（🔒 标记）
- 负空间 NEG
- 评估基线
- Loop 历史（#N ✓/+0.06 等）

---

## 11. 工具调用模块

设计上将工具调用抽象为：
- **工具注册**：统一 schema + handler
- **工具调用**：参数校验 → handler 调度 → 错误封装
- **结果回写**：落 `.meta/execution/logs/`

详见 `TOOL_CALLING_GUIDE.md`。

---

## 12. 双速认知系统（TWO_SPEED_SYSTEM）

**外化认知层 + 质量监测**，避免每次都让 LLM 重新推导：
- 慢速：人工/MetaDesign 维护 design.yaml 与 cognition/blueprints（稳定、显式）
- 快速：loop 内 LLM 即时推理（多变、隐式）
- 慢速是事实源，快速只生成候选；快速结果落入 execution/cards 后会被 evaluate → optimize 回流到 cognition

---

## 13. 核心循环（6 阶段抽象）

```
analyze → generate → decide → execute → evaluate → close
```

- `analyze`：从 design + cognition + 当前状态形成 brief
- `generate`：LLM 生成 candidate cards
- `decide`：人工 / dashboard 决策（accept/reject + note）
- `execute`：先生成 plan，再 preflight，**当前不默认自动改代码**
- `evaluate`：把执行/质量信号写回 design
- `close`：写回 loop summary + 触发 optimize

---

## 14. GSD 集成（GSD = Get Shit Done）

### 14.1 已落地

- `/meta-execute` 为 accepted cards 生成 `.meta/plans/*.yaml`，每个 plan 拆 task
- 每个 plan / task 都做 preflight 并写回
- Preflight 检查项：
  - 空的 `files_to_modify`
  - glob 路径
  - 越界路径
  - 目录路径
  - `.git/` / `node_modules/` 目标
  - 缺失 task 依赖
  - task dependency cycle
  - 多 task 命中同一文件
  - touches `.meta/` 的提醒
- Loop 元数据已同步 readiness（`preflight_status / ready_plans / warning_plans / blocked_plans`）
- TUI Loop 路由与 Dashboard execution tab 都能看到 blockers / warnings / touched files / task readiness

### 14.2 仍**未**默认的行为

- 自动执行 task
- 自动改代码
- 自动创建 branch / commit / rollback

**正确定位**：「安全执行准备闭环已成立，自动执行闭环尚未成立」。

---

## 15. Loop Runner 现状

`packages/loop-runner` 存在，是独立 6 阶段 runner（analyze/generate/decide/execute/evaluate/close），含独立 schema、CLI、phase 实现、`LoopRunner` 类。**它不是当前默认主链**。

- 价值：完整 runner 形态参考
- 风险：其 `phases/execute.ts` 仍偏向自动建 branch → 执行 → 超 budget rollback → commit，与当前保守策略冲突
- 推荐集成方式：分段吸收可复用 schema / phase 抽象，**不要整包切换**

---

## 16. 异常监控 WATCHDOG（设计稿，已部分落地）

- 监控：LLM 异常、Plan 越界、preflight 阻断、循环空转、决策冲突
- 熔断：阶段级（跳过 / 重试 / 终止）+ 全局（暂停 loop）
- 持久化：异常事件落 `.meta/execution/logs/`，触发 NEG 候选
- 暴露：Dashboard 异常面板 + TUI 状态栏告警

具体落地未在 `CURRENT_ARCHITECTURE.md` 中确认，待补。

---

## 17. TUNING（五项调优方向）

详见 `TUNING.md`，五项包括（未实现为主）：
1. Rubric 四维评分（理解/决策/执行/评估）
2. Sprint Contract
3. Acceptance Checklist
4. Model Assumptions 记录
5. Failure Replay

---

## 18. 优化蓝图与稳定性审查

### 18.1 OPTIMIZATION_BLUEPRINT

围绕：
- 类型层收紧（避免 any、精确返回类型）
- 错误处理统一
- 状态文件落盘原子性
- Context Mixer 性能

### 18.2 STABILITY_OPTIMIZATION（自评 2.3/5）

主要风险：
- `loop.ts` / `execute.ts` 状态机复杂，未必有完整测试
- 执行器与 TUI 强耦合
- 缺乏熔断（WATCHDOG 未落地）
- Prompt 调优缺 Rubric

### 18.3 NEW_ITERATION_PLAN

下一轮迭代以 **WATCHDOG + TUNING 集成** 为主线：先把异常监控 + 五项调优落地，再谈自动执行。

---

## 19. 迭代日记与方向

- `ITERATION_DIARY.md`（2026-03-31 启动修复）
- `ITERATION_OPTIMIZATION_PLAN.md`：当前迭代优化方案
- `CLAUDE_CODE_ANALYSIS_ITERATION_PLAN.md`：对比 Claude Code 演示产物，识别可借鉴项
- `ITERATION_GUIDANCE.md`：多技术方案融合指导
- `loop-runner.design.md`：与当前主链对齐
- `prompt_optimization_guide.md`：Prompt 优化论
- `VERSION_HISTORY.md`：v0.1-v0.5

---

## 20. 早期报告（事实速记）

> 这些是 `Eternity code/docs/reports/` 下的历史完成报告，帮助理解演进路径。

| 报告 | 关键事实 |
|---|---|
| `METADESIGN_COMPLETE.md` | 第零~四步：摸清地形 → 创建 meta 读取层 → 注入 system prompt → 注册 /meta |
| `VERIFICATION_REPORT.md` | 类型检查通过；无 `.meta/` 项目行为完全一致 |
| `INTEGRATION_COMPLETE.md` | 设计文件、卡片、Loop、命令、Dashboard、注入全部对接 |
| `PHASE1_COMPLETE.md` | Phase 1：插件自动保存卡片 / /meta-decide / 自动生成 NEG / Loop 历史 |
| `RUNTIME_ALIGNMENT_2026-03-21.md` | Provider 改用共享 loader；WelcomeScreen 真实化；mojibake 清理 |
| `METADESIGN_FULL_REPORT.md` | MetaDesign 已成真实本地状态系统，**未到自动执行代码** |
| `UI_IMPLEMENTATION_REPORT.md` | Sidebar / CardPanel / LoopHistory / WelcomeScreen / Loop 路由建立 |
| `UI_OPTIMIZATION_REPORT.md` | MetaDesign context 集成、Sidebar 真实数据、CardPanel 交互升级 |
| `EXECUTION_PREFLIGHT_REPORT.md` | /meta-execute 加 preflight；plan/task 状态可观察 |
| `LOOP_RUNNER_SUMMARY.md` | Loop Runner 不是默认主链，分段吸收 |
| `OPTIMIZATION_REPORT.md` | meta-init + plans 目录 + USAGE_GUIDE 完成 |
| `DEVELOPMENT_GUIDE.md` | 后续开发者必读：明确"以代码为准"原则 |

---

## 21. 风格与开发规范（AGENTS.md，MANDATORY）

> 以下规则来自 `Eternity code/docs/AGENTS.md`，是 agent 写代码时**必须遵守**的。

### 通用
- 优先用并行工具调用
- 默认分支是 `dev`，本地 `main` 可能不存在
- 优先自动化执行
- 同一函数内除非可复用/组合，否则不拆函数
- 避免 `try/catch`，优先 `.catch(...)`
- 避免 `any` 类型
- 优先单字命名（`pid` / `cfg` / `err` / `opts` / `dir` / `root` / `child` / `state` / `timeout`）
- 仅用一次的变量直接 inline
- 优先 Bun API（`Bun.file()` 等）
- 优先类型推断
- 优先函数式数组方法（`flatMap` / `filter` / `map`）

### 解构
- 避免不必要解构，用 `obj.a` / `obj.b`

### 变量
- 优先 `const`，避免 `let`
- 用三元/early return 替代重赋值

### 控制流
- 避免 `else`，用 early return

### Schema (Drizzle)
- 字段名 snake_case：`project_id` / `created_at`

### 测试
- 避免 mock
- 不要在 repo 根跑测试（`do-not-run-tests-from-root` 守卫）

### 类型检查
- 在 package 目录跑 `bun typecheck`，**不要**直接跑 `tsc`

### 命名强化（必读）
- 新局部变量/参数/辅助函数默认单字
- 多词命名仅在单字会歧义时使用
- 不要引入可被短单字替代的 camelCase 复合词
- 改完前复盘被改动行，缩短新引入的标识符

---

## 22. Contributing 摘要（来自 OpenCode upstream）

- 需求：Bun 1.3+；`bun install` + `bun dev`
- `bun dev` 是开发版，等价于生产 `opencode` 命令
- TUI 写于 SolidJS + opentui
- 测试需从 package 目录跑，根目录有守卫
- PR 必须引用 issue（Issue First Policy）
- PR 标题 conventional commit：`feat:` / `fix:` / `docs:` / `chore:` / `refactor:` / `test:`
- 大量 AI 生成内容会被忽略；描述必须自己写、简短
- UI 改动需附截图/视频
- 详细调试（`--inspect` 等）见原文

---

## 23. 风险与未实现（速查）

### 已实现（事实）
- `.meta/` 状态系统、design.yaml schema
- `/meta-init`、`/meta`、`/meta-decide`、`/meta-execute`、`/meta-eval`、`/meta-optimize`
- 卡片生成、accept/reject + reject note
- Loop 路由 + WelcomeScreen + Sidebar + CardPanel + LoopHistory
- Dashboard (port 7777) + SSE 命名事件 + bootstrap 聚合
- ContextMixer + context snapshot 落盘
- 真实 session bridge（TUI 路由 session 复用）
- Plan preflight（9 项检查 + touched files）
- SubAgent 调度骨架（Dispatcher + 角色）
- Prompt Optimizer 设计

### 未实现（避免误读）
- 自动改代码 / 自动 branch / 自动 commit / 自动 rollback
- WATCHDOG 异常监控与熔断
- TUNING 五项（Rubric / Sprint Contract / Acceptance / Model Assumptions / Failure Replay）
- `loop-runner` 主链合并
- CardPanel 富 reject-note 流（部分 docs 描述超出当前实现）
- Context snapshot 历史对比
- `html.ts` 模块化拆分

### 风险
- 误把旧设计稿当事实
- 误以为 `/meta-execute` 默认自动改代码
- 误以为 `packages/loop-runner` 是当前 runtime
- 误以为 dashboard 只展示 design state

---

## 24. 推荐下一轮方向（合并自多份计划）

1. **WATCHDOG 落地**：阶段级 + 全局熔断，事件落 `.meta/execution/logs/`
2. **TUNING 5 项**：以 Rubric 四维评分 + Acceptance Checklist 为先
3. **Execution orchestration**：基于 preflight 状态，引入更细的执行编排（仍保守）
4. **Dashboard 深化**：execution task 级展示、evaluation 详情、optimize 对比
5. **Loop Runner 吸收**：分阶段把可复用 schema / phase 抽象搬入主链，**不整包切换**
6. **Context snapshot 历史视图 + 角色维度聚合**
7. **CardPanel 富 reject-note 流 + 决策恢复**
8. **样例 `.meta/` fixture**：无模型也可演示全 loop
9. **清理旧报告**：把 mojibake / 过时描述统一到一份"运行时事实"文档（即本融合版）

---

## 25. 关键事实速查（TL;DR）

| 维度 | 事实 |
|---|---|
| 默认主链 | `opencode-dev/packages/eternity-code/src/meta/*` |
| 关键模块 | `meta/loop.ts`、`meta/execute.ts`、`meta/runtime.ts`、`meta/execution/executor.ts`、`meta/dashboard/server.ts` |
| 主链公式 | `MetaDesign → Card Generation → Decision → Plan/Preflight → Execute → Evaluate → Optimize` |
| 状态文件 | `.meta/{design.yaml, cards/, plans/, loops/, negatives/, context/, execution/}` |
| 命令 | `/meta-init`、`/meta`、`/meta-decide`、`/meta-execute`、`/meta-eval`、`/meta-optimize` |
| 启动 | `start.bat` / `start.sh` / `bun dev .` |
| 端口 | TUI 终端 + Dashboard 7777 |
| Context 预算 | `total * 0.4` 推荐上限，压缩顺序 `longTerm → shortTerm → midTerm` |
| 决策 | accept/reject + reject note，拒卡必填 note |
| 执行 | plan-first，preflight 9 项，**不自动改代码** |
| Bridge | Dashboard `loop/start`、`coverage/assess` 走 TUI session bridge |
| 风格 | Bun API、类型推断、单字命名、避免 else/let/try |
| 测试守卫 | 不要在 repo 根跑测试 |
| 默认分支 | `dev`（`main` 可能不存在） |

---

> 文档融合完成。所有原始 docs 仍保留在 `docs/` 与 `Eternity code/docs/reports/` 下，本文件是其权威索引与压缩视图。
