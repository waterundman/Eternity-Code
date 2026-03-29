/**
 * 验收清单项
 */
export interface AcceptanceChecklistItem {
  id: string
  check: string
  verify: string
  status: "pass" | "fail" | "pending"
  last_checked?: string
}

export interface MetaRequirement {
  id: string
  text: string
  priority: "p0" | "p1" | "p2"
  coverage: number
  coverage_note?: string
  last_checked?: string
  signal?: {
    type: "metric" | "behavior" | "llm_eval" | "human_eval"
    spec: string
  }
  acceptance_checklist?: AcceptanceChecklistItem[]
}

export interface RejectedDirection {
  id: string
  text: string
  reason: string
  status: "active" | "pending_review" | "lifted"
  scope?: {
    type: "permanent" | "conditional" | "phase"
    condition?: string
    until_phase?: string
  }
  source_card?: string
  created_at?: string
}

export interface EvalFactor {
  id: string
  name: string
  role: {
    type: "objective" | "proxy" | "guardrail" | "diagnostic"
    proxies_for?: string
  }
  measurement: {
    type: "metric" | "llm_eval" | "human_eval"
    spec: string
    llm_prompt?: string
    llm_scale?: string
    human_criteria?: string[]
  }
  threshold: {
    target: string
    floor: string
    baseline: string
  }
  relations?: {
    conflicts_with?: string[]
    weight: number
  }
  lifecycle?: {
    active_from: string
    active_until?: string
  }
}

export interface MetaDesign {
  _schema_version?: string
  project: {
    id: string
    name: string
    stage: "prototype" | "mvp" | "growth" | "mature"
    core_value: string
    anti_value: string
    tech_stack?: {
      primary?: string[]
      forbidden?: Array<{ path: string; reason: string; until?: string }>
    }
  }
  requirements: MetaRequirement[]
  constraints?: {
    immutable_modules?: Array<{ path: string; reason: string }>
    stable_interfaces?: Array<{ name: string; spec: string }>
    performance_budget?: Array<{ metric: string; threshold: string; hard: boolean }>
    compliance?: string[]
  }
  rejected_directions?: RejectedDirection[]
  eval_factors?: EvalFactor[]
  search_policy?: {
    mode: "conservative" | "balanced" | "exploratory" | "restructure"
    max_cards_per_loop: number
    exploration_rate: number
    candidate_sources?: Array<{ source: string; weight: number }>
  }
  loop_history?: {
    total_loops: number
    last_loop_id?: string
    last_loop_at?: string
    loops?: Array<{
      loop_id: string
      status: string
      cards_proposed?: number
      cards_accepted?: number
      cards_rejected?: number
      composite_score_delta?: number
      summary?: string
    }>
  }
  two_speed_policy?: {
    weak_model: string
    sota_model: string
    sota_trigger: {
      schedule: string
      quality_thresholds: Array<{
        metric: string
        threshold: string
        window: string
      }>
    }
    sota_mode: string
  }
  updated_at?: string
}

export interface RawCard {
  objective: string
  approach: string
  benefit: string
  cost: string
  risk: string
  confidence: number
  req_refs: string[]
  warnings: string[]
  template_id?: string
}

export interface CardDecision {
  status: "accepted" | "rejected"
  note?: string
  chosen_by?: string
  resolved_at: string
}

/**
 * Session 接口
 * 用于与 LLM 进行交互
 */
export interface Session {
  prompt(options: {
    system?: string
    message: string
    signal?: AbortSignal
    onToolCall?: (tool: string, params: unknown) => void
  }): Promise<unknown>
  createSubtask?(options: {
    systemPrompt: string
    userMessage: string
    signal?: AbortSignal
    onToolCall?: (tool: string, params: unknown) => void
  }): Promise<unknown>
}

/**
 * 从验收清单计算覆盖度
 * coverage = pass 数量 / 总数量
 */
export function computeCoverage(req: MetaRequirement): number {
  const checklist = req.acceptance_checklist
  if (!checklist || checklist.length === 0) {
    // 没有 checklist 的 REQ，保留手动填写的 coverage
    return req.coverage ?? 0
  }
  const passed = checklist.filter(item => item.status === "pass").length
  return Math.round((passed / checklist.length) * 100) / 100
}

/**
 * 更新验收清单项状态
 */
export function updateChecklistStatus(
  req: MetaRequirement,
  itemId: string,
  status: "pass" | "fail" | "pending"
): MetaRequirement {
  if (!req.acceptance_checklist) return req

  const updatedChecklist = req.acceptance_checklist.map(item =>
    item.id === itemId
      ? { ...item, status, last_checked: new Date().toISOString() }
      : item
  )

  return {
    ...req,
    acceptance_checklist: updatedChecklist,
    coverage: computeCoverage({ ...req, acceptance_checklist: updatedChecklist }),
    last_checked: new Date().toISOString(),
  }
}
