# Claude Code 演示代码分析与 Eternity Code 迭代方案

生成日期：2026-03-31
参考来源：`claudecode演示代码/claude-code-main/`
文档类型：current-state + roadmap

---

## 一、Claude Code 演示代码概述

### 1.1 项目定位

该演示代码是一个 **Python Porting Workspace**，核心目标是将 Claude Code 的 TypeScript 实现逐步移植为 Python 实现。项目采用 Python-first 策略，将原始 TypeScript 代码作为参考而非主跟踪源。

### 1.2 架构特征

```
claude-code-main/
├── src/
│   ├── __init__.py               # 包导出面
│   ├── main.py                   # CLI 入口 (argparse, 3 个子命令)
│   ├── models.py                 # 共享 dataclass (Subsystem, PortingModule, PortingBacklog)
│   ├── port_manifest.py          # 工作区清单生成 (扫描 .py 文件, 统计模块)
│   ├── query_engine.py           # 端口编排摘要层 (聚合 manifest + backlogs)
│   ├── commands.py               # 命令 backlog 元数据
│   └── tools.py                  # 工具 backlog 元数据
├── tests/                        # Python 验证测试
└── assets/omx/                   # OmX 工作流截图
```

### 1.3 核心设计模式

| 模式 | 实现方式 | 价值 |
|------|----------|------|
| **Manifest 清单** | `PortManifest` 跟踪工作区状态 | 清晰的进度可视化和状态管理 |
| **Backlog 管理** | `PortingBacklog` + `PortingModule` | 结构化的任务追踪，带 status 字段 |
| **Dataclass 优先** | 所有数据模型使用 `@dataclass(frozen=True)` | 类型安全、不可变、简洁 |
| **CLI 子命令** | `argparse` + subparsers (summary/manifest/subsystems) | 简单直接的交互方式 |
| **Query Engine 编排** | `QueryEnginePort` 聚合多数据源输出 | 统一的报告输出层 |
| **任务原子化** | `PortingTask(title, detail, completed)` | 可追踪、可回滚 |

---

## 二、Eternity Code 运行逻辑全景

### 2.1 项目定位

Eternity Code 是一个 **MetaDesign 驱动的自主软件工程系统**，运行在 OpenCode 架构之上。核心理念是：

```
人类定义"要什么" → 系统自主决定"怎么做" → 自动执行 → 评估 → 优化
```

### 2.2 仓库分层

```
根目录/
├── docs/                       # 文档、报告、设计稿 (35 个文件)
├── schema/                     # design/card/loop schema 定义
├── examples/                   # 示例 MetaDesign 配置
└── opencode-dev/               # 实际运行工程
    └── packages/eternity-code/ # 核心 MetaDesign 系统
        └── src/
            ├── cli/cmd/tui/    # TUI 界面 (WelcomeScreen, Loop Route, Sidebar, CardPanel)
            ├── session/        # 会话与 prompt 主循环 (llm.ts, prompt.ts)
            ├── meta/           # MetaDesign 核心逻辑
            │   ├── types.ts            # MetaDesign, MetaRequirement, CardDecision 等类型
            │   ├── index.ts            # loadMetaDesign, buildSystemContext
            │   ├── cards.ts            # 卡片读写与决策结果写回
            │   ├── loop.ts             # loop 运行态、决策态、执行态、评估态
            │   ├── execute.ts          # 为 accepted cards 生成 plans + preflight
            │   ├── init.ts             # /meta-init 本地初始化
            │   ├── evaluator.ts        # /meta-eval 评估结果
            │   ├── optimizer.ts        # /meta-optimize 搜索策略优化
            │   ├── runtime.ts          # 统一 runtime 快照 (Dashboard/Tool 共享)
            │   ├── command.ts          # /meta* 命令分发
            │   ├── paths.ts            # MetaPaths 路径常量
            │   ├── context-loader.ts   # 上下文加载器
            │   ├── cognition.ts        # Blueprint + Insight 读写
            │   ├── agents/             # Sub-Agent 调度层
            │   │   ├── dispatcher.ts   # 调度器核心
            │   │   ├── registry.ts     # 角色注册表
            │   │   ├── context-builder.ts # 按 context_needs 组装
            │   │   ├── roles/          # 10+ 角色定义
            │   │   └── parsers/        # 输出解析器
            │   ├── watchdog/           # 异常监控与熔断
            │   ├── execution/          # 执行层
            │   │   ├── executor.ts     # 统一执行器
            │   │   ├── types.ts        # execution plan/task/preflight 类型
            │   │   └── git.ts          # Git 命令模块
            │   ├── dashboard/          # Web Dashboard (server.ts + html.ts)
            │   └── utils/              # 工具模块 (file-io, validation, errors, etc.)
            └── tool/                   # 工具系统 (bash/read/edit/write/task 等)
```

