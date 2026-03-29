import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { Phase } from './base.js'
import type { DecideResult, Card, Negative } from '../types.js'
import { CardSchema, NegativeSchema } from '../schema/index.js'

export class DecidePhase extends Phase {
  async execute(): Promise<DecideResult> {
    try {
      this.log('Starting decision phase...')
      
      const { config, design, loop } = this.context
      
      // Load cards
      const cards = await this.loadCards(loop.candidates!.presented_cards)
      
      if (cards.length === 0) {
        this.log('No cards to decide on')
        return this.success({
          acceptedCards: [],
          rejectedCards: [],
          skippedCards: [],
          newNegativesWritten: []
        })
      }
      
      // Display cards
      this.displayCards(cards)
      
      // Get decisions
      const decisions = await this.getDecisions(cards)
      
      // Process rejections
      const newNegatives = await this.processRejections(decisions.rejectedCards, design)
      
      // Update cards with decisions
      await this.updateCardsWithDecisions(cards, decisions)
      
      this.log(`Decision complete: ${decisions.acceptedCards.length} accepted, ${decisions.rejectedCards.length} rejected`)
      
      return this.success({
        acceptedCards: decisions.acceptedCards,
        rejectedCards: decisions.rejectedCards,
        skippedCards: decisions.skippedCards,
        newNegativesWritten: newNegatives.map(n => n.id),
        directionOverride: decisions.directionOverride
      })
    } catch (error) {
      return this.error(error as Error)
    }
  }

  private async loadCards(cardIds: string[]): Promise<Card[]> {
    const { config } = this.context
    const cardsDir = path.join(config.metaDir, 'cards')
    const cards: Card[] = []
    
    for (const cardId of cardIds) {
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

  private displayCards(cards: Card[]): void {
    console.log('\n📋 Decision Cards:')
    console.log('='.repeat(80))
    
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i]
      console.log(`\n[${i + 1}] ${card.id}`)
      console.log(`  Objective: ${card.content.objective}`)
      console.log(`  Approach: ${card.content.approach.slice(0, 100)}...`)
      console.log(`  Benefit: ${card.content.benefit}`)
      console.log(`  Cost: ${card.content.cost}`)
      console.log(`  Risk: ${card.content.risk}`)
      console.log(`  Confidence: ${(card.prediction.confidence * 100).toFixed(0)}%`)
      
      if (card.content.warnings.length > 0) {
        console.log('  ⚠️  Warnings:')
        for (const warning of card.content.warnings) {
          console.log(`    - ${warning.message}`)
        }
      }
      
      console.log('  Scope:', card.content.scope.join(', '))
    }
    
    console.log('\n' + '='.repeat(80))
  }

  private async getDecisions(cards: Card[]): Promise<{
    acceptedCards: string[]
    rejectedCards: Array<{ id: string; note: string }>
    skippedCards: string[]
    directionOverride?: string
  }> {
    // In a real implementation, this would use TUI (Ink) for interactive decisions
    // For now, we'll use a simple CLI prompt
    
    const acceptedCards: string[] = []
    const rejectedCards: Array<{ id: string; note: string }> = []
    const skippedCards: string[] = []
    
    console.log('\n🎯 Decision Mode:')
    console.log('  a = accept all')
    console.log('  r = reject all')
    console.log('  s = skip (keep pending)')
    console.log('  n = open direction override')
    console.log('  Or enter card numbers to accept (comma-separated)')
    
    const answer = await this.promptUser('\nYour decision: ')
    
    if (answer.toLowerCase() === 'a') {
      acceptedCards.push(...cards.map(c => c.id))
    } else if (answer.toLowerCase() === 'r') {
      for (const card of cards) {
        const note = await this.promptUser(`Rejection note for ${card.id} (optional): `)
        rejectedCards.push({ id: card.id, note: note || '' })
      }
    } else if (answer.toLowerCase() === 's') {
      skippedCards.push(...cards.map(c => c.id))
    } else if (answer.toLowerCase() === 'n') {
      const override = await this.promptUser('Enter direction override: ')
      return {
        acceptedCards: [],
        rejectedCards: cards.map(c => ({ id: c.id, note: 'Direction override' })),
        skippedCards: [],
        directionOverride: override
      }
    } else {
      // Parse card numbers
      const indices = answer.split(',').map(s => parseInt(s.trim()) - 1)
      
      for (let i = 0; i < cards.length; i++) {
        if (indices.includes(i)) {
          acceptedCards.push(cards[i].id)
        } else {
          const note = await this.promptUser(`Rejection note for ${cards[i].id} (optional): `)
          rejectedCards.push({ id: cards[i].id, note: note || '' })
        }
      }
    }
    
    return { acceptedCards, rejectedCards, skippedCards }
  }

