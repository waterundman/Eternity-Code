#!/usr/bin/env node

/**
 * 示例脚本：演示如何使用Loop Runner
 * 
 * 使用方法：
 * node example-usage.js
 */

import { LoopRunner } from './src/loop-runner.js'
import type { LoopRunnerConfig } from './src/types.js'

async function main() {
  console.log('🚀 Loop Runner Example')
  console.log('='.repeat(80))
  
  // 配置
  const config: LoopRunnerConfig = {
    projectRoot: process.cwd(),
    metaDir: `${process.cwd()}/.meta`,
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
      enabled: true,
      theme: 'dark'
    }
  }
  
  // 创建Loop Runner实例
  const runner = new LoopRunner(config, {
    dryRun: true,  // 只运行分析和生成，不执行
    verbose: true
  })
  
  try {
    // 运行循环
    await runner.run()
    
    console.log('\n✅ Example completed successfully!')
  } catch (error) {
    console.error('\n❌ Example failed:', error)
    process.exit(1)
  }
}

main()
