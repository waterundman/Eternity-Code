import { z } from 'zod'

// Design Schema
export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  stage: z.enum(['prototype', 'mvp', 'growth', 'mature']),
  core_value: z.string(),
  anti_value: z.string(),
  tech_stack: z.object({
    primary: z.array(z.string()),
    forbidden: z.array(z.object({
      path: z.string(),
      reason: z.string(),
      until: z.string().nullable()
    }))
  }),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
})

export const RequirementSchema = z.object({
  id: z.string(),
  text: z.string(),
  priority: z.enum(['p0', 'p1', 'p2']),
  signal: z.object({
    type: z.enum(['metric', 'behavior', 'llm_eval', 'human_eval']),
    spec: z.string()
  }),
  coverage: z.number().min(0).max(1),
  coverage_note: z.string(),
  last_checked: z.string().datetime()
})

export const ConstraintSchema = z.object({
  immutable_modules: z.array(z.object({
    path: z.string(),
    reason: z.string(),
    until: z.string().nullable()
  })),
  stable_interfaces: z.array(z.object({
    name: z.string(),
    spec: z.string(),
    breaking_change_def: z.string()
  })),
  performance_budget: z.array(z.object({
    metric: z.string(),
    threshold: z.string(),
    measurement_spec: z.string(),
    hard: z.boolean()
  })),
  compliance: z.array(z.string())
})

export const NegativeSchema = z.object({
  id: z.string(),
  text: z.string(),
  reason: z.string(),
  scope: z.object({
    type: z.enum(['permanent', 'conditional', 'phase']),
    condition: z.string().nullable(),
    until_phase: z.string().nullable()
  }),
  source_card: z.string(),
  created_at: z.string().datetime(),
  status: z.enum(['active', 'pending_review', 'lifted']),
  lifted_at: z.string().datetime().nullable(),
  lifted_note: z.string().nullable()
})

export const EvalFactorSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.object({
    type: z.enum(['objective', 'proxy', 'guardrail', 'diagnostic']),
    proxies_for: z.string().nullable(),
    proxy_validity: z.string().nullable()
  }),
  measurement: z.object({
    type: z.enum(['metric', 'llm_eval', 'human_eval']),
    spec: z.string(),
    llm_prompt: z.string().nullable(),
    llm_scale: z.string().nullable(),
    human_criteria: z.array(z.string()).nullable()
  }),
  threshold: z.object({
    target: z.string(),
    floor: z.string(),
    baseline: z.string()
  }),
  relations: z.object({
    conflicts_with: z.array(z.string()).nullable(),
    depends_on: z.array(z.string()).nullable(),
    weight: z.number().min(0).max(1)
  }),
  lifecycle: z.object({
    active_from: z.string(),
    active_until: z.string().nullable(),
    review_at: z.string().nullable()
  })
})

export const SearchPolicySchema = z.object({
  mode: z.enum(['conservative', 'balanced', 'exploratory']),
  max_cards_per_loop: z.number().int().positive(),
  exploration_rate: z.number().min(0).max(1),
  candidate_sources: z.array(z.object({
    source: z.enum(['coverage_gap', 'tech_debt', 'eval_regression', 'user_feedback', 'free_exploration']),
    weight: z.number().min(0).max(1)
  })),
  warn_proximity_to: z.array(z.string())
})

export const LoopHistorySchema = z.object({
  total_loops: z.number().int().nonnegative(),
  last_loop_id: z.string(),
  last_loop_at: z.string().datetime(),
  loops: z.array(z.object({
    loop_id: z.string(),
    status: z.enum(['completed', 'rolled_back', 'aborted']),
    cards_proposed: z.number().int().nonnegative(),
    cards_accepted: z.number().int().nonnegative(),
    cards_rejected: z.number().int().nonnegative(),
    composite_score_delta: z.number(),
    summary: z.string()
  }))
})

export const DesignSchema = z.object({
  _schema_version: z.string(),
  _schema_type: z.literal('meta_design'),
  project: ProjectSchema,
  requirements: z.array(RequirementSchema),
  constraints: ConstraintSchema,
  rejected_directions: z.array(NegativeSchema),
  eval_factors: z.array(EvalFactorSchema),
  search_policy: SearchPolicySchema,
  loop_history: LoopHistorySchema
})

// Card Schema
export const CardContentSchema = z.object({
  objective: z.string(),
  approach: z.string(),
  benefit: z.string(),
  cost: z.string(),
  risk: z.string(),
  scope: z.array(z.string()),
  warnings: z.array(z.object({
    type: z.enum(['near_negative', 'near_constraint', 'conflicts_eval']),
    ref: z.string(),
    message: z.string()
  }))
})

export const CardPredictionSchema = z.object({
  confidence: z.number().min(0).max(1),
  basis: z.string(),
  assumptions: z.array(z.string()),
  eval_deltas: z.array(z.object({
    eval_id: z.string(),
    direction: z.enum(['increase', 'decrease', 'neutral', 'unknown']),
    magnitude: z.string()
  }))
})

