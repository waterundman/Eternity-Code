import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { Phase } from './base.js'
import type { ExecuteResult, Card, Design } from '../types.js'
import { CardSchema } from '../schema/index.js'

export class ExecutePhase extends Phase {
  async execute(): Promise<ExecuteResult> {
    try {
      this.log('Starting execution phase...')
      
      const { config, design, loop } = this.context
      
      // Get accepted cards
      const acceptedCards = await this.getAcceptedCards()
      
      if (acceptedCards.length === 0) {
        this.log('No cards to execute')
        return this.success({
          cardsExecuted: [],
          totalFilesModified: 0,
          gitShaBefore: await this.getGitSha()
        })
      }
      
      // Create git branch
      const branchName = `${config.git.branchPrefix}${loop.id}`
      await this.createGitBranch(branchName)
      
      const gitShaBefore = await this.getGitSha()
      
      // Execute cards in dependency order
      const cardsExecuted = []
      let totalFilesModified = 0
      
      for (const card of acceptedCards) {
        this.log(`Executing card: ${card.id}`)
        
        const result = await this.executeCard(card, design)
        
        cardsExecuted.push({
          cardId: card.id,
          status: result.status,
          filesModified: result.filesModified,
          gitShaAfter: result.status === 'success' ? await this.getGitSha() : undefined,
          error: result.error
        })
        
        totalFilesModified += result.filesModified.length
        
        // Update card with outcome
        await this.updateCardOutcome(card, result)
        
        if (result.status === 'rolled_back') {
          this.warn(`Card ${card.id} caused rollback`)
          break
        }
      }
      
      // Check performance budgets
      const budgetBreach = await this.checkPerformanceBudgets(design)
      
      if (budgetBreach) {
        this.warn('Performance budget breached, rolling back')
        await this.rollbackGitBranch(branchName)
        
        return this.success({
          cardsExecuted: cardsExecuted.map(c => ({
            ...c,
            status: 'rolled_back' as const
          })),
          totalFilesModified,
          gitShaBefore,
          gitShaAfter: undefined
        })
      }
      
      // Commit changes
      await this.commitChanges(`Loop ${loop.id}: Execute accepted cards`)
      
      const gitShaAfter = await this.getGitSha()
      
      this.log(`Execution complete: ${cardsExecuted.length} cards executed, ${totalFilesModified} files modified`)
      
      return this.success({
        cardsExecuted,
        totalFilesModified,
        gitShaBefore,
        gitShaAfter
      })
    } catch (error) {
      return this.error(error as Error)
    }
  }

  private async getAcceptedCards(): Promise<Card[]> {
    const { config, loop } = this.context
    const cardsDir = path.join(config.metaDir, 'cards')
    const cards: Card[] = []
    
    if (!loop.decision_session?.accepted_cards) {
      return []
    }
    
    for (const cardId of loop.decision_session.accepted_cards) {
      try {
        const content = await fs.readFile(path.join(cardsDir, `${cardId}.yaml`), 'utf-8')
        const card = yaml.load(content) as any
        cards.push(CardSchema.parse(card))
      } catch (error) {
        this.warn(`Failed to load card: ${cardId}`)
      }
    }
    
    return cards
  }

