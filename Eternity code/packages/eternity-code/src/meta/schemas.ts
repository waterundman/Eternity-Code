/**
 * Zod schemas for meta module types
 * 用于运行时 YAML 验证，与 TypeScript 接口保持同步
 */

import z from "zod"

// ── MetaRequirement ──────────────────────────────────────────

export const AcceptanceChecklistItemSchema = z.object({
  id: z.string(),
  check: z.string(),
  verify: z.string(),
  status: z.enum(["pass", "fail", "pending"]),
  last_checked: z.string().optional(),
})

export const SignalSchema = z.object({
  type: z.enum(["metric", "behavior", "llm_eval", "human_eval"]),
  spec: z.string(),
})

export const MetaRequirementSchema = z.object({
  id: z.string(),
  text: z.string(),
  priority: z.enum(["p0", "p1", "p2"]),
  coverage: z.number(),
  coverage_note: z.string().optional(),
  last_checked: z.string().optional(),
  signal: SignalSchema.optional(),
  acceptance_checklist: z.array(AcceptanceChecklistItemSchema).optional(),
})

// ── RejectedDirection ────────────────────────────────────────

export const RejectedDirectionScopeSchema = z.object({
  type: z.enum(["permanent", "conditional", "phase"]),
  condition: z.string().optional(),
  until_phase: z.string().optional(),
})

export const RejectedDirectionSchema = z.object({
  id: z.string(),
  text: z.string(),
  reason: z.string(),
  status: z.enum(["active", "pending_review", "lifted"]),
  scope: RejectedDirectionScopeSchema.optional(),
  source_card: z.string().optional(),
  created_at: z.string().optional(),
})

// ── EvalFactor ───────────────────────────────────────────────

export const EvalFactorRoleSchema = z.object({
  type: z.enum(["objective", "proxy", "guardrail", "diagnostic"]),
  proxies_for: z.string().optional(),
})

export const EvalFactorMeasurementSchema = z.object({
  type: z.enum(["metric", "llm_eval", "human_eval"]),
  spec: z.string(),
  llm_prompt: z.string().optional(),
  llm_scale: z.string().optional(),
  human_criteria: z.array(z.string()).optional(),
})

export const EvalFactorThresholdSchema = z.object({
  target: z.string(),
  floor: z.string(),
  baseline: z.string(),
})

export const EvalFactorRelationsSchema = z.object({
  conflicts_with: z.array(z.string()).optional(),
  weight: z.number(),
})

export const EvalFactorLifecycleSchema = z.object({
  active_from: z.string(),
  active_until: z.string().optional(),
})

export const EvalFactorSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: EvalFactorRoleSchema,
  measurement: EvalFactorMeasurementSchema,
  threshold: EvalFactorThresholdSchema,
  relations: EvalFactorRelationsSchema.optional(),
  lifecycle: EvalFactorLifecycleSchema.optional(),
})

// ── MetaDesign ───────────────────────────────────────────────

export const TechStackSchema = z.object({
  primary: z.array(z.string()).optional(),
  forbidden: z.array(z.object({ path: z.string(), reason: z.string(), until: z.string().optional() })).optional(),
})

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  stage: z.enum(["prototype", "mvp", "growth", "mature"]),
  core_value: z.string(),
  anti_value: z.string(),
  tech_stack: TechStackSchema.optional(),
})

export const ConstraintsSchema = z.object({
  immutable_modules: z.array(z.object({ path: z.string(), reason: z.string() })).optional(),
  stable_interfaces: z.array(z.object({ name: z.string(), spec: z.string() })).optional(),
  performance_budget: z.array(z.object({ metric: z.string(), threshold: z.string(), hard: z.boolean() })).optional(),
  compliance: z.array(z.string()).optional(),
})

export const SearchPolicySchema = z.object({
  mode: z.enum(["conservative", "balanced", "exploratory", "restructure"]),
  max_cards_per_loop: z.number(),
  exploration_rate: z.number(),
  candidate_sources: z.array(z.object({ source: z.string(), weight: z.number() })).optional(),
})

