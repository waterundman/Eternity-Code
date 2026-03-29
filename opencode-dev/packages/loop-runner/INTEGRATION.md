# Loop Runner 与 OpenCode 集成指南

## 概述

Loop Runner 可以与 OpenCode 的现有工具系统深度集成，实现自动化的代码改进循环。

## 集成方式

### 1. 作为 OpenCode 插件

创建一个 OpenCode 插件，将 Loop Runner 功能暴露给 OpenCode：

```typescript
// packages/opencode/src/plugin/loop-runner.ts
import { Plugin } from '@opencode-ai/plugin'
import { LoopRunner } from '@opencode-ai/loop-runner'
import { z } from 'zod'

export const loopRunnerPlugin: Plugin = async (input) => {
  const { client, project, directory } = input
  
  return {
    tool: {
      metaLoop: {
        description: 'Run a meta-design loop to improve the codebase',
        parameters: z.object({
          dryRun: z.boolean().optional().describe('Only analyze and generate, do not execute'),
          fromPhase: z.enum(['analyze', 'generate', 'decide', 'execute', 'evaluate', 'close']).optional(),
          resume: z.boolean().optional().describe('Resume an incomplete loop')
        }),
        execute: async (args, ctx) => {
          const config = {
            projectRoot: directory,
            metaDir: `${directory}/.meta`,
            llm: {
              provider: 'anthropic',
              apiKey: process.env.ANTHROPIC_API_KEY || '',
              model: 'claude-3-sonnet-20240229'
            },
            git: {
              defaultBranch: 'main',
              branchPrefix: 'meta/'
            },
            tui: {
              enabled: false, // Disable TUI when running from OpenCode
              theme: 'dark'
            }
          }
          
          const runner = new LoopRunner(config, {
            dryRun: args.dryRun,
            fromPhase: args.fromPhase,
            resume: args.resume,
            verbose: false
          })
          
          await runner.run()
          
          return {
            title: 'Loop completed',
            metadata: {},
            output: 'Meta-design loop completed successfully'
          }
        }
      },
      
      metaStatus: {
        description: 'Show current meta-design status',
        parameters: z.object({}),
        execute: async (args, ctx) => {
          const config = {
            projectRoot: directory,
            metaDir: `${directory}/.meta`,
            llm: {
              provider: 'anthropic',
              apiKey: process.env.ANTHROPIC_API_KEY || '',
              model: 'claude-3-sonnet-20240229'
            },
            git: {
              defaultBranch: 'main',
              branchPrefix: 'meta/'
            },
            tui: {
              enabled: false,
              theme: 'dark'
            }
          }
          
          const runner = new LoopRunner(config)
          await runner.status()
          
          return {
            title: 'Status displayed',
            metadata: {},
            output: 'Meta-design status displayed'
          }
        }
      }
    }
  }
}
```

### 2. 使用 OpenCode SDK

Loop Runner 可以使用 OpenCode SDK 来执行代码修改：

```typescript
// packages/loop-runner/src/phases/execute.ts
import { createOpencodeClient } from '@opencode-ai/sdk'

export class ExecutePhase extends Phase {
  private async executeCard(card: Card, design: Design): Promise<ExecutionResult> {
    const client = createOpencodeClient({
      baseUrl: this.context.config.opencodeUrl || 'http://localhost:4096'
    })
    
    // 使用 OpenCode 的工具执行代码修改
    for (const file of card.content.scope) {
      // 读取文件
      const readResult = await client.session.callTool({
        sessionID: this.context.sessionId,
        tool: 'read',
        args: { file }
      })
      
      // 使用 LLM 生成修改
      const modification = await this.generateModification(card, readResult.output)
      
      // 应用修改
      await client.session.callTool({
        sessionID: this.context.sessionId,
        tool: 'edit',
        args: {
          file,
          oldText: modification.oldText,
          newText: modification.newText
        }
      })
    }
    
    return { status: 'success', filesModified: card.content.scope }
  }
}
```

### 3. 在 OpenCode TUI 中集成

在 OpenCode 的 TUI 中添加 Loop Runner 界面：

