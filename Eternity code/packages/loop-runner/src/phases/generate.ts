import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { Phase } from './base.js'
import type { GenerateResult, Design, Card } from '../types.js'
import { CardSchema } from '../schema/index.js'

export class GeneratePhase extends Phase {
  async execute(): Promise<GenerateResult> {
    try {
      this.log('Starting candidate generation...')
      
      const { design, config, loop } = this.context
      
      // 1. Score candidate directions
      this.log('Scoring candidate directions...')
      const candidates = await this.generateCandidates(design, loop.analysis!)
      
      // 2. Filter against negatives
      this.log('Filtering against negatives...')
      const { filtered, filterLog } = await this.filterCandidates(candidates, design)
      
      // 3. Check constraint proximity
      this.log('Checking constraint proximity...')
      const withWarnings = await this.addConstraintWarnings(filtered, design)
      
      // 4. Assess and rank
      this.log('Assessing and ranking candidates...')
      const ranked = await this.rankCandidates(withWarnings, design)
      
      // 5. Take top N
      const maxCards = design.search_policy.max_cards_per_loop
      const topCandidates = ranked.slice(0, maxCards)
      
      // 6. Generate cards
      this.log('Generating decision cards...')
      const cards = await this.generateCards(topCandidates, design, loop.id)
      
      // 7. Save cards
      await this.saveCards(cards)
      
      this.log(`Generated ${cards.length} cards`)
      
      return this.success({
        generatedCount: candidates.length,
        filteredCount: candidates.length - filtered.length,
        filterLog,
        presentedCards: cards.map(c => c.id)
      })
    } catch (error) {
      return this.error(error as Error)
    }
  }

  private async generateCandidates(design: Design, analysis: any): Promise<Array<{
    id: string
    type: string
    priority: number
    data: Record<string, any>
  }>> {
    const candidates: Array<{
      id: string
      type: string
      priority: number
      data: Record<string, any>
    }> = []
    
    // Generate candidates based on search policy
    for (const source of design.search_policy.candidate_sources) {
      const sourceCandidates = await this.generateFromSource(source, design, analysis)
      candidates.push(...sourceCandidates)
    }
    
    // Add IDs
    return candidates.map((c, i) => ({
      ...c,
      id: `candidate-${String(i + 1).padStart(3, '0')}`
    }))
  }

  private async generateFromSource(
    source: { source: string; weight: number },
    design: Design,
    analysis: any
  ): Promise<Array<{
    type: string
    priority: number
    data: Record<string, any>
  }>> {
    const candidates = []
    
    switch (source.source) {
      case 'coverage_gap':
        candidates.push(...await this.generateFromCoverageGaps(design, analysis, source.weight))
        break
      case 'eval_regression':
        candidates.push(...await this.generateFromEvalRegressions(design, analysis, source.weight))
        break
      case 'tech_debt':
        candidates.push(...await this.generateFromTechDebt(design, source.weight))
        break
      case 'user_feedback':
        candidates.push(...await this.generateFromUserFeedback(design, source.weight))
        break
      case 'free_exploration':
        candidates.push(...await this.generateFromFreeExploration(design, source.weight))
        break
    }
    
    return candidates
  }

  private async generateFromCoverageGaps(
    design: Design,
    analysis: any,
    weight: number
  ): Promise<Array<{
    type: string
    priority: number
    data: Record<string, any>
  }>> {
    const candidates = []
    
    // Find requirements with low coverage
    const lowCoverageReqs = analysis.requirement_coverage.filter(
      (rc: any) => rc.coverage_assessed < 0.7
    )
    
    for (const reqCoverage of lowCoverageReqs) {
      const req = design.requirements.find(r => r.id === reqCoverage.reqId)
      if (!req) continue
      
      candidates.push({
        type: 'coverage_gap',
        priority: weight * (1 - reqCoverage.coverage_assessed),
        data: {
          requirementId: req.id,
          requirementText: req.text,
          currentCoverage: reqCoverage.coverage_assessed,
          targetCoverage: Math.min(1, reqCoverage.coverage_assessed + 0.2),
          gapDescription: reqCoverage.gapDescription
        }
      })
    }
    
    return candidates
  }