export const LoopHistoryEntrySchema = z.object({
  loop_id: z.string(),
  status: z.string(),
  cards_proposed: z.number().optional(),
  cards_accepted: z.number().optional(),
  cards_rejected: z.number().optional(),
  composite_score_delta: z.number().optional(),
  summary: z.string().optional(),
})

export const LoopHistorySchema = z.object({
  total_loops: z.number(),
  last_loop_id: z.string().optional(),
  last_loop_at: z.string().optional(),
  loops: z.array(LoopHistoryEntrySchema).optional(),
})

export const TwoSpeedPolicySchema = z.object({
  weak_model: z.string(),
  sota_model: z.string(),
  sota_trigger: z.object({
    schedule: z.string(),
    quality_thresholds: z.array(z.object({
      metric: z.string(),
      threshold: z.string(),
      window: z.string(),
    })),
  }),
  sota_mode: z.string(),
})

export const MetaDesignSchema = z.object({
  _schema_version: z.string().optional(),
  project: ProjectSchema,
  requirements: z.array(MetaRequirementSchema),
  constraints: ConstraintsSchema.optional(),
  rejected_directions: z.array(RejectedDirectionSchema).optional(),
  eval_factors: z.array(EvalFactorSchema).optional(),
  search_policy: SearchPolicySchema.optional(),
  loop_history: LoopHistorySchema.optional(),
  two_speed_policy: TwoSpeedPolicySchema.optional(),
  updated_at: z.string().optional(),
})

// ── MetaDecisionCard ─────────────────────────────────────────

export const CardContentSchema = z.object({
  objective: z.string(),
  approach: z.string(),
  benefit: z.string(),
  cost: z.string(),
  risk: z.string(),
  warnings: z.array(z.string()),
})

export const CardPredictionSchema = z.object({
  confidence: z.number(),
})

export const CardSourceSchema = z.object({
  template_id: z.string().optional(),
  generator: z.string().optional(),
})

export const CardDecisionSchema = z.object({
  status: z.enum(["pending", "accepted", "rejected"]),
  chosen_by: z.string().nullable().optional(),
  resolved_at: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
})

export const MetaDecisionCardSchema = z.object({
  _schema_version: z.string().optional(),
  _schema_type: z.string().optional(),
  id: z.string(),
  loop_id: z.string().optional(),
  req_refs: z.array(z.string()),
  content: CardContentSchema,
  prediction: CardPredictionSchema,
  source: CardSourceSchema.optional(),
  decision: CardDecisionSchema.optional(),
  outcome: z.unknown().optional(),
  created_at: z.string().optional(),
})

// ── ExecutionPlan / ExecutionTask ─────────────────────────────

export const TaskPreflightSchema = z.object({
  status: z.enum(["ready", "warning", "blocked"]),
  summary: z.string(),
  warnings: z.array(z.string()),
  blockers: z.array(z.string()),
  touched_files: z.array(z.string()),
  existing_files: z.array(z.string()),
  new_files: z.array(z.string()),
})

export const ExecutionTaskSpecSchema = z.object({
  title: z.string(),
  description: z.string(),
  files_to_modify: z.array(z.string()),
  definition_of_done: z.string(),
  must_not: z.array(z.string()),
})

export const ExecutionTaskSchema = z.object({
  id: z.string(),
  plan_id: z.string(),
  card_id: z.string(),
  sequence: z.number(),
  spec: ExecutionTaskSpecSchema,
  depends_on: z.array(z.string()),
  status: z.enum(["pending", "running", "done", "failed", "skipped"]),
  preflight: TaskPreflightSchema.optional(),
  git_sha: z.string().optional(),
  error: z.string().optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
})

