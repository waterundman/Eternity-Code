/**
 * Prompt优化系统类型定义
 */

export interface PromptMetaConfig {
  // 密度阈值配置
  density_threshold: number        // token/intent比率阈值
  max_tokens: number               // 最大token数
  min_intents: number              // 最小意图数

  // 冲突词对配置
  conflict_pairs: ConflictPair[]

  // 留白策略配置
  whitelist_fields: string[]       // 必须保留的字段
  blacklist_fields: string[]       // 可以删除的字段
  freeform_fields: string[]        // 模型自由填充的字段
}

export interface ConflictPair {
  keywords: [string, string]       // 冲突关键词对
  priority: "first" | "second"     // 保留优先级
  description: string              // 冲突描述
}

export interface PromptOptimizationResult {
  original_prompt: string
  optimized_prompt: string
  changes: PromptChange[]
  metrics: PromptMetrics
}

export interface PromptChange {
  type: "prune" | "conflict_resolved" | "whitespace_added"
  location: string
  description: string
  before?: string
  after?: string
}

export interface PromptMetrics {
  original_token_count: number
  optimized_token_count: number
  intent_count: number
  density_score: number
  conflict_count: number
  pruned_count: number
}

export interface PromptTemplate {
  id: string
  name: string
  description: string
  template: string
  variables: string[]
  category: "generation" | "review" | "evaluation" | "execution"
  quality_score?: number           // 基于历史评分的质量分数
  usage_count: number
  last_used: string
}