### 2.3 `.meta/` 文件系统规范

```
.meta/
├── design/                     # 产品约束层 (人类 + SOTA 写, 每次 loop 全量读)
│   ├── design.yaml             # 元设计主文件
│   └── schema/                 # schema 定义 (只读)
├── cognition/                  # 外化认知层 (SOTA 写, 弱模型只读)
│   ├── insights/               # 设计洞察 (INS-*.yaml)
│   └── blueprints/             # 执行蓝图 (BLUEPRINT-current.yaml + 历史存档)
├── negatives/                  # 负空间 (独立分立, loop 全量扫描)
│   └── NEG-*.yaml              # 被拒绝的方向
└── execution/                  # 执行记录层 (弱模型写, 每次 loop 按需读)
    ├── cards/                  # CARD-*.yaml 决策卡片
    ├── plans/                  # PLAN-*.yaml 执行计划
    ├── loops/                  # loop-*.yaml 循环记录
    ├── logs/                   # LOG-YYYYMMDD-loopNNN.md 执行日志
    ├── agent-tasks/            # task-uuid.yaml sub-agent 调用记录
    └── anomalies/              # ANOMALY-YYYYMMDD.yaml Watchdog 异常日志
```

**分立逻辑**：

| 目录 | 职责 | 谁写 | 读取频率 |
|------|------|------|----------|
| design/ | 产品约束 | 人类 + SOTA | 每次 loop 全量 |
| cognition/ | 设计思考 | SOTA | 每次 loop 按需 |
| negatives/ | 被排除方向 | 弱模型 | 每次 loop 全量 |
| execution/ | 执行事实 | 弱模型 | 每次 loop 最近 N 条 |

### 2.4 8 阶段 Loop 状态机

```
① analyze  →  ② generate  →  ③ decide  →  ④ plan
                                                ↓
⑧ close    ←  ⑦ evaluate  ←  ⑥ execute ←  ⑤ contract
```

| 阶段 | 描述 | 对应命令 |
|------|------|----------|
| **analyze** | 分析代码状态，识别改进机会 | `/meta` 触发 |
| **generate** | 生成决策卡片 (3-5 张) | `/meta` |
| **decide** | 人类审查并接受/拒绝卡片 | TUI CardPanel |
| **plan** | 将接受的卡片分解为 3-5 个 Task | `/meta-execute` |
| **contract** | 协商 Sprint Contract (可验证的完成标准) | 自动 |
| **execute** | 按依赖顺序执行 Task，每个 Task 独立 git commit | 自动 |
| **evaluate** | 用真实工具测量评估因子 | `/meta-eval` |
| **close** | 更新覆盖率，写日志，触发优化 | `/meta-optimize` |

### 2.5 上下文加载策略

loop 开始时按固定顺序加载，总 token ≤ 40% max context：

```
1. design/        → 全量 (小文件, 核心约束)
2. negatives/     → 全量 (过滤候选卡片用)
3. cognition/blueprints/ → 只读 BLUEPRINT-current.yaml
4. cognition/insights/   → 只读 adopted 状态的洞察
5. execution/logs/       → 只读最近 3 条 (固定数量, 不增长)
```