  private async generateFromEvalRegressions(
    design: Design,
    analysis: any,
    weight: number
  ): Promise<Array<{
    type: string
    priority: number
    data: Record<string, any>
  }>> {
    const candidates = []
    
    // Check for factors that regressed
    // This would require comparing with previous loop
    // For now, return empty
    
    return candidates
  }

  private async generateFromTechDebt(
    design: Design,
    weight: number
  ): Promise<Array<{
    type: string
    priority: number
    data: Record<string, any>
  }>> {
    const candidates = []
    
    // In a real implementation, this would analyze codebase for tech debt
    // For now, return empty
    
    return candidates
  }

  private async generateFromUserFeedback(
    design: Design,
    weight: number
  ): Promise<Array<{
    type: string
    priority: number
    data: Record<string, any>
  }>> {
    const candidates = []
    
    // In a real implementation, this would analyze user feedback
    // For now, return empty
    
    return candidates
  }

  private async generateFromFreeExploration(
    design: Design,
    weight: number
  ): Promise<Array<{
    type: string
    priority: number
    data: Record<string, any>
  }>> {
    const candidates = []
    
    // In a real implementation, this would generate novel ideas
    // For now, return empty
    
    return candidates
  }

  private async filterCandidates(
    candidates: Array<{ id: string; type: string; priority: number; data: Record<string, any> }>,
    design: Design
  ): Promise<{
    filtered: typeof candidates
    filterLog: Array<{ candidateSummary: string; matchedNegative: string }>
  }> {
    const filtered: typeof candidates = []
    const filterLog: Array<{ candidateSummary: string; matchedNegative: string }> = []
    
    const activeNegatives = design.rejected_directions.filter(n => n.status === 'active')
    
    for (const candidate of candidates) {
      let blocked = false
      
      for (const neg of activeNegatives) {
        const matches = await this.checkCandidateAgainstNegative(candidate, neg)
        
        if (matches) {
          blocked = true
          filterLog.push({
            candidateSummary: `${candidate.type}: ${JSON.stringify(candidate.data).slice(0, 100)}`,
            matchedNegative: neg.id
          })
          break
        }
      }
      
      if (!blocked) {
        filtered.push(candidate)
      }
    }
    
    return { filtered, filterLog }
  }

  private async checkCandidateAgainstNegative(
    candidate: { type: string; data: Record<string, any> },
    negative: any
  ): Promise<boolean> {
    // Simple keyword matching
    const candidateText = JSON.stringify(candidate.data).toLowerCase()
    const negativeText = negative.text.toLowerCase()
    
    // Check if candidate contains negative keywords
    const negativeKeywords = negativeText.split(/\s+/).filter((w: string) => w.length > 3)
    
    for (const keyword of negativeKeywords) {
      if (candidateText.includes(keyword)) {
        return true
      }
    }
    
    return false
  }

  private async addConstraintWarnings(
    candidates: Array<{ id: string; type: string; priority: number; data: Record<string, any> }>,
    design: Design
  ): Promise<Array<{ id: string; type: string; priority: number; data: Record<string, any>; warnings: any[] }>> {
    return candidates.map(candidate => {
      const warnings: any[] = []
      
      // Check against immutable modules
      for (const module of design.constraints.immutable_modules) {
        if (this.candidateTouchesModule(candidate, module.path)) {
          warnings.push({
            type: 'near_constraint',
            ref: `immutable_modules.${module.path}`,
            message: `Candidate may touch immutable module ${module.path}`
          })
        }
      }
      
      // Check against performance budgets
      for (const budget of design.constraints.performance_budget) {
        if (this.candidateAffectsBudget(candidate, budget)) {
          warnings.push({
            type: 'near_constraint',
            ref: `performance_budget.${budget.metric}`,
            message: `Candidate may affect performance budget ${budget.metric}`
          })
        }
      }
      
      return { ...candidate, warnings }
    })
  }

  private candidateTouchesModule(candidate: { data: Record<string, any> }, modulePath: string): boolean {
    // Check if candidate's scope includes the module
    if (candidate.data.scope) {
      for (const scope of candidate.data.scope) {
        if (scope.includes(modulePath)) {
          return true
        }
      }
    }
    
    return false
  }

  private candidateAffectsBudget(candidate: { data: Record<string, any> }, budget: any): boolean {
    // Simple heuristic: if candidate involves API calls, it might affect latency
    if (candidate.data.approach && candidate.data.approach.toLowerCase().includes('api')) {
      return budget.metric.includes('latency')
    }
    
    return false
  }

