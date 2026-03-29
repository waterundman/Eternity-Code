# OpenCode Loop Runner

自动化coding agent循环系统，基于Meta-Design架构。

## 概述

Loop Runner是一个6阶段的自动化循环系统，用于持续改进代码库：

1. **ANALYZE** - 分析代码库和需求覆盖度
2. **GENERATE** - 生成改进方案（决策卡片）
3. **DECIDE** - 人工决策（TUI界面）
4. **EXECUTE** - 执行代码修改
5. **EVALUATE** - 评估改进结果
6. **CLOSE** - 关闭循环并更新设计

## 安装

```bash
cd packages/loop-runner
bun install
```

## 快速开始

### 1. 初始化项目

```bash
meta init --project-name "my-project" \
  --stage prototype \
  --core-value "帮助用户完成X" \
  --anti-value "不做Y"
```

这会创建 `.meta/` 目录结构：

```
.meta/
├── design.yaml      # 设计文件（需求、约束、评估因子）
├── cards/           # 决策卡片
├── loops/           # 循环记录
└── negatives/       # 被拒绝的方向
```

### 2. 编辑设计文件

编辑 `.meta/design.yaml`，添加：

- **requirements**: 需求列表
- **constraints**: 约束条件（不可变模块、稳定接口、性能预算）
- **eval_factors**: 评估因子
- **search_policy**: 搜索策略

示例：

```yaml
requirements:
  - id: REQ-001
    text: "用户能在3步以内完成核心操作"
    priority: p0
    signal:
      type: behavior
      spec: "操作步骤数 ≤ 3"
    coverage: 0.5
    coverage_note: "当前需要5步"
    last_checked: "2025-03-20T10:00:00Z"

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
```

### 3. 运行循环

```bash
# 运行完整循环
meta loop

# 只运行分析和生成（不执行）
meta loop --dry-run

# 从特定阶段开始
meta loop --from=decide

# 恢复中断的循环
meta loop --resume
```

### 4. 查看状态

```bash
# 查看项目状态
meta status

# 查看循环历史
meta history

# 查看特定卡片
meta card show CARD-001

# 列出被拒绝的方向
meta neg list
```

## 配置

### 环境变量

```bash
# LLM配置
META_LLM_PROVIDER=anthropic  # anthropic, glm, openai
META_LLM_API_KEY=sk-xxx
META_LLM_MODEL=claude-3-sonnet-20240229
META_LLM_BASE_URL=https://api.anthropic.com

# Git配置
META_GIT_DEFAULT_BRANCH=main
META_GIT_BRANCH_PREFIX=meta/

# TUI配置
META_TUI_ENABLED=true
META_TUI_THEME=dark
```

### 配置文件

创建 `metadesign.config.js`：

```javascript
export default {
  llm: {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-3-sonnet-20240229'
  },
  git: {
    defaultBranch: 'main',
    branchPrefix: 'meta/'
  },
  tui: {
    enabled: true,
    theme: 'dark'
  }
}
```

## 架构

### 阶段流程

```
┌─────────────────────────────────────────────────────────┐
│ ANALYZE                                                 │
│  • 读取design.yaml                                      │
│  • 分析代码库                                            │
│  • 评估需求覆盖度                                        │
│  • 检查约束条件                                          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ GENERATE                                                │
│  • 生成候选方案                                          │
│  • 过滤负面方向                                          │
│  • 检查约束接近度                                        │
│  • 排序和选择                                            │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ DECIDE (TUI)                                            │
│  • 显示决策卡片                                          │
│  • 人工选择接受/拒绝                                     │
│  • 生成负面方向                                          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ EXECUTE                                                 │
│  • 创建Git分支                                           │
│  • 实施代码修改                                          │
│  • 运行linter/type-check                                │
│  • 检查性能预算                                          │
│  • 提交更改                                              │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ EVALUATE                                                │
│  • 运行评估指标                                          │
│  • 计算综合分数                                          │
│  • 检测冲突                                              │
│  • 决定是否回滚                                          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ CLOSE                                                   │
│  • 更新design.yaml                                      │
│  • 生成循环摘要                                          │
│  • 生成下一轮提示                                        │
└─────────────────────────────────────────────────────────┘
```

