import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { z } from 'zod'
import { DesignSchema, LoopSchema, CardSchema, NegativeSchema } from './schema/index.js'
import type { 
  LoopRunnerConfig, 
  LoopRunnerOptions, 
  Design, 
  Loop, 
  Card, 
  Negative,
  PhaseType,
  PhaseContext,
  PhaseResult
} from './types.js'
import { AnalyzePhase } from './phases/analyze.js'
import { GeneratePhase } from './phases/generate.js'
import { DecidePhase } from './phases/decide.js'
import { ExecutePhase } from './phases/execute.js'
import { EvaluatePhase } from './phases/evaluate.js'
import { ClosePhase } from './phases/close.js'

export class LoopRunner {
  private config: LoopRunnerConfig
  private options: LoopRunnerOptions

  constructor(config: LoopRunnerConfig, options: LoopRunnerOptions = {}) {
    this.config = config
    this.options = options
  }

  async run(): Promise<void> {
    console.log('Starting Loop Runner...')
    
    // Load or create design.yaml
    const design = await this.loadDesign()
    
    // Determine loop sequence
    const sequence = (design.loop_history.total_loops || 0) + 1
    const loopId = `loop-${String(sequence).padStart(3, '0')}`
    
    // Check for incomplete loop
    const incompleteLoop = await this.findIncompleteLoop()
    if (incompleteLoop) {
      if (this.options.resume) {
        console.log(`Resuming incomplete loop: ${incompleteLoop.id}`)
        await this.resumeLoop(incompleteLoop, design)
        return
      } else {
        console.log(`Found incomplete loop: ${incompleteLoop.id}`)
        // Mark as aborted
        incompleteLoop.status = 'aborted'
        await this.saveLoop(incompleteLoop)
      }
    }
    
    // Create new loop
    const loop = this.createLoop(loopId, sequence)
    await this.saveLoop(loop)
    
    // Run phases
    const context: PhaseContext = {
      config: this.config,
      design,
      loop,
      options: this.options
    }
    
    try {
      // Phase 1: Analyze
      if (this.shouldRunPhase('analyze')) {
        console.log('\n=== Phase 1: ANALYZE ===')
        const analyzePhase = new AnalyzePhase(context)
        const result = await analyzePhase.execute()
        if (!result.success) {
          throw new Error(`Analyze phase failed: ${result.error?.message}`)
        }
        loop.analysis = result.data
        loop.status = 'running'
        await this.saveLoop(loop)
      }
      
      // Phase 2: Generate
      if (this.shouldRunPhase('generate')) {
        console.log('\n=== Phase 2: GENERATE ===')
        const generatePhase = new GeneratePhase(context)
        const result = await generatePhase.execute()
        if (!result.success) {
          throw new Error(`Generate phase failed: ${result.error?.message}`)
        }
        loop.candidates = result.data
        await this.saveLoop(loop)
      }
      
      // Phase 3: Decide
      if (this.shouldRunPhase('decide')) {
        console.log('\n=== Phase 3: DECIDE ===')
        loop.status = 'decision_pending'
        await this.saveLoop(loop)
        
        const decidePhase = new DecidePhase(context)
        const result = await decidePhase.execute()
        if (!result.success) {
          throw new Error(`Decide phase failed: ${result.error?.message}`)
        }
        loop.decision_session = result.data
        loop.status = 'executing'
        await this.saveLoop(loop)
      }
      
      // Phase 4: Execute
      if (this.shouldRunPhase('execute')) {
        console.log('\n=== Phase 4: EXECUTE ===')
        const executePhase = new ExecutePhase(context)
        const result = await executePhase.execute()
        if (!result.success) {
          throw new Error(`Execute phase failed: ${result.error?.message}`)
        }
        loop.execution = result.data
        
        // Check if rollback occurred during execution
        if (result.data.cards_executed.some(c => c.status === 'rolled_back')) {
          loop.status = 'rolled_back'
          await this.saveLoop(loop)
          await this.handleRollback(loop, design)
          return
        }
        
        loop.status = 'evaluating'
        await this.saveLoop(loop)
      }
      
      // Phase 5: Evaluate
      if (this.shouldRunPhase('evaluate')) {
        console.log('\n=== Phase 5: EVALUATE ===')
        const evaluatePhase = new EvaluatePhase(context)
        const result = await evaluatePhase.execute()
        if (!result.success) {
          throw new Error(`Evaluate phase failed: ${result.error?.message}`)
        }
        loop.evaluation = result.data
        
        // Check if forced rollback
        if (result.data.forced_rollback) {
          loop.status = 'rolled_back'
          await this.saveLoop(loop)
          await this.handleRollback(loop, design)
          return
        }
        
        await this.saveLoop(loop)
      }
      
      // Phase 6: Close
      if (this.shouldRunPhase('close')) {
        console.log('\n=== Phase 6: CLOSE ===')
        const closePhase = new ClosePhase(context)
        const result = await closePhase.execute()
        if (!result.success) {
          throw new Error(`Close phase failed: ${result.error?.message}`)
        }
        loop.close = result.data
        loop.status = 'completed'
        loop.completed_at = new Date().toISOString()
        await this.saveLoop(loop)
        
        // Update design.yaml
        await this.updateDesign(design, loop)
        
        console.log('\n✅ Loop completed successfully!')
        this.displayLoopSummary(loop)
      }
      
    } catch (error) {
      console.error('Loop failed:', error)
      loop.status = 'aborted'
      await this.saveLoop(loop)
      throw error
    }
  }

