#!/usr/bin/env node

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { LoopRunner } from './loop-runner.js'
import type { LoopRunnerConfig } from './types.js'

const cli = yargs(hideBin(process.argv))
  .scriptName('meta')
  .usage('$0 <command> [options]')
  .version('1.0.0')
  .help('help', 'Show help')
  .alias('help', 'h')
  .option('verbose', {
    describe: 'Enable verbose logging',
    type: 'boolean',
    default: false
  })

// meta init
cli.command(
  'init',
  'Initialize meta-design directory structure',
  (yargs) => {
    return yargs
      .option('project-name', {
        describe: 'Project name',
        type: 'string',
        demandOption: true
      })
      .option('stage', {
        describe: 'Project stage',
        type: 'string',
        choices: ['prototype', 'mvp', 'growth', 'mature'],
        default: 'prototype'
      })
      .option('core-value', {
        describe: 'Core value statement',
        type: 'string',
        demandOption: true
      })
      .option('anti-value', {
        describe: 'Anti-value statement',
        type: 'string',
        demandOption: true
      })
  },
  async (argv) => {
    console.log('Initializing meta-design structure...')
    
    const config = await loadConfig()
    
    // Create .meta directory structure
    const fs = await import('fs/promises')
    const path = await import('path')
    
    const metaDir = path.join(config.projectRoot, '.meta')
    
    await fs.mkdir(metaDir, { recursive: true })
    await fs.mkdir(path.join(metaDir, 'cards'), { recursive: true })
    await fs.mkdir(path.join(metaDir, 'loops'), { recursive: true })
    await fs.mkdir(path.join(metaDir, 'negatives'), { recursive: true })
    
    // Create initial design.yaml
    const design = {
      _schema_version: '1.0.0',
      _schema_type: 'meta_design',
      project: {
        id: crypto.randomUUID(),
        name: argv.projectName,
        stage: argv.stage,
        core_value: argv.coreValue,
        anti_value: argv.antiValue,
        tech_stack: {
          primary: [],
          forbidden: []
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      requirements: [],
      constraints: {
        immutable_modules: [],
        stable_interfaces: [],
        performance_budget: [],
        compliance: []
      },
      rejected_directions: [],
      eval_factors: [],
      search_policy: {
        mode: 'balanced',
        max_cards_per_loop: 3,
        exploration_rate: 0.25,
        candidate_sources: [
          { source: 'coverage_gap', weight: 0.45 },
          { source: 'eval_regression', weight: 0.30 },
          { source: 'tech_debt', weight: 0.15 },
          { source: 'free_exploration', weight: 0.10 }
        ],
        warn_proximity_to: ['immutable_modules', 'rejected_directions', 'performance_budget']
      },
      loop_history: {
        total_loops: 0,
        last_loop_id: '',
        last_loop_at: new Date().toISOString(),
        loops: []
      }
    }
    
    const yaml = await import('js-yaml')
    const content = yaml.dump(design, { indent: 2 })
    await fs.writeFile(path.join(metaDir, 'design.yaml'), content, 'utf-8')
    
    console.log('✅ Meta-design structure initialized')
    console.log(`   Directory: ${metaDir}`)
    console.log('   Next steps:')
    console.log('   1. Edit .meta/design.yaml to add requirements and constraints')
    console.log('   2. Run "meta loop" to start your first loop')
  }
)

// meta loop
cli.command(
  'loop',
  'Run one loop (all 6 phases)',
  (yargs) => {
    return yargs
      .option('dry-run', {
        describe: 'Only run ANALYZE + GENERATE, no execution',
        type: 'boolean',
        default: false
      })
      .option('from', {
        describe: 'Resume or re-run from a specific phase',
        type: 'string',
        choices: ['analyze', 'generate', 'decide', 'execute', 'evaluate', 'close']
      })
      .option('resume', {
        describe: 'Resume an incomplete loop',
        type: 'boolean',
        default: false
      })
  },
  async (argv) => {
    const config = await loadConfig()
    
    const runner = new LoopRunner(config, {
      dryRun: argv.dryRun,
      fromPhase: argv.from,
      resume: argv.resume,
      verbose: argv.verbose
    })
    
    try {
      await runner.run()
    } catch (error) {
      console.error('Loop failed:', error)
      process.exit(1)
    }
  }
)

// meta status
cli.command(
  'status',
  'Show current design.yaml state as TUI',
  (yargs) => yargs,
  async (argv) => {
    const config = await loadConfig()
    const runner = new LoopRunner(config)
    await runner.status()
  }
)

// meta neg
cli.command(
  'neg <command>',
  'Manage rejected directions',
  (yargs) => {
    return yargs
      .command(
        'list',
        'List all rejected directions',
        (yargs) => yargs,
        async (argv) => {
          const config = await loadConfig()
          const fs = await import('fs/promises')
          const path = await import('path')
          const yaml = await import('js-yaml')
          
          const designPath = path.join(config.metaDir, 'design.yaml')
          const content = await fs.readFile(designPath, 'utf-8')
          const design = yaml.load(content) as any
          
          console.log('\n🚫 Rejected Directions:')
          console.log('='.repeat(80))
          
          for (const neg of design.rejected_directions) {
            const statusIcon = neg.status === 'active' ? '🔴' : neg.status === 'pending_review' ? '🟡' : '🟢'
            console.log(`\n${statusIcon} ${neg.id}`)
            console.log(`  Text: ${neg.text}`)
            console.log(`  Reason: ${neg.reason}`)
            console.log(`  Scope: ${neg.scope.type}`)
            console.log(`  Status: ${neg.status}`)
          }
        }
      )
      .command(
        'lift <neg-id>',
        'Lift a rejected direction',
        (yargs) => {
          return yargs
            .positional('neg-id', {
              describe: 'NEG ID to lift',
              type: 'string',
              demandOption: true
            })
            .option('note', {
              describe: 'Note for lifting',
              type: 'string',
              default: ''
            })
        },
        async (argv) => {
          const config = await loadConfig()
          const fs = await import('fs/promises')
          const path = await import('path')
          const yaml = await import('js-yaml')
          
          const designPath = path.join(config.metaDir, 'design.yaml')
          const content = await fs.readFile(designPath, 'utf-8')
          const design = yaml.load(content) as any
          
          const neg = design.rejected_directions.find((n: any) => n.id === argv.negId)
          
          if (!neg) {
            console.error(`NEG ${argv.negId} not found`)
            process.exit(1)
          }
          
          neg.status = 'lifted'
          neg.lifted_at = new Date().toISOString()
          neg.lifted_note = argv.note || 'Lifted via CLI'
          
          const updatedContent = yaml.dump(design, { indent: 2 })
          await fs.writeFile(designPath, updatedContent, 'utf-8')
          
          console.log(`✅ Lifted ${argv.negId}`)
        }
      )
      .demandCommand(1, 'You need to specify a neg command')
  }
)

// meta card
cli.command(
  'card <command>',
  'Manage decision cards',
  (yargs) => {
    return yargs
      .command(
        'show <card-id>',
        'Show a card\'s full content and outcome',
        (yargs) => {
          return yargs
            .positional('card-id', {
              describe: 'Card ID to show',
              type: 'string',
              demandOption: true
            })
        },
        async (argv) => {
          const config = await loadConfig()
          const fs = await import('fs/promises')
          const path = await import('path')
          const yaml = await import('js-yaml')
          
          const cardPath = path.join(config.metaDir, 'cards', `${argv.cardId}.yaml`)
          
          try {
            const content = await fs.readFile(cardPath, 'utf-8')
            const card = yaml.load(content) as any
            
            console.log('\n📋 Decision Card:')
            console.log('='.repeat(80))
            console.log(`ID: ${card.id}`)
            console.log(`Loop: ${card.loop_id}`)
            console.log(`Status: ${card.decision.status}`)
            console.log(`\nObjective:`)
            console.log(`  ${card.content.objective}`)
            console.log(`\nApproach:`)
            console.log(`  ${card.content.approach}`)
            console.log(`\nBenefit:`)
            console.log(`  ${card.content.benefit}`)
            console.log(`\nCost:`)
            console.log(`  ${card.content.cost}`)
            console.log(`\nRisk:`)
            console.log(`  ${card.content.risk}`)
            console.log(`\nConfidence: ${(card.prediction.confidence * 100).toFixed(0)}%`)
            
            if (card.outcome) {
              console.log(`\nOutcome:`)
              console.log(`  Status: ${card.outcome.status}`)
              console.log(`  Prediction Accuracy: ${(card.outcome.prediction_accuracy * 100).toFixed(0)}%`)
            }
          } catch (error) {
            console.error(`Card ${argv.cardId} not found`)
            process.exit(1)
          }
        }
      )
      .demandCommand(1, 'You need to specify a card command')
  }
)

// meta eval
cli.command(
  'eval <command>',
  'Run evaluation',
  (yargs) => {
    return yargs
      .command(
        'run',
        'Run evaluation outside of a loop',
        (yargs) => yargs,
        async (argv) => {
          console.log('Running standalone evaluation...')
          // In a real implementation, this would run the evaluation phase
          console.log('Not implemented yet')
        }
      )
      .demandCommand(1, 'You need to specify an eval command')
  }
)

// meta history
cli.command(
  'history',
  'Show loop history timeline',
  (yargs) => yargs,
  async (argv) => {
    const config = await loadConfig()
    const fs = await import('fs/promises')
    const path = await import('path')
    const yaml = await import('js-yaml')
    
    const designPath = path.join(config.metaDir, 'design.yaml')
    const content = await fs.readFile(designPath, 'utf-8')
    const design = yaml.load(content) as any
    
    console.log('\n📊 Loop History:')
    console.log('='.repeat(80))
    console.log(`Total Loops: ${design.loop_history.total_loops}`)
    console.log(`Last Loop: ${design.loop_history.last_loop_id}`)
    
    if (design.loop_history.loops.length === 0) {
      console.log('\nNo loops completed yet')
      return
    }
    
    console.log('\nLoops:')
    for (const loop of design.loop_history.loops) {
      const statusIcon = loop.status === 'completed' ? '✅' : loop.status === 'rolled_back' ? '⚠️' : '❌'
      console.log(`\n${statusIcon} ${loop.loop_id}`)
      console.log(`  Status: ${loop.status}`)
      console.log(`  Cards: ${loop.cards_proposed} proposed, ${loop.cards_accepted} accepted, ${loop.cards_rejected} rejected`)
      console.log(`  Score Delta: ${loop.composite_score_delta >= 0 ? '+' : ''}${loop.composite_score_delta.toFixed(3)}`)
      console.log(`  Summary: ${loop.summary}`)
    }
  }
)

// Helper function to load config
async function loadConfig(): Promise<LoopRunnerConfig> {
  const path = await import('path')
  const fs = await import('fs/promises')
  
  const projectRoot = process.cwd()
  const metaDir = path.join(projectRoot, '.meta')
  
  // Check if .meta directory exists
  try {
    await fs.access(metaDir)
  } catch {
    console.error('Error: .meta directory not found')
    console.error('Run "meta init" first to initialize the project')
    process.exit(1)
  }
  
  // Load config from environment or defaults
  return {
    projectRoot,
    metaDir,
    llm: {
      provider: (process.env.META_LLM_PROVIDER as any) || 'anthropic',
      apiKey: process.env.META_LLM_API_KEY || '',
      model: process.env.META_LLM_MODEL,
      baseUrl: process.env.META_LLM_BASE_URL
    },
    git: {
      defaultBranch: process.env.META_GIT_DEFAULT_BRANCH || 'main',
      branchPrefix: process.env.META_GIT_BRANCH_PREFIX || 'meta/'
    },
    tui: {
      enabled: process.env.META_TUI_ENABLED !== 'false',
      theme: (process.env.META_TUI_THEME as any) || 'dark'
    }
  }
}

// Parse CLI arguments
cli.parse()