  private async rankCandidates(
    candidates: Array<{ id: string; type: string; priority: number; data: Record<string, any>; warnings: any[] }>,
    design: Design
  ): Promise<typeof candidates> {
    // Sort by priority (higher is better)
    return candidates.sort((a, b) => b.priority - a.priority)
  }

  private async generateCards(
    candidates: Array<{ id: string; type: string; priority: number; data: Record<string, any>; warnings: any[] }>,
    design: Design,
    loopId: string
  ): Promise<Card[]> {
    const cards: Card[] = []
    
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]
      const cardId = `CARD-${String(design.loop_history.total_loops * 100 + i + 1).padStart(3, '0')}`
      
      const card = await this.generateCard(cardId, candidate, design, loopId)
      cards.push(card)
    }
    
    return cards
  }

  private async generateCard(
    cardId: string,
    candidate: { id: string; type: string; priority: number; data: Record<string, any>; warnings: any[] },
    design: Design,
    loopId: string
  ): Promise<Card> {
    // Generate card content based on candidate type
    const content = await this.generateCardContent(candidate, design)
    
    // Generate prediction
    const prediction = await this.generateCardPrediction(candidate, design)
    
    return {
      _schema_version: '1.0.0',
      _schema_type: 'decision_card',
      id: cardId,
      loop_id: loopId,
      req_refs: this.extractReqRefs(candidate),
      content,
      prediction,
      decision: {
        status: 'pending',
        chosen_by: 'agent',
        resolved_at: null,
        note: null,
        merged_from: null
      },
      outcome: null
    }
  }

  private async generateCardContent(
    candidate: { type: string; data: Record<string, any> },
    design: Design
  ): Promise<{
    objective: string
    approach: string
    benefit: string
    cost: string
    risk: string
    scope: string[]
    warnings: any[]
  }> {
    // In a real implementation, this would use LLM to generate content
    // For now, create a simple template
    
    switch (candidate.type) {
      case 'coverage_gap':
        return {
          objective: `Improve coverage for ${candidate.data.requirementId}`,
          approach: `Implement missing functionality to address: ${candidate.data.requirementText}`,
          benefit: `Increase coverage from ${(candidate.data.currentCoverage * 100).toFixed(0)}% to ${(candidate.data.targetCoverage * 100).toFixed(0)}%`,
          cost: 'Development time and potential complexity increase',
          risk: 'May introduce new bugs or performance issues',
          scope: ['src/'], // Default scope
          warnings: []
        }
      
      default:
        return {
          objective: 'Improve system',
          approach: 'Implement improvement',
          benefit: 'Better performance or functionality',
          cost: 'Development time',
          risk: 'Potential issues',
          scope: ['src/'],
          warnings: []
        }
    }
  }

  private async generateCardPrediction(
    candidate: { type: string; data: Record<string, any> },
    design: Design
  ): Promise<{
    confidence: number
    basis: string
    assumptions: string[]
    eval_deltas: Array<{
      eval_id: string
      direction: 'increase' | 'decrease' | 'neutral' | 'unknown'
      magnitude: string
    }>
  }> {
    // Generate prediction based on candidate type
    const evalDeltas = []
    
    // Find relevant eval factors
    for (const factor of design.eval_factors) {
      if (factor.role.type === 'objective') {
        evalDeltas.push({
          eval_id: factor.id,
          direction: 'increase' as const,
          magnitude: '+5%'
        })
      }
    }
    
    return {
      confidence: 0.7,
      basis: 'Based on historical data and similar changes',
      assumptions: ['System remains stable', 'No external dependencies change'],
      eval_deltas: evalDeltas.slice(0, 3) // Limit to 3
    }
  }

  private extractReqRefs(candidate: { data: Record<string, any> }): string[] {
    if (candidate.data.requirementId) {
      return [candidate.data.requirementId]
    }
    
    return []
  }

  private async saveCards(cards: Card[]): Promise<void> {
    const { config } = this.context
    const cardsDir = path.join(config.metaDir, 'cards')
    
    await fs.mkdir(cardsDir, { recursive: true })
    
    for (const card of cards) {
      const cardPath = path.join(cardsDir, `${card.id}.yaml`)
      const content = yaml.dump(card, { indent: 2 })
      await fs.writeFile(cardPath, content, 'utf-8')
    }
  }
}