  private async loadDesign(): Promise<Design> {
    const designPath = path.join(this.config.metaDir, 'design.yaml')
    
    try {
      const content = await fs.readFile(designPath, 'utf-8')
      const data = yaml.load(content) as any
      return DesignSchema.parse(data)
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('design.yaml not found. Run "meta init" first.')
      }
      throw error
    }
  }

  private async saveDesign(design: Design): Promise<void> {
    const designPath = path.join(this.config.metaDir, 'design.yaml')
    const content = yaml.dump(design, { indent: 2 })
    await fs.writeFile(designPath, content, 'utf-8')
  }

  private async findIncompleteLoop(): Promise<Loop | null> {
    const loopsDir = path.join(this.config.metaDir, 'loops')
    
    try {
      const files = await fs.readdir(loopsDir)
      const loopFiles = files.filter(f => f.startsWith('loop-') && f.endsWith('.yaml'))
      
      for (const file of loopFiles) {
        const content = await fs.readFile(path.join(loopsDir, file), 'utf-8')
        const loop = yaml.load(content) as any
        
        if (loop.status && !['completed', 'rolled_back', 'aborted'].includes(loop.status)) {
          return LoopSchema.parse(loop)
        }
      }
    } catch (error) {
      // Directory doesn't exist or other error
    }
    
    return null
  }

  private async resumeLoop(loop: Loop, design: Design): Promise<void> {
    const context: PhaseContext = {
      config: this.config,
      design,
      loop,
      options: this.options
    }
    
    const phaseOrder: PhaseType[] = ['analyze', 'generate', 'decide', 'execute', 'evaluate', 'close']
    const currentPhaseIndex = this.getCurrentPhaseIndex(loop)
    
    for (let i = currentPhaseIndex; i < phaseOrder.length; i++) {
      const phase = phaseOrder[i]
      console.log(`\nResuming at phase: ${phase.toUpperCase()}`)
      
      let result: PhaseResult
      
      switch (phase) {
        case 'analyze':
          result = await new AnalyzePhase(context).execute()
          loop.analysis = result.data
          break
        case 'generate':
          result = await new GeneratePhase(context).execute()
          loop.candidates = result.data
          break
        case 'decide':
          loop.status = 'decision_pending'
          await this.saveLoop(loop)
          result = await new DecidePhase(context).execute()
          loop.decision_session = result.data
          break
        case 'execute':
          result = await new ExecutePhase(context).execute()
          loop.execution = result.data
          break
        case 'evaluate':
          result = await new EvaluatePhase(context).execute()
          loop.evaluation = result.data
          break
        case 'close':
          result = await new ClosePhase(context).execute()
          loop.close = result.data
          loop.status = 'completed'
          loop.completed_at = new Date().toISOString()
          break
      }
      
      if (!result.success) {
        throw new Error(`${phase} phase failed: ${result.error?.message}`)
      }
      
      await this.saveLoop(loop)
    }
  }

  private getCurrentPhaseIndex(loop: Loop): number {
    if (!loop.analysis) return 0
    if (!loop.candidates) return 1
    if (!loop.decision_session) return 2
    if (!loop.execution) return 3
    if (!loop.evaluation) return 4
    if (!loop.close) return 5
    return 6
  }

  private createLoop(loopId: string, sequence: number): Loop {
    return {
      _schema_version: '1.0.0',
      _schema_type: 'loop_record',
      id: loopId,
      sequence,
      started_at: new Date().toISOString(),
      completed_at: null,
      status: 'running',
      analysis: null,
      candidates: null,
      decision_session: null,
      execution: null,
      evaluation: null,
      close: null
    }
  }

  private async saveLoop(loop: Loop): Promise<void> {
    const loopsDir = path.join(this.config.metaDir, 'loops')
    await fs.mkdir(loopsDir, { recursive: true })
    
    const loopPath = path.join(loopsDir, `${loop.id}.yaml`)
    const content = yaml.dump(loop, { indent: 2 })
    await fs.writeFile(loopPath, content, 'utf-8')
  }

  private shouldRunPhase(phase: PhaseType): boolean {
    if (!this.options.fromPhase) return true
    
    const phaseOrder: PhaseType[] = ['analyze', 'generate', 'decide', 'execute', 'evaluate', 'close']
    const fromIndex = phaseOrder.indexOf(this.options.fromPhase)
    const currentIndex = phaseOrder.indexOf(phase)
    
    return currentIndex >= fromIndex
  }

  private async handleRollback(loop: Loop, design: Design): Promise<void> {
    console.log('\n⚠️  Loop rolled back')
    
    if (loop.evaluation?.rollback_reason) {
      console.log(`Reason: ${loop.evaluation.rollback_reason}`)
    }
    
    // Update design.yaml with rollback info
    design.loop_history.total_loops++
    design.loop_history.last_loop_id = loop.id
    design.loop_history.last_loop_at = new Date().toISOString()
    design.loop_history.loops.push({
      loop_id: loop.id,
      status: 'rolled_back',
      cards_proposed: loop.candidates?.presented_cards.length || 0,
      cards_accepted: loop.decision_session?.accepted_cards.length || 0,
      cards_rejected: loop.decision_session?.rejected_cards.length || 0,
      composite_score_delta: loop.evaluation?.composite_delta || 0,
      summary: `Rolled back: ${loop.evaluation?.rollback_reason || 'Unknown reason'}`
    })
    
    await this.saveDesign(design)
  }

  private async updateDesign(design: Design, loop: Loop): Promise<void> {
    // Update requirements coverage
    if (loop.analysis?.requirement_coverage) {
      for (const coverage of loop.analysis.requirement_coverage) {
        const req = design.requirements.find(r => r.id === coverage.req_id)
        if (req) {
          req.coverage = coverage.coverage_assessed
          req.coverage_note = coverage.gap_description
          req.last_checked = new Date().toISOString()
        }
      }
    }
    
    // Update eval baselines
    if (loop.evaluation?.factor_results) {
      for (const result of loop.evaluation.factor_results) {
        const factor = design.eval_factors.find(f => f.id === result.factor_id)
        if (factor) {
          factor.threshold.baseline = result.value_after
        }
      }
    }
    
    // Process unlocked negatives
    if (loop.analysis?.negatives_unlocked) {
      for (const negId of loop.analysis.negatives_unlocked) {
        const neg = design.rejected_directions.find(n => n.id === negId)
        if (neg) {
          neg.status = 'pending_review'
        }
      }
    }
    
    // Add new negatives from rejections
    if (loop.decision_session?.new_negatives_written) {
      // Load new negatives from files
      const negativesDir = path.join(this.config.metaDir, 'negatives')
      for (const negId of loop.decision_session.new_negatives_written) {
        try {
          const content = await fs.readFile(path.join(negativesDir, `${negId}.yaml`), 'utf-8')
          const neg = yaml.load(content) as any
          design.rejected_directions.push(NegativeSchema.parse(neg))
        } catch (error) {
          console.warn(`Failed to load negative: ${negId}`)
        }
      }
    }
    
    // Update loop history
    design.loop_history.total_loops++
    design.loop_history.last_loop_id = loop.id
    design.loop_history.last_loop_at = new Date().toISOString()
    design.loop_history.loops.push({
      loop_id: loop.id,
      status: 'completed',
      cards_proposed: loop.candidates?.presented_cards.length || 0,
      cards_accepted: loop.decision_session?.accepted_cards.length || 0,
      cards_rejected: loop.decision_session?.rejected_cards.length || 0,
      composite_score_delta: loop.evaluation?.composite_delta || 0,
      summary: loop.close?.summary || 'Loop completed'
    })
    
    await this.saveDesign(design)
  }

  private displayLoopSummary(loop: Loop): void {
    console.log('\n📊 Loop Summary:')
    console.log(`  Loop ID: ${loop.id}`)
    console.log(`  Status: ${loop.status}`)
    
    if (loop.evaluation) {
      console.log(`  Composite Score: ${loop.evaluation.composite_score_before.toFixed(3)} → ${loop.evaluation.composite_score_after.toFixed(3)} (${loop.evaluation.composite_delta >= 0 ? '+' : ''}${loop.evaluation.composite_delta.toFixed(3)})`)
    }
    
    if (loop.decision_session) {
      console.log(`  Cards Accepted: ${loop.decision_session.accepted_cards.length}`)
      console.log(`  Cards Rejected: ${loop.decision_session.rejected_cards.length}`)
    }
    
    if (loop.execution) {
      console.log(`  Files Modified: ${loop.execution.total_files_modified}`)
    }
    
    if (loop.close?.next_loop_hints.length) {
      console.log('\n💡 Next Loop Hints:')
      for (const hint of loop.close.next_loop_hints) {
        console.log(`  [${hint.priority.toUpperCase()}] ${hint.type}: ${hint.message}`)
      }
    }
  }

  async status(): Promise<void> {
    const design = await this.loadDesign()
    
    console.log('\n📋 Project Status:')
    console.log(`  Project: ${design.project.name}`)
    console.log(`  Stage: ${design.project.stage}`)
    console.log(`  Total Loops: ${design.loop_history.total_loops}`)
    console.log(`  Last Loop: ${design.loop_history.last_loop_id}`)
    
    console.log('\n📝 Requirements:')
    for (const req of design.requirements) {
      const coverage = (req.coverage * 100).toFixed(0)
      console.log(`  ${req.id}: ${req.text.slice(0, 50)}... [${coverage}%]`)
    }
    
    console.log('\n🚫 Active Negatives:')
    const activeNegatives = design.rejected_directions.filter(n => n.status === 'active')
    if (activeNegatives.length === 0) {
      console.log('  None')
    } else {
      for (const neg of activeNegatives) {
        console.log(`  ${neg.id}: ${neg.text.slice(0, 50)}...`)
      }
    }
    
    console.log('\n📈 Evaluation Factors:')
    for (const factor of design.eval_factors) {
      console.log(`  ${factor.id}: ${factor.name} [${factor.threshold.baseline}]`)
    }
  }
}
