import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { Phase } from './base.js'
import type { CloseResult, Design, Loop } from '../types.js'

export class ClosePhase extends Phase {
  async execute(): Promise<CloseResult> {
    try {
      this.log('Starting close phase...')
      
      const { design, loop } = this.context
      
      // Update design.yaml with loop results
      this.log('Updating design.yaml...')
      const designUpdates = await this.updateDesign(design, loop)
      
      // Generate summary
      this.log('Generating summary...')
      const summary = this.generateSummary(loop)
      
      // Generate next loop hints
      this.log('Generating next loop hints...')
      const nextLoopHints = await this.generateNextLoopHints(design, loop)
      
      // Display loop summary
      this.displayLoopSummary(loop, designUpdates, nextLoopHints)
      
      this.log('Close phase complete')
      
      return this.success({
        designUpdates,
        summary,
        nextLoopHints
      })
    } catch (error) {
      return this.error(error as Error)
    }
  }

  private async updateDesign(design: Design, loop: Loop): Promise<{
    requirementsCoverageUpdated: boolean
    negativesAdded: string[]
    negativesLifted: string[]
    evalBaselinesUpdated: boolean
    loopHistoryAppended: boolean
  }> {
    const updates = {
      requirementsCoverageUpdated: false,
      negativesAdded: [] as string[],
      negativesLifted: [] as string[],
      evalBaselinesUpdated: false,
      loopHistoryAppended: false
    }
    
    // 1. Update requirements coverage
    if (loop.analysis?.requirement_coverage) {
      for (const coverage of loop.analysis.requirement_coverage) {
        const req = design.requirements.find(r => r.id === coverage.reqId)
        if (req) {
          req.coverage = coverage.coverage_assessed
          req.coverage_note = coverage.gapDescription
          req.last_checked = new Date().toISOString()
          updates.requirementsCoverageUpdated = true
        }
      }
    }
    
    // 2. Update eval baselines
    if (loop.evaluation?.factor_results) {
      for (const result of loop.evaluation.factor_results) {
        const factor = design.eval_factors.find(f => f.id === result.factorId)
        if (factor) {
          factor.threshold.baseline = result.valueAfter
          updates.evalBaselinesUpdated = true
        }
      }
    }
    
    // 3. Process unlocked negatives
    if (loop.analysis?.negatives_unlocked) {
      for (const negId of loop.analysis.negatives_unlocked) {
        const neg = design.rejected_directions.find(n => n.id === negId)
        if (neg && neg.status === 'active') {
          neg.status = 'pending_review'
          updates.negativesLifted.push(negId)
        }
      }
    }
    
    // 4. Add new negatives from rejections
    if (loop.decision_session?.new_negatives_written) {
      const negativesDir = path.join(this.context.config.metaDir, 'negatives')
      
      for (const negId of loop.decision_session.new_negatives_written) {
        try {
          const content = await fs.readFile(path.join(negativesDir, `${negId}.yaml`), 'utf-8')
          const neg = yaml.load(content) as any
          
          // Check if already in design
          if (!design.rejected_directions.find(n => n.id === negId)) {
            design.rejected_directions.push(neg)
            updates.negativesAdded.push(negId)
          }
        } catch (error) {
          this.warn(`Failed to load negative: ${negId}`)
        }
      }
    }
    
    // 5. Update loop history
    design.loop_history.total_loops++
    design.loop_history.last_loop_id = loop.id
    design.loop_history.last_loop_at = new Date().toISOString()
    
    design.loop_history.loops.push({
      loop_id: loop.id,
      status: loop.status === 'completed' ? 'completed' : loop.status === 'rolled_back' ? 'rolled_back' : 'aborted',
      cards_proposed: loop.candidates?.presented_cards.length || 0,
      cards_accepted: loop.decision_session?.accepted_cards.length || 0,
      cards_rejected: loop.decision_session?.rejected_cards.length || 0,
      composite_score_delta: loop.evaluation?.composite_delta || 0,
      summary: this.generateLoopHistorySummary(loop)
    })
    
    updates.loopHistoryAppended = true
    
    // Save updated design
    await this.saveDesign(design)
    
    return updates
  }

  private generateLoopHistorySummary(loop: Loop): string {
    if (loop.status === 'rolled_back') {
      return `Rolled back: ${loop.evaluation?.rollback_reason || 'Unknown reason'}`
    }
    
    if (loop.status === 'aborted') {
      return 'Loop aborted'
    }
    
    const cardsAccepted = loop.decision_session?.accepted_cards.length || 0
    const cardsRejected = loop.decision_session?.rejected_cards.length || 0
    const compositeDelta = loop.evaluation?.composite_delta || 0
    
    let summary = `${cardsAccepted} cards accepted, ${cardsRejected} rejected`
    
    if (compositeDelta !== 0) {
      summary += `, score ${compositeDelta >= 0 ? '+' : ''}${compositeDelta.toFixed(3)}`
    }
    
    return summary
  }