三层 Context 架构：
- **Short-Term** (≤20%)：当前任务 + 必要代码片段
- **Mid-Term** (≤20-30%)：压缩状态表示 (防漂移)
- **Long-Term** (≤10%)：RAG 检索结果 (Top-K ≤ 5)

### 2.6 双速认知系统

**系统一：外化认知层**
```
对话（原始，高噪音）→ insights（提炼）→ blueprints（意图）→ logs（事实）→ 下一轮输入
```

**系统二：双速开发**

| 模型 | 角色 | 频率 | 职责 |
|------|------|------|------|
| **弱模型** (opencode/mimo-v2-pro-free) | 日常迭代 | 高频 | 执行蓝图、增量修改、写日志 |
| **SOTA 模型** (codex/gpt-5.4) | 低频重构 | 每周/质量触发 | 完全重写、更新蓝图、消除技术债 |

SOTA 触发条件：
- 时间触发：weekly
- 质量触发：tech_debt_density > 3, todo_count > 10, rollback_rate > 30%

### 2.7 Sub-Agent 调度层

所有 sub-agent 调用通过 **Dispatcher** 统一入口：

| Agent 角色 | 职责 | Context 需求 |
|------------|------|-------------|
| **card-reviewer** | 四维 Rubric 评分 (req_alignment, neg_conflict, cost_honesty, feasibility) | core_value, requirements, constraints, negatives, eval_factors |
| **coverage-assessor** | REQ 覆盖度评估 | requirements, constraints |
| **planner** | Card → Plan 分解 (3-5 tasks) | 按需 |
| **task-executor** | 单 Task 执行 (fresh context) | 按需 |
| **eval-scorer** | 真实 bash 工具测量 | eval_factors |
| **contract-drafter** | 将 task spec 转化为可验证标准 | constraints |
| **contract-validator** | 验证完成标准是否客观可验证 | none |
| **prediction-auditor** | 对比预测与实际执行结果 | eval_factors, loop_history |
| **insight-writer** | 提取设计洞察 | 按需 |
| **restructure-planner** | 全局代码质量诊断 (SOTA) | core_value, requirements, constraints, negatives, eval_factors |

### 2.8 Watchdog 异常监控系统

包裹所有 agent 调用，检测 8 类异常：

| 异常类型 | 表现 | 处理策略 |
|----------|------|----------|
| infinite_loop | 工具调用次数 > 30 | 强制中断 |
| token_overflow | context_length_exceeded | 截断上下文，降级重试 |
| network_error | fetch 超时/连接拒绝 | 指数退避重试 (3次) |
| hallucination_loop | 同工具+同参数重复 ≥ 3 | 检测后中断 |
| empty_response | 模型输出空字符串 | 标记异常，跳过 |
| rate_limit | API 429 | 等待 retry-after (最多 60s) |
| timeout | 单次调用超时 (120s) | AbortController 中断 |
| circuit_open | 熔断器打开 | 跳过调用 |

熔断器状态机：`closed →(失败 N 次)→ open →(超时)→ half-open →(成功)→ closed`

### 2.9 当前实现状态总览

| 能力 | 状态 | 说明 |
|------|------|------|
| MetaDesign 核心层 | ✅ 已落地 | design.yaml 读取 + system context 注入 |
| 6 命令系统 | ✅ 已落地 | /meta-init, /meta, /meta-decide, /meta-execute, /meta-eval, /meta-optimize |
| TUI 界面 | ✅ 已落地 | WelcomeScreen, Loop Route, Sidebar, CardPanel |
| Sub-Agent 调度层 | ✅ 已落地 | Dispatcher + Registry + Context Builder + 10 角色 |
| Watchdog 系统 | ✅ 已落地 | 异常检测 + 熔断器 + Dispatcher 集成 |
| Dashboard | ✅ 已落地 | 8 API 端点 + 单页前端 (SSE 实时更新) |
| 目录规范 | ✅ 已落地 | paths.ts, context-loader.ts, cognition.ts, logs.ts |
| Context Mixer | ✅ 已落地 | 三层架构 + token 预算控制 |
| Prompt Feedback | ✅ 已落地 | 模板质量评分 + 优化建议 |
| Sprint Contract | ⚠️ 设计中 | TUNING.md 已定义，未接入主链 |
| Acceptance Checklist | ⚠️ 设计中 | TUNING.md 已定义，未接入主链 |
| Restructure 模式 | ⚠️ 设计中 | TWO_SPEED_SYSTEM.md 已定义，未实现 |
| Quality Monitor | ⚠️ 设计中 | BLUEPRINT.md 列为 P1，未实现 |
| 自动执行闭环 | ⚠️ 部分落地 | preflight 已落地，自动 commit/rollback 未接入默认主链 |