### 文件结构

```
packages/loop-runner/
├── src/
│   ├── cli.ts              # CLI入口
│   ├── loop-runner.ts      # 主循环类
│   ├── types.ts            # 类型定义
│   ├── schema/
│   │   └── index.ts        # Zod schema定义
│   ├── phases/
│   │   ├── base.ts         # Phase基类
│   │   ├── analyze.ts      # Phase 1: 分析
│   │   ├── generate.ts     # Phase 2: 生成
│   │   ├── decide.ts       # Phase 3: 决策
│   │   ├── execute.ts      # Phase 4: 执行
│   │   ├── evaluate.ts     # Phase 5: 评估
│   │   └── close.ts        # Phase 6: 关闭
│   ├── llm/
│   │   └── index.ts        # LLM客户端
│   ├── git/
│   │   └── index.ts        # Git操作
│   ├── tui/
│   │   └── index.tsx        # TUI组件
│   └── utils/
│       └── index.ts        # 工具函数
└── package.json
```

## 与OpenCode集成

Loop Runner可以与OpenCode的现有工具系统集成：

### 使用OpenCode工具

```typescript
import { createOpencodeClient } from '@opencode-ai/sdk'

const client = createOpencodeClient({
  baseUrl: 'http://localhost:4096'
})

// 使用OpenCode的工具执行代码修改
await client.session.callTool({
  sessionID: 'xxx',
  tool: 'edit',
  args: {
    file: 'src/example.ts',
    oldText: 'old code',
    newText: 'new code'
  }
})
```

### 使用OpenCode插件

```typescript
import { Plugin } from '@opencode-ai/plugin'

export const loopRunnerPlugin: Plugin = async (input) => {
  return {
    tool: {
      metaLoop: {
        description: 'Run a meta-design loop',
        parameters: z.object({
          dryRun: z.boolean().optional()
        }),
        execute: async (args, ctx) => {
          const runner = new LoopRunner(config, { dryRun: args.dryRun })
          await runner.run()
          return { title: 'Loop complete', metadata: {}, output: 'Loop completed' }
        }
      }
    }
  }
}
```

## 最佳实践

### 1. 需求定义

- 使用SMART原则定义需求
- 明确定义验收标准（signal）
- 设置合理的优先级

### 2. 约束设置

- 保护核心模块（immutable_modules）
- 定义稳定的API接口（stable_interfaces）
- 设置性能预算（performance_budget）

### 3. 评估因子

- 客观指标（objective）用于优化目标
- 代理指标（proxy）用于间接测量
- 护栏指标（guardrail）用于防止回归

### 4. 搜索策略

- 平衡模式（balanced）适合大多数情况
- 保守模式（conservative）用于稳定期
- 探索模式（exploratory）用于创新期

### 5. 循环管理

- 每个循环专注于3-5个改进点
- 定期审查被拒绝的方向（negatives）
- 根据历史数据调整搜索策略

## 故障排除

### 循环中断

如果循环中断，可以恢复：

```bash
meta loop --resume
```

### 性能预算违规

如果性能预算违规导致回滚：

1. 检查 `loop-NNN.yaml` 中的 `evaluation.rollback_reason`
2. 优化代码性能
3. 调整性能预算阈值（如果合理）

### LLM错误

如果LLM调用失败：

1. 检查API密钥是否正确
2. 检查网络连接
3. 尝试其他LLM提供商

## 贡献

欢迎贡献！请遵循以下步骤：

1. Fork仓库
2. 创建特性分支
3. 提交更改
4. 创建Pull Request

## 许可证

MIT License