  private async createGitBranch(branchName: string): Promise<void> {
    const { config } = this.context
    
    try {
      const { execSync } = await import('child_process')
      
      // Check if branch already exists
      try {
        execSync(`git rev-parse --verify ${branchName}`, {
          cwd: config.projectRoot,
          encoding: 'utf-8'
        })
        // Branch exists, switch to it
        execSync(`git checkout ${branchName}`, {
          cwd: config.projectRoot,
          encoding: 'utf-8'
        })
      } catch {
        // Branch doesn't exist, create it
        execSync(`git checkout -b ${branchName}`, {
          cwd: config.projectRoot,
          encoding: 'utf-8'
        })
      }
      
      this.log(`On branch: ${branchName}`)
    } catch (error) {
      throw new Error(`Failed to create git branch: ${error}`)
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

  private async executeCard(card: Card, design: Design): Promise<{
    status: 'success' | 'failed' | 'rolled_back'
    filesModified: string[]
    error?: string
  }> {
    try {
      this.log(`  Implementing: ${card.content.objective}`)
      
      // In a real implementation, this would:
      // 1. Use LLM to generate code changes
      // 2. Apply changes to files
      // 3. Run linter/type-checker
      
      // For now, simulate execution
      const filesModified: string[] = []
      
      // Check if card scope includes actual files
      for (const scope of card.content.scope) {
        const scopePath = path.join(this.context.config.projectRoot, scope)
        
        try {
          const stat = await fs.stat(scopePath)
          
          if (stat.isFile()) {
            // Simulate file modification
            filesModified.push(scope)
          } else if (stat.isDirectory()) {
            // Simulate directory modification
            filesModified.push(scope)
          }
        } catch {
          // File doesn't exist, might need to create it
          filesModified.push(scope)
        }
      }
      
      // Run linter (simulated)
      await this.runLinter()
      
      return {
        status: 'success',
        filesModified
      }
    } catch (error) {
      return {
        status: 'failed',
        filesModified: [],
        error: (error as Error).message
      }
    }
  }

  private async runLinter(): Promise<void> {
    // In a real implementation, this would run ESLint, TypeScript checker, etc.
    // For now, just log
    this.log('  Running linter/type-checker...')
  }

  private async checkPerformanceBudgets(design: Design): Promise<boolean> {
    const { config } = this.context
    
    for (const budget of design.constraints.performance_budget) {
      if (!budget.hard) continue
      
      this.log(`  Checking budget: ${budget.metric}`)
      
      // In a real implementation, this would run the measurement script
      // For now, simulate success
      
      // Example measurement script execution:
      // const result = await this.runMeasurementScript(budget.measurement_spec)
      // if (!this.meetsThreshold(result, budget.threshold)) {
      //   return true // Budget breached
      // }
    }
    
    return false
  }

  private async runMeasurementScript(script: string): Promise<string> {
    // In a real implementation, this would execute the script
    // For now, return dummy data
    return '0'
  }

  private meetsThreshold(value: string, threshold: string): boolean {
    // Parse threshold (e.g., "< 800ms", "≥ 60%")
    // For now, return true
    return true
  }

  private async rollbackGitBranch(branchName: string): Promise<void> {
    const { config } = this.context
    
    try {
      const { execSync } = await import('child_process')
      
      // Switch back to main branch
      execSync(`git checkout ${config.git.defaultBranch}`, {
        cwd: config.projectRoot,
        encoding: 'utf-8'
      })
      
      // Delete the branch
      execSync(`git branch -D ${branchName}`, {
        cwd: config.projectRoot,
        encoding: 'utf-8'
      })
      
      this.log(`Rolled back branch: ${branchName}`)
    } catch (error) {
      this.errorLog(`Failed to rollback branch: ${error}`)
    }
  }

  private async commitChanges(message: string): Promise<void> {
    const { config } = this.context
    
    try {
      const { execSync } = await import('child_process')
      
      // Stage all changes
      execSync('git add -A', {
        cwd: config.projectRoot,
        encoding: 'utf-8'
      })
      
      // Commit
      execSync(`git commit -m "${message}"`, {
        cwd: config.projectRoot,
        encoding: 'utf-8'
      })
      
      this.log('Changes committed')
    } catch (error) {
      // No changes to commit is okay
      if (!(error as any).message?.includes('nothing to commit')) {
        this.warn(`Failed to commit: ${error}`)
      }
    }
  }

  private async updateCardOutcome(
    card: Card,
    result: {
      status: 'success' | 'failed' | 'rolled_back'
      filesModified: string[]
      error?: string
    }
  ): Promise<void> {
    const { config } = this.context
    const cardsDir = path.join(config.metaDir, 'cards')
    
    if (result.status === 'success') {
      card.outcome = {
        status: 'success',
        actual_eval_deltas: [], // Will be filled in EVALUATE phase
        prediction_accuracy: 0,
        deviation_explanation: '',
        lessons: [],
        constraint_breaches: [],
        committed_at: new Date().toISOString()
      }
    } else if (result.status === 'failed') {
      card.outcome = {
        status: 'rolled_back',
        actual_eval_deltas: [],
        prediction_accuracy: 0,
        deviation_explanation: result.error || 'Execution failed',
        lessons: [`Execution failed: ${result.error}`],
        constraint_breaches: [],
        committed_at: null
      }
    }
    
    // Save updated card
    const cardPath = path.join(cardsDir, `${card.id}.yaml`)
    const content = yaml.dump(card, { indent: 2 })
    await fs.writeFile(cardPath, content, 'utf-8')
  }
}
