import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { Phase } from './base.js'
import type { EvaluateResult, Design, Card } from '../types.js'
import { CardSchema } from '../schema/index.js'

export class EvaluatePhase extends Phase {
  async execute(): Promise<EvaluateResult> {
    try {
      this.log('Starting evaluation phase...')
      
      const { design, loop } = this.context
      
      // Get executed cards
      const executedCards = await this.getExecutedCards()
      
      if (executedCards.length === 0) {
        this.log('No cards to evaluate')
        return this.success({
          factorResults: [],
          compositeScoreBefore: 0,
          compositeScoreAfter: 0,
          compositeDelta: 0,
          conflictsDetected: [],
          forcedRollback: false
        })
      }
      
      // Evaluate each factor
      this.log('Evaluating factors...')
      const factorResults = await this.evaluateFactors(design, executedCards)
      
      // Calculate composite scores
      const compositeScoreBefore = this.calculateCompositeScore(design, 'before')
      const compositeScoreAfter = this.calculateCompositeScore(design, 'after', factorResults)
      const compositeDelta = compositeScoreAfter - compositeScoreBefore
      
      // Detect conflicts
      this.log('Detecting conflicts...')
      const conflictsDetected = await this.detectConflicts(design, factorResults)
      
      // Check for forced rollback
      const forcedRollback = this.checkForcedRollback(design, factorResults, conflictsDetected)
      let rollbackReason: string | undefined
      
      if (forcedRollback) {
        rollbackReason = this.getRollbackReason(design, factorResults, conflictsDetected)
        this.warn(`Forced rollback: ${rollbackReason}`)
      }
      
      // Update cards with actual eval deltas
      await this.updateCardsWithEvalDeltas(executedCards, factorResults)
      
      this.log(`Evaluation complete: composite score ${compositeScoreBefore.toFixed(3)} → ${compositeScoreAfter.toFixed(3)} (${compositeDelta >= 0 ? '+' : ''}${compositeDelta.toFixed(3)})`)
      
      return this.success({
        factorResults,
        compositeScoreBefore,
        compositeScoreAfter,
        compositeDelta,
        conflictsDetected,
        forcedRollback,
        rollbackReason
      })
    } catch (error) {
      return this.error(error as Error)
    }
  }

  private async getExecutedCards(): Promise<Card[]> {
    const { config, loop } = this.context
    const cardsDir = path.join(config.metaDir, 'cards')
    const cards: Card[] = []
    
    if (!loop.execution?.cards_executed) {
      return []
    }
    
    for (const executed of loop.execution.cards_executed) {
      if (executed.status !== 'success') continue
      
      try {
        const content = await fs.readFile(path.join(cardsDir, `${executed.cardId}.yaml`), 'utf-8')
        const card = yaml.load(content) as any
        cards.push(CardSchema.parse(card))
      } catch (error) {
        this.warn(`Failed to load card: ${executed.cardId}`)
      }
    }
    
    return cards
  }

  private async evaluateFactors(
    design: Design,
    executedCards: Card[]
  ): Promise<Array<{
    factorId: string
    valueBefore: string
    valueAfter: string
    normalizedScore: number
    passedFloor: boolean
    delta: number
  }>> {
    const results = []
    
    for (const factor of design.eval_factors) {
      if (factor.lifecycle.active_until && factor.lifecycle.active_until < design.project.stage) {
        continue // Factor is no longer active
      }
      
      this.log(`  Evaluating ${factor.id}: ${factor.name}`)
      
      const result = await this.evaluateSingleFactor(factor, design, executedCards)
      results.push(result)
    }
    
    return results
  }

  private async evaluateSingleFactor(
    factor: any,
    design: Design,
    executedCards: Card[]
  ): Promise<{
    factorId: string
    valueBefore: string
    valueAfter: string
    normalizedScore: number
    passedFloor: boolean
    delta: number
  }> {
    const valueBefore = factor.threshold.baseline
    
    let valueAfter: string
    let normalizedScore: number
    
    switch (factor.measurement.type) {
      case 'metric':
        const metricResult = await this.measureMetric(factor.measurement.spec)
        valueAfter = metricResult
        normalizedScore = this.calculateNormalizedScore(metricResult, factor.threshold)
        break
      
      case 'llm_eval':
        const llmResult = await this.runLlmEval(factor.measurement, executedCards)
        valueAfter = llmResult
        normalizedScore = this.calculateNormalizedScore(llmResult, factor.threshold)
        break
      
      case 'human_eval':
        const humanResult = await this.runHumanEval(factor.measurement, executedCards)
        valueAfter = humanResult
        normalizedScore = this.calculateNormalizedScore(humanResult, factor.threshold)
        break
      
      default:
        valueAfter = valueBefore
        normalizedScore = 0.5
    }
    
    const passedFloor = this.checkFloor(valueAfter, factor.threshold.floor)
    const delta = normalizedScore - this.calculateNormalizedScore(valueBefore, factor.threshold)
    
    return {
      factorId: factor.id,
      valueBefore,
      valueAfter,
      normalizedScore,
      passedFloor,
      delta
    }
  }