export const CardDecisionSchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected', 'merged']),
  chosen_by: z.string(),
  resolved_at: z.string().datetime().nullable(),
  note: z.string().nullable(),
  merged_from: z.array(z.string()).nullable()
})

export const CardOutcomeSchema = z.object({
  status: z.enum(['success', 'partial', 'rolled_back']),
  actual_eval_deltas: z.array(z.object({
    eval_id: z.string(),
    before: z.string(),
    after: z.string(),
    delta: z.string()
  })),
  prediction_accuracy: z.number().min(0).max(1),
  deviation_explanation: z.string(),
  lessons: z.array(z.string()),
  constraint_breaches: z.array(z.object({
    constraint_ref: z.string(),
    measured_value: z.string(),
    threshold: z.string(),
    action_taken: z.string()
  })),
  committed_at: z.string().datetime().nullable()
})

export const CardSchema = z.object({
  _schema_version: z.string(),
  _schema_type: z.literal('decision_card'),
  id: z.string(),
  loop_id: z.string(),
  req_refs: z.array(z.string()),
  content: CardContentSchema,
  prediction: CardPredictionSchema,
  decision: CardDecisionSchema,
  outcome: CardOutcomeSchema.nullable()
})

// Loop Schema
export const LoopAnalysisSchema = z.object({
  codebase_snapshot: z.object({
    files_read: z.number().int().nonnegative(),
    total_lines: z.number().int().nonnegative(),
    git_sha: z.string()
  }),
  requirement_coverage: z.array(z.object({
    req_id: z.string(),
    coverage_before: z.number().min(0).max(1),
    coverage_assessed: z.number().min(0).max(1),
    gap_description: z.string()
  })),
  constraint_proximity: z.array(z.object({
    constraint_ref: z.string(),
    status: z.enum(['safe', 'warning', 'breach']),
    detail: z.string()
  })),
  active_negatives_checked: z.array(z.string()),
  negatives_unlocked: z.array(z.string()).nullable()
})

export const LoopCandidatesSchema = z.object({
  generated_count: z.number().int().nonnegative(),
  filtered_count: z.number().int().nonnegative(),
  filter_log: z.array(z.object({
    candidate_summary: z.string(),
    matched_negative: z.string()
  })),
  presented_cards: z.array(z.string())
})

export const LoopDecisionSessionSchema = z.object({
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
  duration_seconds: z.number().int().nonnegative().nullable(),
  accepted_cards: z.array(z.string()),
  rejected_cards: z.array(z.string()),
  skipped_cards: z.array(z.string()),
  new_negatives_written: z.array(z.string()),
  direction_override: z.string().nullable()
})

export const LoopExecutionSchema = z.object({
  cards_executed: z.array(z.object({
    card_id: z.string(),
    status: z.enum(['success', 'failed', 'rolled_back']),
    files_modified: z.array(z.string()),
    git_sha_after: z.string().nullable(),
    error: z.string().nullable()
  })),
  total_files_modified: z.number().int().nonnegative(),
  git_sha_before: z.string(),
  git_sha_after: z.string().nullable()
})

export const LoopEvaluationSchema = z.object({
  ran_at: z.string().datetime().nullable(),
  factor_results: z.array(z.object({
    factor_id: z.string(),
    value_before: z.string(),
    value_after: z.string(),
    normalized_score: z.number().min(0).max(1),
    passed_floor: z.boolean(),
    delta: z.number()
  })),
  composite_score_before: z.number(),
  composite_score_after: z.number(),
  composite_delta: z.number(),
  conflicts_detected: z.array(z.object({
    factor_a: z.string(),
    factor_b: z.string(),
    description: z.string(),
    severity: z.enum(['warn', 'block'])
  })),
  forced_rollback: z.boolean(),
  rollback_reason: z.string().nullable()
})

export const LoopCloseSchema = z.object({
  design_updates: z.object({
    requirements_coverage_updated: z.boolean(),
    negatives_added: z.array(z.string()),
    negatives_lifted: z.array(z.string()),
    eval_baselines_updated: z.boolean(),
    loop_history_appended: z.boolean()
  }),
  summary: z.string(),
  next_loop_hints: z.array(z.object({
    type: z.enum(['coverage_gap', 'eval_regression', 'constraint_risk', 'opportunity']),
    message: z.string(),
    priority: z.enum(['high', 'medium', 'low'])
  }))
})

export const LoopSchema = z.object({
  _schema_version: z.string(),
  _schema_type: z.literal('loop_record'),
  id: z.string(),
  sequence: z.number().int().positive(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
  status: z.enum(['running', 'decision_pending', 'executing', 'evaluating', 'completed', 'rolled_back', 'aborted']),
  analysis: LoopAnalysisSchema.nullable(),
  candidates: LoopCandidatesSchema.nullable(),
  decision_session: LoopDecisionSessionSchema.nullable(),
  execution: LoopExecutionSchema.nullable(),
  evaluation: LoopEvaluationSchema.nullable(),
  close: LoopCloseSchema.nullable()
})

export type DesignSchemaType = typeof DesignSchema
export type CardSchemaType = typeof CardSchema
export type LoopSchemaType = typeof LoopSchema
export type NegativeSchemaType = typeof NegativeSchema
