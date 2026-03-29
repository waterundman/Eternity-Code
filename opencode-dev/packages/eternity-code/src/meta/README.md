# OpenCode MetaDesign 使用指南

## 概述

MetaDesign 是一个集成到 OpenCode 中的自动化软件工程框架。它通过需求驱动、约束引导、评估闭环的方式，帮助你持续改进代码库。

## 快速开始

### 1. 初始化 MetaDesign 项目

在你的项目根目录创建 `.meta` 目录和 `design.yaml` 文件：

```bash
mkdir -p .meta/{cards,loops,negatives}
```

创建 `.meta/design.yaml`：

```yaml
_schema_version: "1.0.0"
_schema_type: meta_design

project:
  id: "your-project-id"
  name: "your-project-name"
  stage: prototype  # prototype, mvp, growth, mature
  core_value: "你的项目核心价值"
  anti_value: "你的项目反价值（不做什么）"
  tech_stack:
    primary:
      - TypeScript
      - Node.js
    forbidden:
      - path: python
        reason: "保持单一语言栈"
        until: null

requirements:
  - id: REQ-001
    text: "用户能在3步以内完成核心操作"
    priority: p0
    signal:
      type: behavior
      spec: "操作步骤数 ≤ 3"
    coverage: 0.5
    coverage_note: "当前需要5步"
    last_checked: "2025-03-21T00:00:00Z"

constraints:
  immutable_modules:
    - path: src/auth
      reason: "安全模块，任何改动需人工code review"
      until: null
  
  performance_budget:
    - metric: api_latency_p95
      threshold: "< 800ms"
      measurement_spec: "scripts/measure-latency.js"
      hard: true

rejected_directions:
  - id: NEG-001
    text: "引入GraphQL替代REST API"
    reason: "团队对GraphQL不熟悉"
    scope:
      type: permanent
      condition: null
      until_phase: null
    source_card: null
    created_at: "2025-03-21T00:00:00Z"
    status: active
    lifted_at: null
    lifted_note: null

eval_factors:
  - id: EVAL-001
    name: 用户操作完成率
    role:
      type: objective
    measurement:
      type: metric
      spec: "completed / total"
    threshold:
      target: "≥ 85%"
      floor: "≥ 60%"
      baseline: "71%"
    relations:
      weight: 0.4

search_policy:
  mode: balanced
  max_cards_per_loop: 3
  exploration_rate: 0.25
  candidate_sources:
    - source: coverage_gap
      weight: 0.45
    - source: eval_regression
      weight: 0.30
    - source: tech_debt
      weight: 0.15
    - source: free_exploration
      weight: 0.10

loop_history:
  total_loops: 0
  last_loop_id: ""
  last_loop_at: "2025-03-21T00:00:00Z"
  loops: []
```

### 2. 启动 OpenCode

```bash
bun dev .
```

### 3. 使用 /meta 命令

在 OpenCode TUI 中输入：

```
/meta
```

系统会：
1. 分析你的代码库
2. 基于需求和约束生成决策卡片
3. 输出卡片内容

### 4. 卡片格式

模型会生成以下格式的卡片：

```
---CARD START---
objective: 改进目标的一句话描述
approach: 具体的技术实现方案
benefit: 预期收益（尽量量化）
cost: 代价或副作用
risk: 可能出错的地方
confidence: 0.0-1.0
req_refs: REQ-001, REQ-002
warnings: none
---CARD END---
```

### 5. 查看生成的卡片

```bash
ls .meta/cards/
cat .meta/cards/CARD-001.yaml
```

## 核心概念

### 需求 (Requirements)

需求定义了你的项目应该实现什么。每个需求有：
- `id`: 唯一标识符（如 REQ-001）
- `text`: 需求描述
- `priority`: 优先级（p0, p1, p2）
- `coverage`: 当前覆盖度（0.0-1.0）
- `signal`: 验收标准

### 约束 (Constraints)

约束定义了项目不能做什么：
- `immutable_modules`: 不可修改的模块
- `stable_interfaces`: 稳定的 API 接口
- `performance_budget`: 性能预算
- `compliance`: 合规要求

### 被拒绝的方向 (Rejected Directions)

被拒绝的方向记录了人类不想要的改进方向。当卡片被拒绝时，系统会自动创建 NEG。

### 评估因子 (Eval Factors)

评估因子定义了如何衡量改进效果：
- `objective`: 优化目标
- `proxy`: 代理指标
- `guardrail`: 护栏指标（不能退化）
- `diagnostic`: 诊断指标

### 搜索策略 (Search Policy)

搜索策略控制如何生成候选卡片：
- `mode`: conservative, balanced, exploratory
- `max_cards_per_loop`: 每轮最大卡片数
- `candidate_sources`: 候选来源和权重

## 工作流程

### 单轮循环

1. **分析**: 系统分析代码库和需求覆盖度
2. **生成**: 基于搜索策略生成候选卡片
3. **决策**: 人类接受或拒绝卡片
4. **执行**: 实施接受的卡片
5. **评估**: 评估改进效果
6. **关闭**: 更新设计文件

### 连续改进

通过多轮循环，系统会：
- 提高需求覆盖度
- 优化评估因子
- 学习人类偏好（通过 NEG）

## 高级功能

### 1. 自定义评估脚本

创建评估脚本来自动衡量指标：

```javascript
// scripts/measure-latency.js
const start = Date.now()
// ... 执行操作
const latency = Date.now() - start
console.log(`${latency}ms`)
```

### 2. 条件性 NEG

NEG 可以设置条件来自动解锁：

```yaml
rejected_directions:
  - id: NEG-001
    text: "引入GraphQL"
    scope:
      type: conditional
      condition: "monthly_active_users > 1000"
```

### 3. 版本阶段

项目可以处于不同阶段，每个阶段有不同的重点：

- `prototype`: 快速迭代，验证想法
- `mvp`: 核心功能完善
- `growth`: 扩展用户群
- `mature`: 稳定优化

## 最佳实践

### 1. 需求定义

- 使用 SMART 原则
- 明确验收标准
- 设置合理优先级

### 2. 约束设置

- 保护核心模块
- 定义稳定接口
- 设置性能预算

### 3. 卡片评估

- 关注高置信度卡片
- 检查是否接近约束
- 考虑长期影响

### 4. 循环管理

- 每轮专注于 3-5 个改进
- 定期审查 NEG
- 根据历史调整策略

## 故障排除

### 1. /meta 命令不可用

确保：
- `.meta/design.yaml` 存在
- 文件格式正确
- 重启 OpenCode

### 2. 卡片解析失败

检查：
- 卡片格式是否正确
- `---CARD START---` 和 `---CARD END---` 标记
- YAML 语法

### 3. 系统上下文未注入

确认：
- `.meta/design.yaml` 存在
- 文件可读
- 检查控制台警告

## 示例项目

参考 `.meta/design.yaml` 示例来快速开始。

## 相关资源

- [INSTRUCTION.md](../../../INSTRUCTION.md) - 详细实现指南
- [design.schema.yaml](../../../design.schema.yaml) - 设计文件 schema
- [card.schema.yaml](../../../card.schema.yaml) - 卡片 schema
- [loop.schema.yaml](../../../loop.schema.yaml) - 循环记录 schema