### 2.10 当前主要问题

1. **执行链路未完全收敛**：`execute.ts`、`executor.ts`、`runner.ts` 职责边界不够清晰
2. **主链与实验链混用**：`packages/loop-runner` 与主运行时并存
3. **统一状态源不足**：TUI、Dashboard、Tool 各自拼装状态，`runtime.ts` 已创建但未完全统一
4. **Sprint Contract 未接入**：Task 执行前缺少可验证的完成标准协商
5. **Acceptance Checklist 未实现**：覆盖度仍是主观估算，非客观计算
6. **Restructure 模式未实现**：SOTA 全局重构能力缺失
7. **文档叙事不一致**：部分文档描述目标态，部分描述当前态

---

## 三、关键可借鉴点分析

### 3.1 Manifest 清单模式 → 可增强 RuntimeManifest

Claude Code 演示代码的 `PortManifest`：
```python
@dataclass(frozen=True)
class PortManifest:
    src_root: Path
    total_python_files: int
    top_level_modules: tuple[Subsystem, ...]
```

**对 Eternity Code 的启示**：
- 当前 `runtime.ts` 已提供统一 runtime 快照，但缺乏类似 Manifest 的结构化进度视图
- 可增强 `RuntimeManifest` 概念，增加：
  - 当前 loop 阶段可视化 (8 phases 中的位置)
  - 活跃 Agent 状态汇总
  - 执行进度百分比
  - 技术债密度指标

### 3.2 Backlog 管理模式 → 可增强 Card 聚合

Claude Code 演示代码的 `PortingBacklog`：
```python
@dataclass
class PortingBacklog:
    title: str
    modules: list[PortingModule]
    def summary_lines(self) -> list[str]: ...
```

**对 Eternity Code 的启示**：
- 当前 Card 系统已有 status 字段，但缺乏结构化的 backlog 聚合视图
- 可增强 Dashboard 的 Cards tab，提供按状态/优先级/REQ 关联的结构化聚合
- 可借鉴 `summary_lines()` 模式，为 TUI 提供标准化的卡片摘要输出

### 3.3 Query Engine 编排层 → 可统一数据查询

Claude Code 演示代码的 `QueryEnginePort`：
```python
@dataclass
class QueryEnginePort:
    manifest: PortManifest
    def render_summary(self) -> str:
        command_backlog = build_command_backlog()
        tool_backlog = build_tool_backlog()
        # 统一编排多个数据源
```

**对 Eternity Code 的启示**：
- 当前 Dashboard API 各自独立读取文件，缺乏统一的查询编排层
- 可引入 `QueryEngine` 概念，作为 TUI/Dashboard/CLI 的统一数据查询入口
- 编排 manifest + backlog + loop 状态 + agent-tasks + anomalies 等多数据源

### 3.4 CLI 子命令模式 → 可增强命令参数控制

Claude Code 演示代码的 CLI：
```python
subparsers.add_parser('subsystems')
list_parser.add_argument('--limit', type=int, default=16)
```

**对 Eternity Code 的启示**：
- 当前 `/meta*` 命令系统已完善，但缺乏参数控制
- 可为 `/meta cards --limit 5`、`/meta loops --status completed` 等增加参数过滤

---

## 四、Eternity Code 迭代方案

