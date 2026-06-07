export type { MetaDesign, RawCard, CardDecision, Session, AcceptanceChecklistItem, MetaRequirement } from "./types.js"
export { computeCoverage, updateChecklistStatus } from "./types.js"
export { loadMetaDesign, buildSystemContext } from "./design.js"
export {
  MetaPaths,
  resolveMetaDesignPath,
  resolveMetaDirectory,
  resolveMetaEntryPath,
  listMetaEntryPaths,
  listMetaEntryNames,
} from "./paths.js"
export { 
  parseCardsFromText, 
  writeCard, 
  resolveCard, 
  writeRejectedDirection, 
  updateLoopHistory,
  analyzeNegativeUnlockability,
  analyzeAllNegatives,
  generateNegativeUnlockSuggestions,
  unlockNegative,
  batchUnlockNegatives,
} from "./cards.js"
export type { NegativeAnalysis } from "./cards.js"
export {
  loadMetaLoopRuntime,
  loadLoopRecords,
  loadLoopCards,
  applyLoopDecisions,
  findLatestAcceptedLoop,
  updateLoopExecutionPlan,
  updateLoopEvaluation,
  updateLoopCloseSummary,
  updateLoopRollback,
} from "./loop.js"
export { loadExecutionPlans, loadExecutionPlansForLoop, planAcceptedCardsForLoop, executePlan, executeTask, rollbackPlan } from "./execute.js"
export { metaDesignPlugin } from "./plugin.js"
export {
  analyzeCardScope,
  getCard,
  getAcceptedCards,
  prepareExecutionContext,
  validateTypeCheck,
  validateLint,
  validateExecution,
  createGitSnapshot,
  rollbackToSnapshot,
  executeCardWithRollback,
  executeCards,
} from "./executor.js"
export { runEvalFactor, runEvaluation, updateCardOutcome, updateBaselines, generateEvaluationReport, saveEvaluationReport } from "./evaluator.js"
export {
  analyzeLoopHistory,
  analyzeSourceAcceptance,
  generateWeightRecommendations,
  checkUnlockableNegs,
  updateRequirementCoverage,
  runOptimization,
  applyOptimizations,
} from "./optimizer.js"

export { loadLoopContext } from "./context-loader.js"
export {
  loadCurrentBlueprint,
  loadAllBlueprints,
  writeBlueprint,
  buildBlueprintContext,
  addModelAssumption,
  updateAssumptionStatus,
  getUntestedAssumptions,
  getInvalidatedAssumptions,
} from "./blueprints.js"
export {
  loadInsights,
  loadAdoptedInsights,
  loadPendingInsights,
  writeInsight,
  updateInsightStatus,
  buildInsightsContext,
} from "./insights.js"
export { buildContextFromCognition } from "./cognition.js"
export { assessQuality, assessQualitySync, formatQualityReport } from "./quality-monitor.js"
export { handleInsightOutput, formatInsightResult } from "./insight-handler.js"
export { handleRestructureOutput, formatRestructureResult } from "./restructure-handler.js"
export { executeRestructure, formatRestructureExecutionResult } from "./restructure-executor.js"
export {
  ContextMixer,
  createContextMixer,
  estimateTokens,
  truncateToTokens,
  saveContextMixSnapshot,
  loadContextMixSnapshots,
  loadLatestContextMixSnapshot,
} from "./context-mixer.js"
export { planCard, runPlan } from "./execution/index.js"
export { metaInit } from "./init.js"
export { LoopOrchestrator } from "./orchestrator.js"
export { loadMetaRuntimeSnapshot, resolveLoop } from "./runtime.js"
export type { LoopPhase, DecisionCard, LoopDecision, EvaluationResult, LoopOrchestratorOptions } from "./orchestrator.js"
export type { HandoffExecutionResult } from "./utils/handoff.js"
export type { MetaRuntimeSnapshot, MetaRuntimeStatus, MetaRuntimePhase } from "./runtime.js"

export type {
  ContextBudget,
  ContextLayerConfig,
  ShortTermContext,
  MidTermMemory,
  LongTermMemory,
  ContextMixDiagnostics,
  ContextMixResult,
  ContextMixSnapshot,
  ContextLayerUsage,
  ContextLayerName,
} from "./context-mixer.js"

// Sub-agent调度层
export { Dispatcher } from "./agents/dispatcher.js"
export { registerRole, getRole, listRoles, loadAllRoles, getHandoffs, getAgentTools, canHandoffTo, hasAgentTool, listHandoffCapableRoles, listAgentToolCapableRoles } from "./agents/registry.js"
export { buildAgentContext, buildHandoffContext, injectHandoffIntoPrompt } from "./agents/context-builder.js"
export type { AgentRole, AgentTask, DispatcherOptions } from "./agents/types.js"
export type { DispatcherEnhancedOptions, DispatchResult } from "./agents/dispatcher.js"