export const PlanPreflightSchema = z.object({
  status: z.enum(["ready", "warning", "blocked"]),
  checked_at: z.string(),
  summary: z.string(),
  warnings: z.array(z.string()),
  blockers: z.array(z.string()),
  touched_files: z.array(z.string()),
  existing_files: z.array(z.string()),
  new_files: z.array(z.string()),
  duplicate_targets: z.array(z.string()),
  tasks_total: z.number(),
  tasks_ready: z.number(),
  tasks_warning: z.number(),
  tasks_blocked: z.number(),
})

export const ExecutionPlanSchema = z.object({
  id: z.string(),
  card_id: z.string(),
  loop_id: z.string(),
  interpretation: z.string(),
  tasks: z.array(ExecutionTaskSchema),
  status: z.enum(["pending", "running", "done", "failed", "rolled_back"]),
  preflight: PlanPreflightSchema.optional(),
  git_sha_before: z.string(),
  git_branch_before: z.string().optional(),
  git_sha_after: z.string().optional(),
  created_at: z.string(),
  completed_at: z.string().optional(),
})

// ── Negative (standalone YAML in negatives/) ──────────────────

export const NegativeScopeSchema = z.object({
  type: z.enum(["permanent", "conditional", "phase"]),
  condition: z.string().nullable().optional(),
  until_phase: z.string().nullable().optional(),
})

export const NegativeEntrySchema = z.object({
  id: z.string(),
  text: z.string(),
  reason: z.string(),
  scope: NegativeScopeSchema.optional(),
  source_card: z.string().optional(),
  created_at: z.string(),
  status: z.string(),
  lifted_at: z.string().nullable().optional(),
  lifted_note: z.string().nullable().optional(),
})

// ── MetaLoopRecord ──────────────────────────────────────────

export const PreflightStatusSchema = z.enum(["ready", "warning", "blocked"])

export const LoopExecutionSchema = z.object({
  status: z.enum(["planned", "ready", "warning", "blocked"]).optional(),
  preflight_status: PreflightStatusSchema.optional(),
  plan_ids: z.array(z.string()).optional(),
  planned_cards: z.array(z.string()).optional(),
  planned_at: z.string().optional(),
  checked_at: z.string().optional(),
  ready_plans: z.number().optional(),
  warning_plans: z.number().optional(),
  blocked_plans: z.number().optional(),
  warnings: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  summary: z.string().optional(),
})

export const LoopEvaluationResultSchema = z.object({
  factor_id: z.string(),
  factor_name: z.string(),
  value_before: z.string(),
  value_after: z.string(),
  normalized_score: z.number().nullable(),
  passed_floor: z.boolean(),
  delta: z.number(),
})

export const LoopEvaluationSchema = z.object({
  composite_score_before: z.number().optional(),
  composite_score_after: z.number().optional(),
  composite_delta: z.number().optional(),
  forced_rollback: z.boolean().optional(),
  rollback_reason: z.string().optional(),
  results: z.array(LoopEvaluationResultSchema).optional(),
  evaluated_at: z.string().optional(),
})

export const LoopCloseSchema = z.object({
  summary: z.string().optional(),
  optimized_at: z.string().optional(),
})

export const LoopDecisionSessionSchema = z.object({
  accepted_cards: z.array(z.string()).optional(),
  rejected_cards: z.array(z.string()).optional(),
  new_negatives_written: z.array(z.string()).optional(),
  completed_at: z.string().optional(),
})

export const LoopCandidatesSchema = z.object({
  presented_cards: z.array(z.string()).optional(),
})

export const MetaLoopRecordSchema = z.object({
  _schema_type: z.string().optional(),
  id: z.string(),
  sequence: z.number().optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  status: z.string().optional(),
  phase: z.string().optional(),
  message_id: z.string().optional(),
  candidates: LoopCandidatesSchema.optional(),
  decision_session: LoopDecisionSessionSchema.optional(),
  execution: LoopExecutionSchema.optional(),
  evaluation: LoopEvaluationSchema.optional(),
  close: LoopCloseSchema.optional(),
})