基于对 Claude Code 演示代码的分析，结合 Eternity Code 现有架构和全部 35 个文档的理解，制定以下迭代方案。

### 迭代主题

> 从"功能并行试验期"进入"主链收敛工程期"

### Phase 0：主链收敛与清单系统（1 周）

**目标**：明确唯一主运行时，引入 Manifest 概念统一状态跟踪。

#### 0.1 定义权威主链

```
行动：
- 以 packages/eternity-code 为唯一主链
- packages/loop-runner 标记为 experimental
- 在 CURRENT_ARCHITECTURE.md 中明确标注每个模块的归属
- 所有文档显式标注 current-state / roadmap / experimental
```

#### 0.2 增强 RuntimeManifest

```
位置：packages/eternity-code/src/meta/runtime.ts

新增能力：
- 当前 loop 阶段可视化 (8 phases 中的位置)
- 活跃 Agent 状态汇总 (从 agent-tasks/ 聚合)
- 执行进度百分比 (从 plans/tasks 状态计算)
- 技术债密度指标 (从 logs/ 中的 tech_debt 字段计算)
- Watchdog 健康状态 (从 anomalies/ 聚合)

参考：claude-code-main/src/port_manifest.py 的清单模式
```

#### 0.3 引入 QueryEngine 编排层

```
位置：packages/eternity-code/src/meta/query-engine.ts

职责：
- 统一 TUI/Dashboard/CLI 的数据查询
- 编排 runtime manifest + card backlog + loop history + agent-tasks + anomalies
- 提供标准化的 summary 输出 (Markdown/JSON)

参考：claude-code-main/src/query_engine.py
```

#### 0.4 统一 Backlog 视图

```
位置：packages/eternity-code/src/meta/backlog.ts

职责：
- 聚合 pending/accepted/rejected cards
- 按 REQ 关联度排序
- 按 reviewer weighted_score 排序
- 提供结构化 backlog 输出

参考：claude-code-main/src/models.py (PortingBacklog)
```

**交付标准**：
- `RuntimeManifest` 类实现并可读写
- QueryEngine 可提供统一的 summary 输出
- TUI 和 Dashboard 开始使用 QueryEngine 作为数据源
- 文档标注完成 (current-state / roadmap / experimental)

---

### Phase 1：执行链路可靠性增强（2 周）

**目标**：让 loop 真正具备"可预览、可确认、可执行、可回滚、可追踪"的工程化能力。

#### 1.1 统一执行编排器

```
行动：
- 明确 execute.ts 负责计划生成与 preflight
- 明确 execution/executor.ts 负责实际执行
- 合并 ExecutionPreflightSummary 与 PlanPreflight 为统一模型
- 消除 execute.ts 与 executor.ts 之间的类型重复

参考：OPTIMIZATION_BLUEPRINT.md 的类型统一方案
```

#### 1.2 增强 Preflight 检查

```
新增检查项：
- 分支状态检查 (是否基于最新 base)
- Workspace 脏状态策略 (允许/拒绝/警告)
- 多任务文件冲突检查 (已有，增强)
- 依赖顺序约束检查 (已有，增强)
- Token budget 预估 (≤40% max context)
```

#### 1.3 Git 安全策略优化

```
改进点：
- 默认分支动态探测 (不写死 main/master)
- 执行前快照 (.meta/execution/snapshots/)
- 执行后变更摘要
- 可审计的回滚记录
- 回滚率纳入 quality_threshold 监测

参考：STABILITY_OPTIMIZATION.md 的 Git 错误处理方案
```

#### 1.4 接入 Sprint Contract 机制

```
位置：execution/executor.ts

行动：
- 在每个 Task 执行前插入 negotiateContract 阶段
- 调用 contract-drafter 角色草拟可验证的完成标准
- 调用 contract-validator 角色确认标准是否客观可验证
- 用协商后的标准替代原始 definition_of_done

参考：TUNING.md 调优二
```

**交付标准**：
- 一条标准 loop 可以从卡片接受一直跑到执行与评估闭环
- 失败任务具备明确可见的错误上下文和回滚记录
- 执行过程不依赖临时 mock 路径
- 每个 Task 执行前都有可验证的完成标准

