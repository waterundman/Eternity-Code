# Loop Runner Design Alignment

更新日期：2026-03-21

## 目的

这份文档不再把 `packages/loop-runner` 的理想化 6 阶段实现直接当成当前默认运行事实，而是描述 Eternity Code 现在真正落地的 Loop 运行逻辑，以及 `loop-runner` 设计稿与当前主链之间的边界。

## 当前真实主链

当前默认主链在：

- `opencode-dev/packages/eternity-code/src/meta/*`
- `opencode-dev/packages/eternity-code/src/session/prompt.ts`
- `opencode-dev/packages/eternity-code/src/cli/cmd/tui/routes/loop/index.tsx`
- `opencode-dev/packages/eternity-code/src/meta/dashboard/*`

当前默认入口命令是：

- `/meta-init`
- `/meta`
- `/meta-decide`
- `/meta-execute`
- `/meta-eval`
- `/meta-optimize`

其中 `/meta-execute` 的当前语义是：

- 为已接受的 cards 生成 `.meta/plans/*.yaml`
- 对 plan 做本地 preflight 检查
- 把 readiness / warnings / blockers 写回 plan 与 loop 元数据

它现在不是默认的自动改代码、自动建分支、自动 commit 执行器。

## 当前 6 阶段映射

### 1. ANALYZE

- 由 `/meta` 触发上游分析与候选生成
- 当前侧重把 `.meta/design.yaml` 注入 prompt 和 loop context
- 运行结果会落到 `loops/*.yaml`

### 2. GENERATE

- `/meta` 生成 cards
- cards 落盘到 `.meta/cards/*.yaml`
- loop 记录 `presented_cards`

### 3. DECIDE

- Loop TUI 中完成 accept / reject
- rejected cards 会要求 reject note
- negative space 会写回 `.meta/design.yaml` 与 `.meta/negatives/*.yaml`

### 4. EXECUTE

当前已落地的是“安全执行准备阶段”，不是全自动执行阶段：

- `/meta-execute` 为 accepted cards 生成 plans
- 每个 plan 由 3-5 个 tasks 组成
- preflight 会检查：
  - `files_to_modify` 是否为空
  - 目标路径是否越界、是否是目录、是否是 glob
  - 是否触碰 `.git/`、`node_modules/`
  - 依赖 task id 是否存在
  - task 之间是否存在依赖环
  - 多个 task 是否命中同一文件
- 检查结果会写入：
  - `plan.preflight`
  - `task.preflight`
  - `loop.execution.preflight_status`
  - `loop.execution.ready_plans / warning_plans / blocked_plans`
  - `loop.execution.warnings / blockers`

### 5. EVALUATE

- `/meta-eval` 运行本地 evaluation
- 结果写回 loop 和 accepted cards
- composite delta 与 rollback 结果会同步写回 loop history

### 6. CLOSE

- `/meta-optimize` 生成 close summary
- baselines / search policy / unlocked negatives 会继续写回设计态

## `packages/loop-runner` 的位置

`opencode-dev/packages/loop-runner` 仍然有价值，但当前角色更像：

- 独立实验 runner
- 更激进的 branch-based 执行实现
- 可供当前主链吸收 phase 设计和 schema 想法的参考包

它不是当前 TUI 默认入口，也不是当前 runtime 的唯一事实来源。

尤其是它的 execute phase 仍然包含：

- git branch 创建
- 自动执行 task
- commit / rollback

这些行为目前没有直接接入当前默认的 `/meta-execute` 主链。

## UI 对应关系

当前 UI 的真实分工：

- Home / WelcomeScreen：展示 `.meta/design.yaml` 的项目欢迎态
- Loop Route：展示当前 loop、decision、execution readiness、evaluation 状态
- Dashboard：只读浏览 `design/cards/loops/negatives/plans`

Dashboard 当前已经能看到 execution tab 里的：

- runtime plan 状态
- preflight 状态
- blockers / warnings
- touched files
- task 级 preflight 摘要

## 当前结论

如果要用一句话描述现在的 Loop Runner：

当前已经形成了“生成 cards -> 人工决策 -> 生成计划 -> 本地 preflight -> 评估 -> 优化”的半闭环；
尚未进入“默认自动改代码 + 自动 commit + 自动 rollback”的全自动执行闭环。

## 下一步建议

建议继续沿当前主链推进，而不是直接切回旧设计稿：