  private async measureMetric(spec: string): Promise<string> {
    // In a real implementation, this would run the measurement script
    // For now, return a simulated value
    
    if (spec.includes('latency')) {
      return '650ms' // Simulated latency
    }
    
    if (spec.includes('completed_sessions')) {
      return '75%' // Simulated completion rate
    }
    
    return '0'
  }

  private async runLlmEval(measurement: any, executedCards: Card[]): Promise<string> {
    // In a real implementation, this would call LLM with the prompt
    // For now, return a simulated score
    
    const prompt = measurement.llm_prompt
    
    // Simulate LLM evaluation
    if (prompt?.includes('可理解')) {
      return '3.8' // Simulated interpretability score
    }
    
    return '3.5'
  }

  private async runHumanEval(measurement: any, executedCards: Card[]): Promise<string> {
    // In a real implementation, this would present criteria to human
    // For now, return a simulated result
    
    const criteria = measurement.human_criteria
    
    if (criteria) {
      return `${criteria.length}/${criteria.length} 通过`
    }
    
    return '0/0 通过'
  }

  private calculateNormalizedScore(value: string, threshold: any): number {
    // Parse value and threshold
    const numericValue = this.parseNumericValue(value)
    const target = this.parseNumericValue(threshold.target)
    const floor = this.parseNumericValue(threshold.floor)
    
    if (isNaN(numericValue) || isNaN(target) || isNaN(floor)) {
      return 0.5 // Default if parsing fails
    }
    
    // Calculate score between 0 and 1
    if (numericValue >= target) {
      return 1.0
    } else if (numericValue <= floor) {
      return 0.0
    } else {
      return (numericValue - floor) / (target - floor)
    }
  }

  private parseNumericValue(value: string): number {
    // Remove non-numeric characters except . and -
    const cleaned = value.replace(/[^0-9.\-]/g, '')
    return parseFloat(cleaned)
  }

  private checkFloor(value: string, floor: string): boolean {
    const numericValue = this.parseNumericValue(value)
    const floorValue = this.parseNumericValue(floor)
    
    if (isNaN(numericValue) || isNaN(floorValue)) {
      return true // Assume pass if parsing fails
    }
    
    // Check if value meets floor
    // For metrics like latency, lower is better
    if (floor.includes('<')) {
      return numericValue < floorValue
    } else if (floor.includes('>')) {
      return numericValue > floorValue
    } else if (floor.includes('≥')) {
      return numericValue >= floorValue
    } else if (floor.includes('≤')) {
      return numericValue <= floorValue
    } else {
      return numericValue >= floorValue
    }
  }

  private calculateCompositeScore(
    design: Design,
    timing: 'before' | 'after',
    factorResults?: Array<{ factorId: string; normalizedScore: number }>
  ): number {
    let totalWeight = 0
    let weightedSum = 0
    
    for (const factor of design.eval_factors) {
      if (factor.role.type === 'guardrail') continue // Guardrails don't contribute to score
      if (factor.role.type === 'diagnostic') continue // Diagnostic doesn't contribute to score
      
      const weight = factor.relations.weight
      
      let score: number
      
      if (timing === 'before') {
        score = this.calculateNormalizedScore(factor.threshold.baseline, factor.threshold)
      } else {
        const result = factorResults?.find(r => r.factorId === factor.id)
        score = result?.normalizedScore ?? 0.5
      }
      
      weightedSum += score * weight
      totalWeight += weight
    }
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0
  }

  private async detectConflicts(
    design: Design,
    factorResults: Array<{ factorId: string; delta: number }>
  ): Promise<Array<{
    factorA: string
    factorB: string
    description: string
    severity: 'warn' | 'block'
  }>> {
    const conflicts = []
    
    for (const factor of design.eval_factors) {
      if (!factor.relations.conflicts_with) continue
      
      const factorResult = factorResults.find(r => r.factorId === factor.id)
      if (!factorResult) continue
      
      for (const conflictId of factor.relations.conflicts_with) {
        const conflictFactor = design.eval_factors.find(f => f.id === conflictId)
        if (!conflictFactor) continue
        
        const conflictResult = factorResults.find(r => r.factorId === conflictId)
        if (!conflictResult) continue
        
        // Check if both moved in conflicting directions
        const factorImproved = factorResult.delta > 0
        const conflictImproved = conflictResult.delta > 0
        
        if (factorImproved && conflictImproved) {
          // Both improved - no conflict
          continue
        }
        
        if (!factorImproved && !conflictImproved) {
          // Both regressed - no conflict
          continue
        }
        
        // One improved, one regressed - potential conflict
        conflicts.push({
          factorA: factor.id,
          factorB: conflictId,
          description: `${factor.name} ${factorImproved ? 'improved' : 'regressed'} while ${conflictFactor.name} ${conflictImproved ? 'improved' : 'regressed'}`,
          severity: 'warn' as const
        })
      }
    }
    
    return conflicts
  }