---

### Phase 2：状态模型与交互层统一（2 周）

**目标**：让 TUI、Dashboard、Tool 使用同一份 loop/runtime 状态。

#### 2.1 统一 Runtime Schema

```
位置：packages/eternity-code/src/meta/runtime.ts

统一定义：
- Loop 状态机 (8 phases)
- Card 生命周期 (pending → accepted/rejected → executed → evaluated)
- Task 执行状态 (pending → running → completed/failed → committed)
- Agent 调度状态 (从 agent-tasks/ 聚合)
- Evaluation 结果 (composite delta, rollback 记录)
- Watchdog 状态 (circuit breakers, recent anomalies)
```

#### 2.2 Dashboard 数据接口收敛

```
改进点：
- Dashboard API 统一走 /api/runtime (而非各自读取文件)
- 去除 mock/stub 路径
- 全部改为 QueryEngine 驱动
- 统一 SSE 实时更新机制
- 拆分大体量单文件 HTML/JS 为更清晰的模块结构
```

#### 2.3 TUI 实时状态增强

```
新增能力：
- Task 执行状态实时更新 (pending→running→completed/failed)
- 代码 diff 预览
- 失败 Task 错误信息展示
- 手动确认/跳过 Task 控制
- Watchdog 异常通知条
```

**交付标准**：
- Dashboard、TUI、CLI 看到同一份运行时状态
- 相同操作在不同入口表现一致
- 实时更新延迟 < 1s
- Dashboard 不再依赖硬编码逻辑

---

### Phase 3：评估与优化闭环（2 周）

**目标**：让评估基于真实测量，优化策略基于数据驱动。

#### 3.1 Eval-Scorer 真实工具调用

```
行动：
- 修改 eval-scorer 角色，增加 tools: ["bash", "read"]
- 真实运行 measurement_spec 中定义的命令
- 评估基于真实测量结果而非代码推断
- 测量值与手动测量偏差 < 5%

参考：TUNING.md 调优三
```

#### 3.2 Acceptance Checklist 机制

```
行动：
- 在 design.yaml 的每条 requirement 下增加 acceptance_checklist
- 实现 computeCoverage 函数 (coverage = pass 数量 / 总数量)
- 在 ANALYZE 阶段自动运行每个 verify 命令更新 status
- 同一代码库不同 loop 的 coverage 估算一致

参考：TUNING.md 调优四
```

#### 3.3 Search Policy 自适应优化

```
行动：
- 分析历史 loop 的成功率
- 自动调整 exploration_rate
- 根据 coverage_gap 动态调整 candidate_sources 权重
- 支持多维度优化目标
```

#### 3.4 Negative Space 智能管理

```
行动：
- 检测 conditional 类型 negative 的解锁条件
- phase 类型 negative 在 stage 变更时自动解锁
- 提供 negative 解锁建议
- 记录解锁历史
```

**交付标准**：
- EVAL 测量偏差 < 5%
- Coverage 数值稳定性提升 (同一代码库不同 loop 偏差 < 0.1)
- Search Policy 优化后成功率提升 ≥ 15%
- Negative 自动解锁准确率 = 100%

---

### Phase 4：双速系统完善（2 周）

**目标**：实现 SOTA 介入的完整闭环。

#### 4.1 Quality Monitor

```
位置：packages/eternity-code/src/meta/quality-monitor.ts

行动：
- 实现 assessQuality() 函数
- 监测 tech_debt_density, todo_count, rollback_rate, coverage_regression
- 当指标超过阈值时提示切换到 SOTA 模型
- Dashboard 和 TUI 展示质量监测结果

参考：TWO_SPEED_SYSTEM.md, BLUEPRINT.md P2
```

#### 4.2 Restructure 模式

