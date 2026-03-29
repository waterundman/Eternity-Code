/**
 * Prompt优化系统
 *
 * 三层架构：
 * 1. 元层（Meta Layer）：生成子prompt，内化甜点密度原则
 * 2. 优化Pass（Optimization）：剪枝冗余约束、检测指令冲突、输出标准化
 * 3. 执行层（Execution Layer）：单次生成，不做多轮迭代修改
 *
 * 反馈环设计：
 * - 卡片评分 → 聚合为prompt模板评分
 * - 使用N次以上的均值作为信号（N ≥ 5）
 * - 区分噪音类型：内容噪音、结构噪音、Prompt质量信号
 */

export { PromptMeta } from "./prompt-meta.js"
export { PromptOptimizer } from "./prompt-optimizer.js"
export { PromptFeedbackLoop } from "./feedback-loop.js"
export type {
  PromptMetaConfig,
  ConflictPair,
  PromptOptimizationResult,
  PromptChange,
  PromptMetrics,
  PromptTemplate,
} from "./types.js"
export type {
  FeedbackSignal,
  NoiseType,
  TemplateQualityScore,
} from "./feedback-loop.js"

// 默认配置
export const DEFAULT_PROMPT_CONFIG: import("./types.js").PromptMetaConfig = {
  density_threshold: 3.0,
  max_tokens: 2000,
  min_intents: 1,
  conflict_pairs: [
    { keywords: ["concise", "detailed"], priority: "first", description: "简洁与详细冲突" },
    { keywords: ["brief", "comprehensive"], priority: "first", description: "简短与全面冲突" },
    { keywords: ["simple", "complex"], priority: "first", description: "简单与复杂冲突" },
    { keywords: ["fast", "thorough"], priority: "first", description: "快速与彻底冲突" },
    { keywords: ["minimal", "extensive"], priority: "first", description: "最小化与最大化冲突" },
  ],
  whitelist_fields: ["system_prompt", "output_format"],
  blacklist_fields: [],
  freeform_fields: ["description", "notes"],
}