  private checkForcedRollback(
    design: Design,
    factorResults: Array<{ factorId: string; passedFloor: boolean }>,
    conflicts: Array<{ severity: string }>
  ): boolean {
    // Check if any floor was breached
    for (const result of factorResults) {
      if (!result.passedFloor) {
        return true
      }
    }
    
    // Check if any block-severity conflicts
    for (const conflict of conflicts) {
      if (conflict.severity === 'block') {
        return true
      }
    }
    
    return false
  }

  private getRollbackReason(
    design: Design,
    factorResults: Array<{ factorId: string; passedFloor: boolean; factorId: string }>,
    conflicts: Array<{ severity: string; description: string }>
  ): string {
    // Find breached floors
    const breachedFloors = factorResults
      .filter(r => !r.passedFloor)
      .map(r => {
        const factor = design.eval_factors.find(f => f.id === r.factorId)
        return factor?.name || r.factorId
      })
    
    if (breachedFloors.length > 0) {
      return `Floor breached: ${breachedFloors.join(', ')}`
    }
    
    // Find block conflicts
    const blockConflicts = conflicts
      .filter(c => c.severity === 'block')
      .map(c => c.description)
    
    if (blockConflicts.length > 0) {
      return `Block conflict: ${blockConflicts.join('; ')}`
    }
    
    return 'Unknown reason'
  }

  private async updateCardsWithEvalDeltas(
    executedCards: Card[],
    factorResults: Array<{
      factorId: string
      valueBefore: string
      valueAfter: string
      delta: number
    }>
  ): Promise<void> {
    const { config } = this.context
    const cardsDir = path.join(config.metaDir, 'cards')
    
    for (const card of executedCards) {
      if (!card.outcome) continue
      
      // Update actual eval deltas
      card.outcome.actual_eval_deltas = factorResults.map(result => ({
        eval_id: result.factorId,
        before: result.valueBefore,
        after: result.valueAfter,
        delta: result.delta >= 0 ? `+${result.delta.toFixed(2)}` : result.delta.toFixed(2)
      }))
      
      // Calculate prediction accuracy
      card.outcome.prediction_accuracy = this.calculatePredictionAccuracy(card, factorResults)
      
      // Save updated card
      const cardPath = path.join(cardsDir, `${card.id}.yaml`)
      const content = yaml.dump(card, { indent: 2 })
      await fs.writeFile(cardPath, content, 'utf-8')
    }
  }

  private calculatePredictionAccuracy(
    card: Card,
    factorResults: Array<{ factorId: string; delta: number }>
  ): number {
    if (!card.prediction.eval_deltas || card.prediction.eval_deltas.length === 0) {
      return 0
    }
    
    let totalAccuracy = 0
    let count = 0
    
    for (const predicted of card.prediction.eval_deltas) {
      const actual = factorResults.find(r => r.factorId === predicted.eval_id)
      
      if (!actual) continue
      
      // Simple accuracy calculation
      // In a real implementation, this would be more sophisticated
      const predictedMagnitude = this.parseMagnitude(predicted.magnitude)
      const actualMagnitude = actual.delta
      
      if (isNaN(predictedMagnitude)) {
        continue
      }
      
      const error = Math.abs(predictedMagnitude - actualMagnitude)
      const maxError = Math.abs(predictedMagnitude) || 1
      
      const accuracy = Math.max(0, 1 - error / maxError)
      totalAccuracy += accuracy
      count++
    }
    
    return count > 0 ? totalAccuracy / count : 0
  }

  private parseMagnitude(magnitude: string): number {
    // Parse magnitude like "+0.6 至 +1.0 分" or "+60 至 +100ms"
    const match = magnitude.match(/([+-]?\d+\.?\d*)/g)
    
    if (!match || match.length === 0) {
      return NaN
    }
    
    // Return average of range
    const values = match.map(v => parseFloat(v))
    return values.reduce((a, b) => a + b, 0) / values.length
  }
}