```
行动：
- 在 /meta 命令里新增子命令 /meta restructure
- 调用 restructure-planner sub-agent 做全局诊断
- 生成 RESTRUCTURE-NNN.yaml 重构方案
- 人类确认后执行完全重写
- 重写后更新 blueprints + insights

参考：TWO_SPEED_SYSTEM.md 任务五
```

#### 4.3 Model Assumptions 记录

```
行动：
- 在 Blueprint 中增加 model_assumptions 字段
- 记录 harness 组件背后的模型假设
- SOTA 介入时先运行所有 test_command
- invalidated 的假设对应的 harness 组件可简化或移除

参考：TUNING.md 调优五
```

#### 4.4 Insights/Blueprints/Logs IO 完善

```
行动：
- 完善 insights.ts 读写模块
- 完善 blueprints.ts 读写模块
- 在 loop close 阶段自动写 LOG
- 将 insights 和 blueprints 注入 buildSystemContext

参考：TWO_SPEED_SYSTEM.md 任务一~三, BLUEPRINT.md P1
```

**交付标准**：
- 能通过 `/meta restructure` 触发全局诊断
- 质量监测在 loop 开始时自动评估
- loop 结束后自动写入 LOG
- 下一个 loop 的 agent 能读取 insights 和 blueprints

---

### Phase 5：Prompt 优化与反馈环（1 周）

**目标**：建立三层 prompt 优化架构，形成可持续迭代的反馈环。

#### 5.1 Card-Reviewer Rubric 评分

```
行动：
- 修改 card-reviewer 角色为四维独立评分
- 四个维度：req_alignment (0.35), neg_conflict (0.30), cost_honesty (0.20), feasibility (0.15)
- 修改 card-review 解析器支持新格式
- TUI 展示双评分 (提案方 confidence + reviewer weighted_score)

参考：TUNING.md 调优一, SUBAGENT_DISPATCH.md
```

#### 5.2 Prompt 优化 Pass

```
行动：
- 实现指令密度检查 (token / 核心意图)
- 实现冲突检测 (关键词对匹配)
- 实现冗余约束检测 (语义相似度)
- 实现留白检查 (over-specify 字段)

参考：prompt_optimization_guide.md
```

#### 5.3 反馈环

```
行动：
- 卡片评分 → 聚合为 prompt 模板评分
- 使用 N 次以上均值 (N ≥ 5)
- 区分噪音类型：内容/结构/Prompt 质量
- 更新元层对"好 prompt"的判断

参考：prompt_optimization_guide.md 反馈环设计
```

**交付标准**：
- card-reviewer 输出四维独立评分
- 指令密度在甜点区间
- 无冲突约束
- 反馈环 N ≥ 5 次均值可用

---

## 五、与现有迭代计划的融合

### 5.1 与 ITERATION_GUIDANCE.md 的关系

| 原计划 Phase | 本方案对应 | 融合策略 |
|--------------|------------|----------|
| Phase 1: 核心闭环巩固 | Phase 0 + Phase 1 | 引入 Manifest 概念增强核心闭环 |
| Phase 2: Sub-agent 调度层 | 已完成 | 保持现状，增加 QueryEngine 集成 |
| Phase 3: UI/Dashboard 完善 | Phase 2 | 增加统一数据源要求 |
| Phase 4: Prompt 优化系统 | Phase 5 | 合并到评估与优化闭环中 |

### 5.2 与 ITERATION_OPTIMIZATION_PLAN.md 的关系

本方案是对 `ITERATION_OPTIMIZATION_PLAN.md` 的具体实施细化，增加了：
- Manifest 清单系统 (来自 Claude Code 演示代码)
- QueryEngine 编排层 (来自 Claude Code 演示代码)
- Sprint Contract 接入 (来自 TUNING.md)
- Acceptance Checklist (来自 TUNING.md)
- Restructure 模式 (来自 TWO_SPEED_SYSTEM.md)

### 5.3 与 NEW_ITERATION_PLAN.md 的关系

本方案吸收了 `NEW_ITERATION_PLAN.md` 中的 WATCHDOG + TUNING 集成计划，
并将 6 个 Phase 重新组织为更合理的 5 个 Phase。

