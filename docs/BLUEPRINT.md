# Eternity Code 项目蓝图

> 版本: v001
> 创建时间: 2026-03-29
> 创建者: opencode/mimo-v2-pro-free
> 有效期至: 2026-04-30

---

## 当前架构状态

Eternity Code 的核心迭代系统已完成基础架构搭建。

### 已完成

- **主链基本实现**: MetaDesign -> Card Generation -> Decision -> Plan/Preflight -> Execute -> Evaluate -> Optimize
- **Agent 调度层**: dispatcher.ts、registry.ts、context-builder.ts、6个角色已实现
- **Dashboard 基本 API**: 已实现
- **新目录规范 (DIR_SPEC)**: 已完成迁移
  - paths.ts - 统一路径常量
  - context-loader.ts - 上下文加载器
  - cognition.ts - Blueprint 和 Insight 读写
  - logs.ts - 带时间戳的日志写入
- **双速认知系统框架**: 已设计，待实现

### 目录结构

```
.meta/
  design/
    design.yaml                    ← 元设计主文件
    schema/                        ← schema 定义
  cognition/                       ← 外化认知层
    insights/
    blueprints/
      BLUEPRINT-current.yaml       ← 当前蓝图
  execution/                       ← 执行记录层
    cards/
    plans/
    loops/
    logs/
    agent-tasks/
  negatives/                       ← 负空间
```

---

## 优先目标

### P1: 实现双速认知系统的外化认知层

**目标**: 实现 insights、blueprints、logs 的读写机制

**理由**: 外化认知层是整个双速系统的基础

**验收标准**:
- loop 结束后可以自动写入 LOG
- 下一个 loop 的 agent 能读取 insights 和 blueprints
- SOTA 模型可以写入新蓝图

**实现任务**:
1. 创建 `insights.ts` - Insight 读写模块
2. 创建 `blueprints.ts` - Blueprint 读写模块
3. 将 insights 和 blueprints 注入 `buildSystemContext`
4. 在 loop close 阶段自动调用 `writeLoopLog`

### P2: 实现 quality-monitor.ts 质量监测

**目标**: 实现自动评估技术债密度、TODO 数量、回滚率等指标

**理由**: 质量监测是触发 SOTA 模型介入的关键机制

**验收标准**:
- loop 开始时能自动评估质量指标
- 当指标超过阈值时能提示切换到 SOTA 模型
- Dashboard 能展示质量监测结果

**实现任务**:
1. 创建 `quality-monitor.ts`
2. 实现 `assessQuality()` 函数
3. 在 loop 开始时调用质量评估
4. 在 TUI 和 Dashboard 展示结果

### P3: 实现 restructure 模式

**目标**: 实现 SOTA 模型执行全局优化的核心能力

**理由**: restructure 模式是消除技术债和路径依赖的关键

**验收标准**:
- 能通过 `/meta restructure` 命令触发全局诊断
- 能生成 `RESTRUCTURE-NNN.yaml` 重构方案
- 人类可以确认后执行完全重写

**实现任务**:
1. 创建 `restructure-planner` 角色
2. 在 `/meta` 命令里新增 `/meta restructure` 子命令
3. 实现重构方案的生成和展示
4. 在 design.yaml schema 增加 `two_speed_policy` 字段

---

## 约束条件

1. **不修改 design.yaml 的 schema** - 由 SOTA 负责 schema 演化
2. **不修改 dispatcher.ts 的核心调度逻辑**
3. **新功能必须在没有 .meta/ 的项目里静默跳过**
4. **弱模型不能修改 cognition/ 目录下的任何文件**
5. **上下文 Token 控制** - 遵循 Context 管理策略，总 token ≤ 40% max context

---

## 已知技术债

- `command.ts` 里的 readline 交互代码需要抽象成独立模块
- `extractText()` 函数在多个文件里重复定义
- 缺少 yaml 解析失败时的统一错误处理
- `dashboard/server.ts` 中仍有部分硬编码路径（如 reports 目录）
- `session` 参数使用 `any` 类型，需要定义具体类型

---

## 双速系统架构

### 系统一：外化认知层

四层文档结构，信息密度逐层递进：

```
对话（原始，高噪音）
  → insights（提炼，结构化）
    → blueprints（意图，可执行）
      → logs（事实，不可变）
        → 下一轮 agent 的输入
```

### 系统二：双速开发系统

```
触发条件：时间（每周）或质量阈值（技术债密度）
          │
          ▼
    ┌─────────────┐         ┌──────────────────┐
    │  SOTA 模型  │◄────────│   质量监测        │
    │             │         │  （LOG 分析）      │
    │ • 读全量文档 │         └──────────────────┘
    │ • 重写代码  │
    │ • 更新蓝图  │──────────────────────────────┐
    │ • 消除技术债│                              │
    └─────────────┘                              │
                                                 ▼
                                        ┌──────────────┐
    ┌─────────────┐                     │   DOCS 层    │
    │  弱模型     │◄────────────────────│              │
    │             │                     │ • blueprints │
    │ • 读蓝图    │                     │ • insights   │
    │ • 增量迭代  │                     │ • logs       │
    │ • 写日志    │────────────────────►└──────────────┘
    │ • 记录技术债│
    └─────────────┘
```

**关键洞察**: DOCS 层是两个模型的接口。

---

## 质量阈值 (quality_threshold)

```yaml
two_speed_policy:
  weak_model: "opencode/mimo-v2-pro-free"
  sota_model: "codex/gpt-5.4"

  sota_trigger:
    schedule: "weekly"
    quality_thresholds:
      - metric: "tech_debt_density"
        threshold: "> 3 items per loop"
        window: "last 3 loops"
      - metric: "todo_count_in_logs"
        threshold: "> 10"
        window: "last 5 logs"
      - metric: "rollback_rate"
        threshold: "> 30%"
        window: "last 5 loops"
```

---

## 执行顺序

```
Phase 1 (已完成): 目录规范重构
  ✅ paths.ts
  ✅ 新目录结构
  ✅ 文件迁移
  ✅ context-loader.ts
  ✅ cognition.ts
  ✅ logs.ts
  ✅ 硬编码路径替换
  ✅ Dashboard API 更新

Phase 2 (进行中): 双速系统实现
  ⬜ insights/blueprints/logs IO 模块
  ⬜ 注入到 buildSystemContext
  ⬜ loop close 时自动写 LOG
  ⬜ quality-monitor.ts
  ⬜ TUI/Dashboard 展示质量监测
  ⬜ restructure-planner 角色
  ⬜ two_speed_policy 字段
```

---

## Git Tags

```
eternity-v1.0-dir-restructure  ← 已完成
eternity-v1.1-insights-io
eternity-v1.2-context-injection
eternity-v1.3-loop-logs
eternity-v1.4-quality-monitor
eternity-v1.5-restructure-mode
```

---

*蓝图版本: v001*
*下次更新: SOTA 模型介入时*
