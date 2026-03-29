# Eternity Code 迭代蓝图

更新日期：2026-03-28

---

## 版本规划

| 版本 | 主题 | 状态 | 完成日期 |
|------|------|------|----------|
| v0.1.0 | Agent 任务可观测性 | ✅ 已完成 | 2026-03-28 |
| v0.2.0 | Coverage 自动评估 | ✅ 已完成 | 2026-03-28 |
| v0.3.0 | Context 三层架构 | ✅ 已完成 | 2026-03-28 |
| v0.4.0 | 自动执行接入默认流程 | ✅ 已完成 | 2026-03-28 |
| v0.5.0 | Prompt 反馈环 | ✅ 已完成 | 2026-03-28 |

---

## v0.1.0: Agent 任务可观测性

**发布日期**: 2026-03-28

### 新增功能

#### 1. API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/agent-tasks` | GET | 获取 agent 任务列表 |
| `/api/agent-tasks/stats` | GET | 获取 agent 任务统计 |

**查询参数** (`/api/agent-tasks`):
- `limit`: 返回任务数量限制 (默认 50)
- `loop_id`: 按 loop ID 过滤
- `role_id`: 按角色 ID 过滤
- `status`: 按状态过滤 (done/failed/running)

#### 2. Dashboard UI

新增 Agent Tasks 面板，显示：
- 任务统计（总数、完成数、失败数、平均耗时）
- 任务列表（角色、触发来源、状态、耗时、错误信息）
- 输出预览（可展开查看详细输出）

### 技术实现

```
server.ts:
  + /api/agent-tasks 端点 (带过滤和分页)
  + /api/agent-tasks/stats 端点 (统计信息)

html.ts:
  + agentTasksState 变量
  + agentTasksStats 变量
  + renderAgentTasks() 函数
  + refresh() 更新 (获取 agent-tasks 数据)
```

### 验证清单

- [x] API 返回正确的 agent-tasks 数据
- [x] Dashboard 显示任务统计信息
- [x] Dashboard 显示任务列表
- [x] 任务状态颜色正确（绿色=完成，红色=失败）
- [x] 输出预览可展开/折叠
- [x] bun typecheck 通过

---

## v0.3.0: Context 三层架构

**发布日期**: 2026-03-28

### 新增功能

#### 1. Context Mixer 模块 (`meta/context-mixer.ts`)

实现三层 Context 架构：

| 层级 | 描述 | Token 预算 |
|------|------|------------|
| Short-Term | 当前任务 + 必要代码片段 | ≤20% |
| Mid-Term | 压缩状态表示 | ≤20% |
| Long-Term | RAG 检索结果 | ≤10% |
| System | 固定系统提示 | ≤5% |

**核心功能**:
- `estimateTokens()`: 估算文本 token 数量
- `truncateToTokens()`: 截断文本到指定 token 数
- `ContextMixer.mix()`: 混合三层 context

#### 2. 数据结构

```typescript
interface ShortTermContext {
  task: string
  targetFiles: string[]
  recentActions: string[]
  codeSnippets: Array<{file, content, relevance}>
}

interface MidTermMemory {
  currentModule: string
  primaryGoal: string
  completed: string[]
  pending: string[]
  constraints: string[]
}

interface LongTermMemory {
  results: Array<{content, source, relevance}>
}
```

#### 3. Dispatcher 集成

更新 `agents/dispatcher.ts`:
- 新增 `enableContextMixer` 选项
- 在 dispatch 时自动使用三层架构
- 保持向后兼容（可禁用）

### 技术实现

```
新增文件:
  + meta/context-mixer.ts (Context Mixer 模块)

修改文件:
  - agents/dispatcher.ts (集成 Context Mixer)
    + enableContextMixer 选项
    + 使用三层架构构建 context
```

### 验证清单

- [x] ContextMixer 正确构建三层 context
- [x] Token 预算控制正常工作
- [x] Dispatcher 集成成功
- [x] 向后兼容（可禁用 Context Mixer）
- [x] bun typecheck 通过

---

## v0.4.0: 自动执行接入默认流程

**发布日期**: 2026-03-28

### 新增功能

#### 1. Meta Execute 工具增强

新增 `auto-execute` action：
- 自动生成执行计划（如果没有）
- 自动执行所有 preflight-ready 的计划
- 每个 task 完成后自动 commit
- 失败时自动 rollback
- 执行完成后自动运行评估

#### 2. API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/execute/auto` | POST | 一键执行所有 ready 计划 |

#### 3. Dashboard UI

新增 **One-Click Execute** 按钮：
- 确认后自动执行所有 ready 计划
- 实时显示执行进度
- 显示执行结果（成功/失败/commit）
- 显示评估 delta

### 技术实现

```
修改文件:
  - tool/meta-execute.ts
    + auto-execute action
    + 自动计划生成
    + 自动 commit/rollback
    + 自动评估

  - dashboard/server.ts
    + /api/execute/auto 端点

  - dashboard/html.ts
    + autoExecute() 函数
    + One-Click Execute 按钮
```

### 验证清单

- [x] 自动执行功能正常工作
- [x] 自动 commit 正常工作
- [x] 自动 rollback 正常工作
- [x] Dashboard 按钮正常工作
- [x] 执行结果正确显示
- [x] bun typecheck 通过

---

## v0.5.0: Prompt 反馈环

**发布日期**: 2026-03-28

### 新增功能

#### 1. 反馈数据收集

在卡片决策时自动记录反馈信号：
- 卡片 ID
- 接受/拒绝状态
- 时间戳
- 模板 ID

#### 2. API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/feedback/scores` | GET | 获取模板质量分数 |
| `/api/feedback/suggestions` | GET | 获取优化建议 |
| `/api/feedback/needs-optimization` | GET | 获取需要优化的模板 |

#### 3. Dashboard UI

新增 **Prompt Feedback** 面板：
- 模板数量统计
- 平均质量分数
- 需要优化的模板数量
- 模板质量分数列表
- 优化建议

### 技术实现

```
修改文件:
  - dashboard/server.ts
    + /api/feedback/* 端点
    + 在 /api/loop/decide 中记录反馈信号

  - dashboard/html.ts
    + feedbackScores, feedbackSuggestions 变量
    + renderFeedbackStats() 函数
    + Prompt Feedback 面板
```

### 验证清单

- [x] 反馈信号在决策时正确记录
- [x] API 正确返回反馈数据
- [x] Dashboard 显示反馈统计
- [x] 优化建议正确生成
- [x] bun typecheck 通过

---

## 已完成功能汇总

### 核心循环

- [x] 6 阶段循环框架 (Analyze → Generate → Decide → Execute → Evaluate → Optimize)
- [x] LoopOrchestrator 自动切换
- [x] 决策卡片生成和管理

### Sub-agent 调度

- [x] Dispatcher 统一调度
- [x] 6 个内置角色
- [x] 6 个解析器
- [x] Context 按需注入

### 工具系统

- [x] meta_execute 工具 (plan/execute/rollback/status)
- [x] meta_loop 工具 (status/evaluate/optimize/history)

### Dashboard

- [x] 实时状态更新 (SSE)
- [x] 决策卡片 UI
- [x] 执行计划 UI
- [x] 任务状态显示
- [x] Agent Tasks 可观测性

### TUI

- [x] Sidebar 组件
- [x] CardPanel 组件
- [x] TaskStatusPanel 组件
- [x] LoopHistory 组件

---

*文档版本：v0.5.0*
*维护者：Eternity Code*