```typescript
// packages/opencode/src/cli/cmd/loop.ts
import { Command } from '../command'
import { UI } from '../ui'
import { LoopRunner } from '@opencode-ai/loop-runner'

export const LoopCommand: Command = {
  command: 'loop',
  describe: 'Run a meta-design loop',
  builder: (yargs) => {
    return yargs
      .option('dry-run', {
        describe: 'Only analyze and generate',
        type: 'boolean',
        default: false
      })
      .option('from', {
        describe: 'Start from a specific phase',
        type: 'string'
      })
  },
  handler: async (argv) => {
    const config = await loadConfig()
    
    UI.log('Starting meta-design loop...')
    
    const runner = new LoopRunner(config, {
      dryRun: argv.dryRun,
      fromPhase: argv.from,
      verbose: true
    })
    
    await runner.run()
  }
}
```

## 工作流程

### 1. 初始化项目

```bash
# 在 OpenCode 项目中初始化 meta-design
opencode meta init --project-name "my-project"
```

### 2. 编辑设计文件

编辑 `.meta/design.yaml`，定义需求、约束和评估因子。

### 3. 运行循环

```bash
# 运行完整循环
opencode loop

# 或只运行分析
opencode loop --dry-run
```

### 4. 查看状态

```bash
# 查看项目状态
opencode meta status

# 查看循环历史
opencode meta history
```

## 高级集成

### 1. 自定义评估脚本

创建自定义评估脚本，与 Loop Runner 集成：

```javascript
// scripts/custom-eval.js
#!/usr/bin/env node

import { createOpencodeClient } from '@opencode-ai/sdk'

async function evaluate(factorId, spec) {
  const client = createOpencodeClient()
  
  switch (factorId) {
    case 'EVAL-001':
      // 自定义评估逻辑
      const result = await client.session.callTool({
        sessionID: 'eval-session',
        tool: 'bash',
        args: { command: 'npm test -- --coverage' }
      })
      
      // 解析覆盖率
      const coverage = parseCoverage(result.output)
      return `${coverage}%`
    
    default:
      throw new Error(`Unknown factor: ${factorId}`)
  }
}

evaluate(process.argv[2], process.argv[3])
  .then(console.log)
  .catch(console.error)
```

### 2. 与 OpenCode 会话集成

在 OpenCode 会话中运行 Loop Runner：

```typescript
// 在 OpenCode 会话中
const session = await client.session.create({
  projectID: project.id
})

// 运行 Loop Runner
await client.session.callTool({
  sessionID: session.id,
  tool: 'metaLoop',
  args: {
    dryRun: false,
    resume: true
  }
})
```

### 3. 自动化循环

设置定时任务，自动运行循环：

```yaml
# .github/workflows/meta-loop.yml
name: Meta-Design Loop

on:
  schedule:
    - cron: '0 2 * * 1'  # 每周一凌晨2点
  workflow_dispatch:

jobs:
  run-loop:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
      
      - name: Install dependencies
        run: bun install
      
      - name: Run meta loop
        run: bun run packages/loop-runner/src/cli.ts loop
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## 最佳实践

### 1. 需求管理

- 使用 `requirements` 定义可衡量的目标
- 定期更新 `coverage` 值
- 使用 `signal` 定义验收标准

### 2. 约束设置

- 保护核心模块（`immutable_modules`）
- 定义稳定的 API 接口（`stable_interfaces`）
- 设置性能预算（`performance_budget`）

### 3. 评估因子

- 客观指标用于优化目标
- 代理指标用于间接测量
- 护栏指标用于防止回归

### 4. 循环管理

- 每个循环专注于 3-5 个改进点
- 定期审查被拒绝的方向（`negatives`）
- 根据历史数据调整搜索策略

## 故障排除

### 1. 循环中断

如果循环中断，可以恢复：

```bash
opencode loop --resume
```

### 2. 性能预算违规

如果性能预算违规导致回滚：

1. 检查 `loop-NNN.yaml` 中的 `evaluation.rollback_reason`
2. 优化代码性能
3. 调整性能预算阈值（如果合理）

### 3. LLM 错误

如果 LLM 调用失败：

1. 检查 API 密钥是否正确
2. 检查网络连接
3. 尝试其他 LLM 提供商

## 示例

完整的示例项目：

```bash
# 克隆示例项目
git clone https://github.com/anomalyco/opencode-loop-example.git

# 安装依赖
cd opencode-loop-example
bun install

# 运行循环
bun run loop
```

## 相关资源

- [OpenCode 文档](https://opencode.ai/docs)
- [Loop Runner 设计文档](./loop-runner.design.md)
- [Meta-Design Schema](./design.schema.yaml)
- [Card Schema](./card.schema.yaml)
- [Loop Schema](./loop.schema.yaml)