1. 把 `/meta-execute` 继续推进到更真实的 execution orchestration，但先保留 preflight-first 策略。
2. 让 evaluation / optimization 的结果继续回流到 dashboard 的 execution 视图。
3. 只选择性吸收 `packages/loop-runner` 中成熟的 phase 抽象，不直接整包替换当前主链。

---

## 迭代蓝图规划

更新日期：2026-03-26

### 方向一：全自动执行闭环

**目标**：从"生成计划"推进到"可安全执行的编排层"

#### 1.1 增强 `/meta-execute` 执行编排

- **任务**：在保留preflight-first策略的前提下，增加细粒度的执行编排能力
- **实现**：
  - 为每个Task生成具体的代码修改指令（diff格式）
  - 支持Task级别的自动执行与人工确认
  - 执行前自动生成git branch
  - 每个Task完成后自动git commit

#### 1.2 自动Rollback机制

- **任务**：当Task执行失败或评估结果不达标时，自动回滚
- **实现**：
  - 检测执行失败（代码错误、测试失败、preflight不通过）
  - 自动执行git revert或git reset
  - 记录rollback原因到loop记录
  - 支持手动触发rollback

#### 1.3 从loop-runner吸收成熟能力

- **任务**：选择性吸收`packages/loop-runner`中的phase抽象
- **实现**：
  - 吸收git branch创建逻辑
  - 吸收自动commit逻辑
  - 吸收rollback机制
  - 不直接整包替换当前主链

---

### 方向二：UI与Dashboard完善

**目标**：提升Loop执行过程的可视化和交互体验

#### 2.1 TUI Loop界面增强

- **任务**：完善Loop主路由的交互体验
- **实现**：
  - 实时展示Task执行状态（pending→running→completed/failed）
  - 执行过程中的代码diff预览
  - 失败Task的错误信息展示
  - 支持在TUI中手动确认或跳过Task

#### 2.2 Dashboard交互增强

- **任务**：从只读视图升级为可控视图
- **实现**：
  - 在浏览器中查看Task执行详情
  - 支持在浏览器中触发rollback
  - 展示Evaluation结果的趋势图
  - 展示Search Policy的优化历史

#### 2.3 实时更新机制

- **任务**：改善Dashboard的实时性
- **实现**：
  - 考虑引入WebSocket或Server-Sent Events
  - 减少轮询间隔或改为事件驱动
  - 缓存机制避免频繁文件读取

---

### 方向三：Evaluation与Optimization深化

**目标**：让评估结果更准确、优化策略更智能

#### 3.1 Evaluation自动化

- **任务**：让评估过程更自动化
- **实现**：
  - 自动执行Eval Factor定义的测量脚本
  - 支持LLM自动评分（`llm_eval`类型）
  - 评估结果自动写回loop和design
  - 生成评估报告

#### 3.2 Search Policy自适应优化

- **任务**：让搜索策略根据历史结果自动调整
- **实现**：
  - 分析历史loop的成功率
  - 自动调整exploration_rate
  - 根据coverage_gap动态调整candidate_sources权重
  - 支持多维度优化目标

#### 3.3 Negative Space智能管理

- **任务**：自动解锁符合条件的negative
- **实现**：
  - 检测conditional类型negative的解锁条件
  - phase类型negative在stage变更时自动解锁
  - 提供negative解锁建议
  - 记录解锁历史

---

### 方向四：品牌重命名与清理

**目标**：全面完成从opencode到eternity-code的重命名

**状态**：✅ 已完成

---

### 方向五：Sub-agent调度层

**目标**：建立统一的sub-agent调度框架，解决context注入、追踪、复用三大问题

#### 5.1 核心架构实现

- **任务**：创建agents/目录结构，实现dispatcher + registry + context-builder
- **实现**：
  - `agents/dispatcher.ts` - 调度器核心逻辑
  - `agents/registry.ts` - 角色注册表
  - `agents/context-builder.ts` - MetaDesign context组装
  - `agents/types.ts` - AgentRole和AgentTask类型定义

#### 5.2 内置角色实现

- **任务**：实现6个内置角色
- **角色列表**：
  - `card-reviewer` - 卡片评分，提供独立审查视角
  - `coverage-assessor` - 覆盖度评估
  - `planner` - Plan分解（迁移自execution/planner.ts）
  - `task-executor` - Task执行
  - `eval-scorer` - LLM eval打分
  - `prediction-auditor` - 预测准确性审计