  private generateSummary(loop: Loop): string {
    const lines = []
    
    lines.push(`Loop ${loop.id} completed`)
    lines.push(`Status: ${loop.status}`)
    
    if (loop.candidates) {
      lines.push(`Cards proposed: ${loop.candidates.presented_cards.length}`)
    }
    
    if (loop.decision_session) {
      lines.push(`Cards accepted: ${loop.decision_session.accepted_cards.length}`)
      lines.push(`Cards rejected: ${loop.decision_session.rejected_cards.length}`)
    }
    
    if (loop.execution) {
      lines.push(`Files modified: ${loop.execution.total_files_modified}`)
    }
    
    if (loop.evaluation) {
      lines.push(`Composite score: ${loop.evaluation.composite_score_before.toFixed(3)} → ${loop.evaluation.composite_score_after.toFixed(3)}`)
      lines.push(`Score delta: ${loop.evaluation.composite_delta >= 0 ? '+' : ''}${loop.evaluation.composite_delta.toFixed(3)}`)
    }
    
    if (loop.close?.next_loop_hints.length) {
      lines.push(`Next loop hints: ${loop.close.next_loop_hints.length}`)
    }
    
    return lines.join('\n')
  }

  private async generateNextLoopHints(
    design: Design,
    loop: Loop
  ): Promise<Array<{
    type: 'coverage_gap' | 'eval_regression' | 'constraint_risk' | 'opportunity'
    message: string
    priority: 'high' | 'medium' | 'low'
  }>> {
    const hints = []
    
    // 1. Check for coverage gaps
    if (loop.analysis?.requirement_coverage) {
      for (const coverage of loop.analysis.requirement_coverage) {
        if (coverage.coverage_assessed < 0.5) {
          const req = design.requirements.find(r => r.id === coverage.reqId)
          hints.push({
            type: 'coverage_gap' as const,
            message: `${req?.id || coverage.reqId}: ${coverage.gapDescription}`,
            priority: 'high' as const
          })
        }
      }
    }
    
    // 2. Check for eval regressions
    if (loop.evaluation?.factor_results) {
      for (const result of loop.evaluation.factor_results) {
        if (result.delta < -0.1) {
          const factor = design.eval_factors.find(f => f.id === result.factorId)
          hints.push({
            type: 'eval_regression' as const,
            message: `${factor?.name || result.factorId}: regressed by ${Math.abs(result.delta).toFixed(2)}`,
            priority: 'high' as const
          })
        }
      }
    }
    
    // 3. Check for constraint risks
    if (loop.analysis?.constraint_proximity) {
      for (const constraint of loop.analysis.constraint_proximity) {
        if (constraint.status === 'warning') {
          hints.push({
            type: 'constraint_risk' as const,
            message: `${constraint.constraintRef}: ${constraint.detail}`,
            priority: 'medium' as const
          })
        }
      }
    }
    
    // 4. Add general opportunity hints
    if (loop.evaluation && loop.evaluation.composite_delta > 0.1) {
      hints.push({
        type: 'opportunity' as const,
        message: 'Good momentum - consider increasing exploration rate',
        priority: 'low' as const
      })
    }
    
    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    hints.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
    
    return hints
  }

  private displayLoopSummary(
    loop: Loop,
    designUpdates: {
      requirementsCoverageUpdated: boolean
      negativesAdded: string[]
      negativesLifted: string[]
      evalBaselinesUpdated: boolean
      loopHistoryAppended: boolean
    },
    nextLoopHints: Array<{
      type: string
      message: string
      priority: string
    }>
  ): void {
    console.log('\n📊 Loop Summary:')
    console.log('='.repeat(80))
    
    console.log(`Loop ID: ${loop.id}`)
    console.log(`Status: ${loop.status}`)
    
    if (loop.evaluation) {
      console.log(`\nComposite Score:`)
      console.log(`  Before: ${loop.evaluation.composite_score_before.toFixed(3)}`)
      console.log(`  After:  ${loop.evaluation.composite_score_after.toFixed(3)}`)
      console.log(`  Delta:  ${loop.evaluation.composite_delta >= 0 ? '+' : ''}${loop.evaluation.composite_delta.toFixed(3)}`)
    }
    
    if (loop.decision_session) {
      console.log(`\nCards:`)
      console.log(`  Accepted: ${loop.decision_session.accepted_cards.length}`)
      console.log(`  Rejected: ${loop.decision_session.rejected_cards.length}`)
    }
    
    if (loop.execution) {
      console.log(`\nExecution:`)
      console.log(`  Files Modified: ${loop.execution.total_files_modified}`)
    }
    
    console.log(`\nDesign Updates:`)
    console.log(`  Requirements Coverage: ${designUpdates.requirementsCoverageUpdated ? 'Updated' : 'No change'}`)
    console.log(`  Negatives Added: ${designUpdates.negativesAdded.length}`)
    console.log(`  Negatives Lifted: ${designUpdates.negativesLifted.length}`)
    console.log(`  Eval Baselines: ${designUpdates.evalBaselinesUpdated ? 'Updated' : 'No change'}`)
    
    if (nextLoopHints.length > 0) {
      console.log(`\n💡 Next Loop Hints:`)
      for (const hint of nextLoopHints.slice(0, 3)) {
        const priorityIcon = hint.priority === 'high' ? '🔴' : hint.priority === 'medium' ? '🟡' : '🟢'
        console.log(`  ${priorityIcon} [${hint.type}] ${hint.message}`)
      }
    }
    
    console.log('\n' + '='.repeat(80))
  }

  private async saveDesign(design: Design): Promise<void> {
    const designPath = path.join(this.context.config.metaDir, 'design.yaml')
    const content = yaml.dump(design, { indent: 2 })
    await fs.writeFile(designPath, content, 'utf-8')
  }
}
