# Eternity Code 使用指南

## 快速开始

### 1. 启动程序

```bash
# Windows
start.bat

# Linux/Mac
./start.sh
```

### 2. 访问 Dashboard

浏览器打开：http://localhost:7777

---

## 命令列表

### MetaDesign 命令

| 命令 | 功能 | 何时使用 |
|------|------|----------|
| `/meta-init` | 初始化 MetaDesign | 新项目首次使用 |
| `/meta` | 生成决策卡片 | 开始新的 Loop |
| `/meta-decide` | 审查待处理的卡片 | 有 pending 卡片时 |
| `/meta-execute` | 执行已接受的卡片 | 决策完成后 |
| `/meta-eval` | 评估执行结果 | 执行完成后 |
| `/meta-optimize` | 优化搜索策略 | 多次 Loop 后 |

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+P` | 打开命令面板 |
| `Tab` | 切换 agents |
| `/` | 输入命令 |
| `Ctrl+T` | 切换 variants |

---

## 完整工作流

### 新项目初始化

```
1. 启动 Eternity Code
2. 输入 /meta-init
3. 按提示填写项目信息：
   - 项目名称
   - 项目阶段（prototype/mvp/growth/mature）
   - 核心价值
   - 反价值
   - 需求（至少 1 条）
   - 约束（可选）
4. 完成后编辑 .meta/design.yaml 完善细节
```

### 运行 Loop

```
1. 输入 /meta
2. 系统分析代码库并生成卡片
3. 查看卡片，选择接受/拒绝
4. 接受的卡片自动生成执行计划
5. 确认执行计划
6. 系统逐个执行 Task
7. 完成后评估结果
```

### 查看结果

```
Dashboard: http://localhost:7777
├── Loop History — 查看所有 Loop 记录
├── Cards — 查看决策卡片
├── Negatives — 查看被拒绝的方向
└── Execution — 查看执行计划和任务状态
```

---

## 文件结构

```
.meta/
├── design.yaml      # 元设计文件
├── cards/           # 决策卡片
│   ├── CARD-001.yaml
│   └── CARD-002.yaml
├── loops/           # 循环记录
│   ├── loop-001.yaml
│   └── loop-002.yaml
├── negatives/       # 被拒绝的方向
│   ├── NEG-001.yaml
│   └── NEG-002.yaml
└── plans/           # 执行计划（GSD）
    ├── PLAN-001.yaml
    └── PLAN-002.yaml
```

---

## Dashboard 功能

### Sidebar
- Requirements 覆盖度条
- Active Negatives 列表
- Eval Baselines

### Main Area
- Core value / Anti value
- Last Loop 信息

### Tabs
- **Loop History**: 所有 Loop 记录
- **Cards**: 决策卡片（支持过滤）
- **Negatives**: 负空间详情
- **Execution**: 执行计划和任务状态

---

## GSD 执行模式

### Plan（执行计划）

一张被接受的卡片分解为 3-5 个 Task：

```yaml
id: PLAN-001
card_id: CARD-041
interpretation: "这张卡需要修改 prompt 层和 schema 层"
tasks:
  - id: PLAN-001-01
    spec:
      title: "修改 prompt template"
      description: "在 prompt 中添加 reason 字段"
      files_to_modify: ["src/prompt.ts"]
      definition_of_done: "prompt 包含 reason 字段"
      must_not: ["不修改其他文件"]
status: pending
```

### Task（原子任务）

每个 Task：
- 对应一个独立的 git commit
- 有明确的 definition_of_done
- 有 must_not 边界
- 依赖其他 Task

### 执行流程

```
接受卡片
  └─ Planner 分解为 Plan + Tasks
  └─ 展示 Plan 给用户确认
  └─ 按依赖顺序执行 Task
     └─ 每个 Task: fresh context agent
     └─ 每个 Task 完成 → git commit
     └─ 失败 → 询问继续或回滚
  └─ 评估结果
```

---

## 配置

### API 密钥

通过环境变量配置：

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

### Dashboard 端口

默认端口 7777，可通过环境变量修改：

```bash
export ETERNITY_DASHBOARD_PORT=8080
```

---

## 故障排除

### Dashboard 无法访问

1. 检查端口是否被占用
2. 确认 .meta/design.yaml 存在
3. 重启程序

### 命令不可用

1. 确认输入正确（如 `/meta-init` 而不是 `/meta init`）
2. 检查 .meta/design.yaml 是否存在（部分命令需要）
3. 重启 TUI

### 卡片生成失败

1. 检查 API 密钥配置
2. 确认网络连接正常
3. 查看终端错误信息
