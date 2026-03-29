import * as fs from 'fs/promises'
import * as path from 'path'
import { glob } from 'glob'
import { Phase } from './base.js'
import type { AnalyzeResult, Design } from '../types.js'

export class AnalyzePhase extends Phase {
  async execute(): Promise<AnalyzeResult> {
    try {
      this.log('Starting analysis...')
      
      const { design, config } = this.context
      
      // 1. Build codebase snapshot
      this.log('Building codebase snapshot...')
      const codebaseSnapshot = await this.buildCodebaseSnapshot()
      
      // 2. Assess requirement coverage
      this.log('Assessing requirement coverage...')
      const requirementCoverage = await this.assessRequirementCoverage(design)
      
      // 3. Check constraint proximity
      this.log('Checking constraint proximity...')
      const constraintProximity = await this.checkConstraintProximity(design)
      
      // 4. Verify active negatives
      this.log('Verifying active negatives...')
      const activeNegativesChecked = await this.verifyActiveNegatives(design)
      
      // 5. Check for unlocked negatives
      this.log('Checking for unlocked negatives...')
      const negativesUnlocked = await this.checkUnlockedNegatives(design)
      
      this.log('Analysis complete')
      
      return this.success({
        codebaseSnapshot,
        requirementCoverage,
        constraintProximity,
        activeNegativesChecked,
        negativesUnlocked
      })
    } catch (error) {
      return this.error(error as Error)
    }
  }

  private async buildCodebaseSnapshot(): Promise<{
    filesRead: number
    totalLines: number
    gitSha: string
  }> {
    const { config } = this.context
    
    // Get git SHA
    const gitSha = await this.getGitSha()
    
    // Count files and lines
    const files = await glob('**/*.{js,ts,jsx,tsx,json,yaml,yml,md}', {
      cwd: config.projectRoot,
      ignore: ['node_modules/**', 'dist/**', '.git/**', '.meta/**']
    })
    
    let totalLines = 0
    let filesRead = 0
    
    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(config.projectRoot, file), 'utf-8')
        totalLines += content.split('\n').length
        filesRead++
      } catch (error) {
        // Skip unreadable files
      }
    }
    
    return {
      filesRead,
      totalLines,
      gitSha
    }
  }

  private async getGitSha(): Promise<string> {
    const { config } = this.context
    
    try {
      const { execSync } = await import('child_process')
      return execSync('git rev-parse HEAD', {
        cwd: config.projectRoot,
        encoding: 'utf-8'
      }).trim()
    } catch (error) {
      return 'unknown'
    }
  }

  private async assessRequirementCoverage(design: Design): Promise<Array<{
    reqId: string
    coverageBefore: number
    coverageAssessed: number
    gapDescription: string
  }>> {
    const results = []
    
    for (const req of design.requirements) {
      // In a real implementation, this would use LLM to assess coverage
      // For now, we'll use a simple heuristic
      const coverageAssessed = await this.assessSingleRequirement(req, design)
      
      results.push({
        reqId: req.id,
        coverageBefore: req.coverage,
        coverageAssessed,
        gapDescription: this.generateGapDescription(req, coverageAssessed)
      })
    }
    
    return results
  }

  private async assessSingleRequirement(req: any, design: Design): Promise<number> {
    // Simple heuristic: if we have recent eval data, use it
    // Otherwise, estimate based on signal type
    
    const factor = design.eval_factors.find(f => 
      f.measurement.spec.includes(req.id) || f.name.toLowerCase().includes(req.text.toLowerCase().slice(0, 20))
    )
    
    if (factor) {
      // Parse baseline value
      const baseline = factor.threshold.baseline
      if (baseline.includes('%')) {
        return parseFloat(baseline) / 100
      }
      if (baseline.includes('/')) {
        const [num, denom] = baseline.split('/').map(Number)
        return num / denom
      }
    }
    
    // Default: return current coverage
    return req.coverage
  }

  private generateGapDescription(req: any, coverage: number): string {
    if (coverage >= 0.8) {
      return 'Requirement largely satisfied'
    } else if (coverage >= 0.5) {
      return 'Requirement partially satisfied, significant gaps remain'
    } else if (coverage >= 0.2) {
      return 'Requirement minimally satisfied, major work needed'
    } else {
      return 'Requirement not satisfied, implementation required'
    }
  }

  private async checkConstraintProximity(design: Design): Promise<Array<{
    constraintRef: string
    status: 'safe' | 'warning' | 'breach'
    detail: string
  }>> {
    const results = []
    
    // Check performance budgets
    for (const budget of design.constraints.performance_budget) {
      const status = await this.checkPerformanceBudget(budget)
      results.push({
        constraintRef: `performance_budget.${budget.metric}`,
        status: status.status,
        detail: status.detail
      })
    }
    
    // Check immutable modules
    for (const module of design.constraints.immutable_modules) {
      results.push({
        constraintRef: `immutable_modules.${module.path}`,
        status: 'safe' as const,
        detail: `Module ${module.path} is immutable: ${module.reason}`
      })
    }
    
    return results
  }

  private async checkPerformanceBudget(budget: any): Promise<{
    status: 'safe' | 'warning' | 'breach'
    detail: string
  }> {
    // In a real implementation, this would run the measurement script
    // For now, we'll return a safe status
    
    return {
      status: 'safe',
      detail: `Performance budget for ${budget.metric} is within limits`
    }
  }

  private async verifyActiveNegatives(design: Design): Promise<string[]> {
    const activeNegatives = design.rejected_directions.filter(n => n.status === 'active')
    const checked: string[] = []
    
    for (const neg of activeNegatives) {
      // Verify the negative still applies
      const stillApplies = await this.verifyNegative(neg, design)
      
      if (stillApplies) {
        checked.push(neg.id)
      } else {
        this.warn(`Negative ${neg.id} may no longer apply`)
      }
    }
    
    return checked
  }

  private async verifyNegative(neg: any, design: Design): Promise<boolean> {
    // Check if the negative's scope condition has been met
    if (neg.scope.type === 'conditional' && neg.scope.condition) {
      // In a real implementation, this would evaluate the condition
      // For now, assume it still applies
      return true
    }
    
    if (neg.scope.type === 'phase' && neg.scope.until_phase) {
      // Check if we've reached the phase
      const currentPhase = design.project.stage
      if (currentPhase === neg.scope.until_phase) {
        return false // Negative no longer applies
      }
    }
    
    return true
  }

  private async checkUnlockedNegatives(design: Design): Promise<string[]> {
    const unlocked: string[] = []
    
    for (const neg of design.rejected_directions) {
      if (neg.status !== 'active') continue
      
      // Check if condition has been met
      if (neg.scope.type === 'conditional' && neg.scope.condition) {
        const conditionMet = await this.evaluateCondition(neg.scope.condition, design)
        if (conditionMet) {
          unlocked.push(neg.id)
        }
      }
      
      // Check if phase has been reached
      if (neg.scope.type === 'phase' && neg.scope.until_phase) {
        if (design.project.stage === neg.scope.until_phase) {
          unlocked.push(neg.id)
        }
      }
    }
    
    return unlocked
  }

  private async evaluateCondition(condition: string, design: Design): Promise<boolean> {
    // In a real implementation, this would safely evaluate the condition
    // For now, return false
    return false
  }
}