---

## 六、实施检查清单

### Phase 0 验收

```
□ RuntimeManifest 增强完成 (loop phase, agent status, tech debt)
□ QueryEngine 可提供统一 summary
□ Backlog 聚合功能可用
□ TUI/Dashboard 开始使用 QueryEngine
□ 文档标注完成 (current-state / roadmap / experimental)
```

### Phase 1 验收

```
□ 统一执行编排器完成 (execute.ts + executor.ts 职责清晰)
□ 类型重复消除 (ExecutionPreflightSummary vs PlanPreflight)
□ Preflight 检查覆盖关键路径
□ Git 操作具备审计和回滚能力
□ Sprint Contract 接入 Task 执行前
□ bun typecheck 无错误
```

### Phase 2 验收

```
□ Dashboard/TUI/CLI 状态一致 (同一份 runtime 快照)
□ 实时更新延迟 < 1s
□ Dashboard 无 mock/stub 路径
□ TUI 支持 Task 确认/跳过/执行
□ Watchdog 异常通知条可用
```

### Phase 3 验收

```
□ Eval-Scorer 真实运行 measurement_spec 命令
□ Acceptance Checklist 自动计算 coverage
□ Search Policy 自适应优化可用
□ Negative 智能解锁可用
□ EVAL 测量偏差 < 5%
```

### Phase 4 验收

```
□ Quality Monitor 在 loop 开始时自动评估
□ /meta restructure 可触发全局诊断
□ RESTRUCTURE-NNN.yaml 生成和展示
□ loop close 阶段自动写 LOG
□ insights/blueprints 注入 buildSystemContext
```

### Phase 5 验收

```
□ card-reviewer 四维 Rubric 评分可用
□ TUI 展示双评分对比
□ Prompt 优化 Pass 可用
□ 反馈环 N ≥ 5 次均值可用
```

---

## 七、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Manifest 系统引入额外复杂度 | 中 | 保持最小实现，逐步增强 |
| QueryEngine 成为性能瓶颈 | 低 | 添加缓存层，按需查询 |
| Sprint Contract 过度约束 | 中 | validator 可修正过于严格的标准 |
| Dashboard 重构引入回归 | 中 | 保留现有接口，逐步替换 |
| 范围蔓延 (5 个 Phase 过多) | 高 | 严格按 Phase 执行，每 Phase 有明确交付物 |
| 现有代码兼容性 | 高 | 每步完成后运行 bun typecheck，每步独立可回滚 |

---

## 八、关键约束

1. **不破坏现有功能**：对没有 `.meta/` 的项目，所有改动完全透明
2. **优先使用已有依赖**：不引入新 npm 包 (js-yaml 已在项目)
3. **新文件放 meta/**：所有新增模块放在 `packages/eternity-code/src/meta/`
4. **严格 TypeScript 类型**：不使用 `any`
5. **上下文 Token 控制**：遵循 Context 管理策略，总 token ≤ 40% max context
6. **弱模型不修改 cognition/**：蓝图和洞察由 SOTA 负责
7. **不修改 dispatcher.ts 核心调度逻辑**：由 SOTA 负责调度层演化

---

## 九、下一步行动

**立即执行（本周）**：
1. 增强 `RuntimeManifest` (增加 loop phase, agent status, tech debt 指标)
2. 创建 `QueryEngine` 基础框架
3. 完成文档标注 (current-state / roadmap / experimental)

**短期目标（下周）**：
1. 实现 Backlog 聚合功能
2. 统一执行编排器 (execute.ts + executor.ts 职责清晰)
3. 类型重复消除

**中期目标（两周内）**：
1. Sprint Contract 接入 Task 执行
2. Dashboard 数据接口收敛
3. TUI 实时状态增强

**长期目标（一个月内）**：
1. Acceptance Checklist 机制
2. Restructure 模式
3. Prompt 优化反馈环

---

*文档版本：2026-03-31*
*参考：claudecode演示代码/claude-code-main/*
*维护者：opencode iteration planning*