#### 5.3 解析器实现

- **任务**：实现输出解析器
- **解析器列表**：
  - `card-review.ts` - 解析卡片评分结果
  - `coverage.ts` - 解析覆盖度评估结果
  - `plan.ts` - 解析Plan分解结果
  - `eval-score.ts` - 解析LLM eval打分结果
  - `prediction-audit.ts` - 解析预测审计结果

#### 5.4 与现有代码集成

- **集成顺序**：
  1. 将planner.ts迁移到dispatcher
  2. 将runner.ts的task-executor迁移
  3. 在卡片生成后插入card-reviewer
  4. 在loop close阶段插入prediction-auditor
  5. 将eval_factor的llm_eval迁移到eval-scorer

---

### 方向六：Prompt优化系统

**目标**：建立三层架构的Prompt优化系统，实现甜点密度原则

#### 6.1 元层实现

- **任务**：实现Prompt生成的元层
- **实现**：
  - 核心任务用1-2句话说清楚
  - 约束只写影响输出质量的必要项
  - 给模型留出填充细节的自由度
  - 输出格式只规定结构，不规定措辞

#### 6.2 优化Pass实现

- **任务**：实现Prompt优化Pass
- **检查项**：
  - 指令密度检查（token数 / 核心意图数）
  - 冲突检测（关键词对匹配）
  - 冗余约束检测（语义相似度）
  - 留白检查（over-specify字段）

#### 6.3 反馈环设计

- **任务**：建立Prompt质量反馈环
- **实现**：
  - 卡片评分 → 聚合为prompt模板评分
  - 使用N次以上的均值作为信号（N ≥ 5）
  - 区分噪音类型：内容噪音、结构噪音、Prompt质量信号

#### 6.4 可学习参数

- **参数列表**：
  - `DENSITY_THRESHOLD` - 最优指令密度阈值
  - 冲突词对表 - 高频冲突词组的优先级规则
  - 留白策略 - 哪些字段应该由模型自由填充

---

### 执行优先级

#### Phase 1-3（已完成）

1. ✅ 品牌重命名（方向四）
2. ✅ 增强`/meta-execute`执行编排（方向一 1.1）
3. ✅ 自动Rollback机制（方向一 1.2）
4. ✅ Evaluation自动化（方向三 3.1）
5. ✅ Dashboard交互增强（方向二 2.2）
6. ✅ Search Policy自适应优化（方向三 3.2）
7. ✅ 实时更新机制（方向二 2.3）
8. ✅ Negative Space智能管理（方向三 3.3）

#### Phase 4（当前迭代）

1. Sub-agent调度层核心架构（方向五 5.1）
2. 解析器实现（方向五 5.3）
3. Planner迁移到dispatcher（方向五 5.4）

#### Phase 5（下一迭代）

1. 内置角色实现（方向五 5.2）
2. 元层实现（方向六 6.1）
3. 优化Pass实现（方向六 6.2）

#### Phase 6（未来迭代）

1. 反馈环设计（方向六 6.3）
2. 可学习参数（方向六 6.4）
3. 与现有代码完整集成（方向五 5.4）

---

### 成功指标

#### 执行闭环指标

- Task自动执行成功率 ≥ 90%
- 自动commit覆盖率 ≥ 80%
- Rollback成功率 = 100%

#### UI体验指标

- Dashboard实时性 < 1秒
- TUI响应时间 < 100ms
- 用户操作步骤减少 ≥ 30%

#### 评估准确性指标

- Evaluation自动化率 ≥ 70%
- Search Policy优化后成功率提升 ≥ 15%
- Negative自动解锁准确率 = 100%

---

### 风险与缓解

#### 技术风险

1. **自动执行安全性**
   - 风险：自动改代码可能引入错误
   - 缓解：保留preflight-first策略，增加人工确认环节

2. **性能风险**
   - 风险：实时更新可能影响性能
   - 缓解：使用事件驱动而非轮询，增加缓存机制

3. **兼容性风险**
   - 风险：重命名可能破坏现有集成
   - 缓解：提供迁移脚本，保留向后兼容

#### 项目风险

1. **范围蔓延**
   - 风险：迭代方向过多可能导致进度延迟
   - 缓解：严格按Phase执行，每个Phase有明确交付物

2. **资源限制**
   - 风险：某些方向需要较多资源
   - 缓解：优先实现核心功能，非核心功能可延后
