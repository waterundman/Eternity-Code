import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { DesignSchema, LoopSchema, CardSchema } from '../src/schema/index.js'

describe('Schema Validation', () => {
  test('should validate design schema', () => {
    const design = {
      _schema_version: '1.0.0',
      _schema_type: 'meta_design',
      project: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'test-project',
        stage: 'mvp',
        core_value: 'Test value',
        anti_value: 'Test anti value',
        tech_stack: {
          primary: ['TypeScript'],
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
          { source: 'coverage_gap', weight: 0.45 }
        ],
        warn_proximity_to: []
      },
      loop_history: {
        total_loops: 0,
        last_loop_id: '',
        last_loop_at: new Date().toISOString(),
        loops: []
      }
    }
    
    const result = DesignSchema.safeParse(design)
    expect(result.success).toBe(true)
  })
  
  test('should validate loop schema', () => {
    const loop = {
      _schema_version: '1.0.0',
      _schema_type: 'loop_record',
      id: 'loop-001',
      sequence: 1,
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
    
    const result = LoopSchema.safeParse(loop)
    expect(result.success).toBe(true)
  })
  
  test('should validate card schema', () => {
    const card = {
      _schema_version: '1.0.0',
      _schema_type: 'decision_card',
      id: 'CARD-001',
      loop_id: 'loop-001',
      req_refs: ['REQ-001'],
      content: {
        objective: 'Test objective',
        approach: 'Test approach',
        benefit: 'Test benefit',
        cost: 'Test cost',
        risk: 'Test risk',
        scope: ['src/'],
        warnings: []
      },
      prediction: {
        confidence: 0.7,
        basis: 'Test basis',
        assumptions: ['Test assumption'],
        eval_deltas: []
      },
      decision: {
        status: 'pending',
        chosen_by: 'agent',
        resolved_at: null,
        note: null,
        merged_from: null
      },
      outcome: null
    }
    
    const result = CardSchema.safeParse(card)
    expect(result.success).toBe(true)
  })
})

describe('LoopRunner', () => {
  const testDir = path.join(process.cwd(), '.test-meta')
  
  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true })
    await fs.mkdir(path.join(testDir, 'cards'), { recursive: true })
    await fs.mkdir(path.join(testDir, 'loops'), { recursive: true })
    await fs.mkdir(path.join(testDir, 'negatives'), { recursive: true })
    
    // Create test design.yaml
    const design = {
      _schema_version: '1.0.0',
      _schema_type: 'meta_design',
      project: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'test-project',
        stage: 'mvp',
        core_value: 'Test value',
        anti_value: 'Test anti value',
        tech_stack: {
          primary: ['TypeScript'],
          forbidden: []
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      requirements: [
        {
          id: 'REQ-001',
          text: 'Test requirement',
          priority: 'p0',
          signal: {
            type: 'behavior',
            spec: 'Test spec'
          },
          coverage: 0.5,
          coverage_note: 'Test note',
          last_checked: new Date().toISOString()
        }
      ],
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
          { source: 'coverage_gap', weight: 0.45 }
        ],
        warn_proximity_to: []
      },
      loop_history: {
        total_loops: 0,
        last_loop_id: '',
        last_loop_at: new Date().toISOString(),
        loops: []
      }
    }
    
    const content = yaml.dump(design, { indent: 2 })
    await fs.writeFile(path.join(testDir, 'design.yaml'), content, 'utf-8')
  })
  
  afterEach(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true })
  })
  
  test('should load design.yaml', async () => {
    const designPath = path.join(testDir, 'design.yaml')
    const content = await fs.readFile(designPath, 'utf-8')
    const design = yaml.load(content) as any
    
    const result = DesignSchema.safeParse(design)
    expect(result.success).toBe(true)
  })
  
  test('should create loop structure', async () => {
    const loop = {
      _schema_version: '1.0.0',
      _schema_type: 'loop_record',
      id: 'loop-001',
      sequence: 1,
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
    
    const loopPath = path.join(testDir, 'loops', 'loop-001.yaml')
    const content = yaml.dump(loop, { indent: 2 })
    await fs.writeFile(loopPath, content, 'utf-8')
    
    const savedContent = await fs.readFile(loopPath, 'utf-8')
    const savedLoop = yaml.load(savedContent) as any
    
    const result = LoopSchema.safeParse(savedLoop)
    expect(result.success).toBe(true)
    expect(savedLoop.id).toBe('loop-001')
  })
})