  private async promptUser(message: string): Promise<string> {
    // Simple readline prompt
    const readline = await import('readline')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
    
    return new Promise(resolve => {
      rl.question(message, answer => {
        rl.close()
        resolve(answer)
      })
    })
  }

  private async processRejections(
    rejectedCards: Array<{ id: string; note: string }>,
    design: Design
  ): Promise<Negative[]> {
    const newNegatives: Negative[] = []
    
    for (const rejection of rejectedCards) {
      // Generate negative from rejection
      const negative = await this.generateNegativeFromRejection(rejection, design)
      
      if (negative) {
        // Save negative
        await this.saveNegative(negative)
        newNegatives.push(negative)
        
        this.log(`Created negative: ${negative.id}`)
      }
    }
    
    return newNegatives
  }

  private async generateNegativeFromRejection(
    rejection: { id: string; note: string },
    design: Design
  ): Promise<Negative | null> {
    // Load the card to get its content
    const card = await this.loadCard(rejection.id)
    if (!card) return null
    
    // Generate negative ID
    const negId = `NEG-${String(design.rejected_directions.length + 1).padStart(3, '0')}`
    
    // Generate negative text from card content
    const text = card.content.objective
    
    // Use rejection note as reason, or generate one
    const reason = rejection.note || `Rejected: ${card.content.risk}`
    
    return {
      _schema_version: '1.0.0',
      _schema_type: 'negative',
      id: negId,
      text,
      reason,
      scope: {
        type: 'conditional',
        condition: null,
        until_phase: null
      },
      source_card: card.id,
      created_at: new Date().toISOString(),
      status: 'active',
      lifted_at: null,
      lifted_note: null
    }
  }

  private async loadCard(cardId: string): Promise<Card | null> {
    const { config } = this.context
    const cardsDir = path.join(config.metaDir, 'cards')
    
    try {
      const content = await fs.readFile(path.join(cardsDir, `${cardId}.yaml`), 'utf-8')
      const card = yaml.load(content) as any
      return CardSchema.parse(card)
    } catch (error) {
      return null
    }
  }

  private async saveNegative(negative: Negative): Promise<void> {
    const { config } = this.context
    const negativesDir = path.join(config.metaDir, 'negatives')
    
    await fs.mkdir(negativesDir, { recursive: true })
    
    const negativePath = path.join(negativesDir, `${negative.id}.yaml`)
    const content = yaml.dump(negative, { indent: 2 })
    await fs.writeFile(negativePath, content, 'utf-8')
  }

  private async updateCardsWithDecisions(
    cards: Card[],
    decisions: {
      acceptedCards: string[]
      rejectedCards: Array<{ id: string; note: string }>
      skippedCards: string[]
    }
  ): Promise<void> {
    const { config } = this.context
    const cardsDir = path.join(config.metaDir, 'cards')
    
    for (const card of cards) {
      if (decisions.acceptedCards.includes(card.id)) {
        card.decision.status = 'accepted'
        card.decision.chosen_by = 'human'
        card.decision.resolved_at = new Date().toISOString()
      } else if (decisions.rejectedCards.some(r => r.id === card.id)) {
        const rejection = decisions.rejectedCards.find(r => r.id === card.id)!
        card.decision.status = 'rejected'
        card.decision.chosen_by = 'human'
        card.decision.resolved_at = new Date().toISOString()
        card.decision.note = rejection.note
      }
      // Skipped cards remain pending
      
      // Save updated card
      const cardPath = path.join(cardsDir, `${card.id}.yaml`)
      const content = yaml.dump(card, { indent: 2 })
      await fs.writeFile(cardPath, content, 'utf-8')
    }
  }
}