// Handoff 机制
export {
  handoff_to,
  isHandoffResult,
  defineHandoff,
  defineAgentTool,
  isAgentToolResult,
  HandoffTrace,
} from "./agents/handoff.js"
export type {
  HandoffResult,
  HandoffSpec,
  AgentToolSpec,
  AgentToolResult,
  HandoffTraceEntry,
} from "./agents/handoff.js"
export type { LoopContext } from "./context-loader.js"
export type { Blueprint } from "./blueprints.js"
export type { Insight } from "./insights.js"
export type { QualityReport, QualityThresholds } from "./quality-monitor.js"
export type { InsightWriteResult } from "./insight-handler.js"
export type { RestructureWriteResult } from "./restructure-handler.js"
export type { RestructureExecutionResult } from "./restructure-executor.js"

// Prompt优化系统
export { PromptMeta } from "./prompt/prompt-meta.js"
export { PromptOptimizer } from "./prompt/prompt-optimizer.js"
export { PromptFeedbackLoop } from "./prompt/feedback-loop.js"
export { DEFAULT_PROMPT_CONFIG } from "./prompt/index.js"
export type {
  PromptMetaConfig,
  ConflictPair,
  PromptOptimizationResult,
  PromptChange,
  PromptMetrics,
  PromptTemplate,
} from "./prompt/types.js"
export type {
  FeedbackSignal,
  NoiseType,
  TemplateQualityScore,
} from "./prompt/feedback-loop.js"
export type {
  MetaDecisionCard,
  MetaLoopRecord,
  MetaLoopRuntime,
  ApplyLoopDecisionsResult,
  UpdateLoopExecutionResult,
  UpdateLoopEvaluationResult,
} from "./loop.js"
export type { ExecutePlanningResult } from "./execute.js"
export type { CardScope, ValidationResult as ExecutionValidationResult } from "./executor.js"
export type { EvalResult, EvaluationOutput } from "./evaluator.js"
export type { LoopStats, SourceStats, OptimizationResult, CoverageGap } from "./optimizer.js"
export type {
  ExecutionPlan,
  ExecutionTask,
  TaskPreflight,
  PlanPreflight,
  ExecutionPreflightSummary,
  PreflightStatus,
  PlanResult,
  TaskResult,
  ExecutionOptionsBase,
} from "./execution/index.js"

// Watchdog 系统
export { Watchdog } from "./watchdog/index.js"
export { CircuitBreaker } from "./watchdog/circuit-breaker.js"
export { RepetitionDetector, detectInfiniteLoop, classifyApiError, isEmptyResponse } from "./watchdog/detectors.js"
export { DEFAULT_CONFIG as DEFAULT_WATCHDOG_CONFIG } from "./watchdog/types.js"
export type {
  AnomalyType,
  AnomalyEvent,
  WatchdogConfig,
  WatchdogStatus,
} from "./watchdog/types.js"

// 工具模块
export {
  // 文件 I/O
  ensureDirectory,
  ensureDirectorySync,
  readYamlFileAsync,
  readYamlFileSync,
  writeYamlFileAtomicAsync,
  writeYamlFileSync,
  readJsonFileAsync,
  writeJsonFileAtomicAsync,
  readYamlDirectoryAsync,
  fileExistsAsync,
  getFileMtime,
  LRUCache,
  createCachedYamlReader,
  // 类型验证
  ValidationError,
  validators,
  optional,
  nullable,
  array,
  object,
  enumValue,
  union,
  safeValidate,
  strictValidate,
  // Result 类型
  Ok,
  Err,
  isOk,
  isErr,
  // Schema 验证
  readYamlWithValidation,
  readYamlWithValidationAsync,
  readYamlStrict,
  SchemaValidationError,
  // 错误处理
  ErrorCode,
  ErrorSeverity,
  AppError,
  FileErrors,
  ParseErrors,
  GitErrors,
  AgentErrors,
  ExecutionErrors,
  WatchdogErrors,
  safeExecute,
  safeExecuteSync,
  withFallback,
  withRetry,
  // 资源管理
  ResourceManager,
  withResources,
  createDisposableTimer,
  createDisposableInterval,
  createDisposableAbortController,
  createCancellablePromise,
  withTimeout,
  debounce,
  throttle,
  // 性能监控
  PerformanceMonitor,
  getGlobalMonitor,
  setGlobalMonitor,
  measured,
  formatMemorySize,
  formatDurationMs,
  formatDuration,
  generateReport,
  // 通用工具
  extractText,
  stableHash,
  safeJsonParse,
  sleep,
  generateShortId,
  truncateString,
  deepMerge,
} from "./utils/index.js"

export type {
  ValidationResult,
  Validator,
  Disposable,
  PerformanceMetric,
  MemorySnapshot,
  PerformanceStats,
  Result,
} from "./utils/index.js"

// Zod schemas
export {
  MetaDesignSchema,
  MetaRequirementSchema,
  RejectedDirectionSchema,
  EvalFactorSchema,
  MetaDecisionCardSchema,
  AcceptanceChecklistItemSchema,
  CardContentSchema,
  CardPredictionSchema,
  CardSourceSchema,
  CardDecisionSchema,
  ExecutionPlanSchema,
  ExecutionTaskSchema,
  TaskPreflightSchema,
  PlanPreflightSchema,
  NegativeEntrySchema,
} from "./schemas.js"

// 终端状态展示
export { displayLoopStatus, displayAgentStatus, displayWatchdogStatus, handleMetaStatus, handleMetaHistory, handleMetaWatchdog } from "./terminal/index.js"
