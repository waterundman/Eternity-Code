# MetaDesign 迭代蓝图

## 核心目标

构建"产品决策的操作系统"，让 coding agent 不漂移。

---

## 迭代阶段

### Phase 1: 完整 Loop 流程 ✅

让 `/meta` 命令跑完完整的 6 阶段循环。

**子任务：**
- [x] 1.1 自动保存卡片（插件集成）
- [x] 1.2 TUI 决策界面（接受/拒绝）
- [x] 1.3 自动生成 NEG
- [x] 1.4 Loop 历史记录

---

### Phase 2: 自动执行 ✅

接受的卡片自动执行代码修改。

**子任务：**
- [x] 2.1 解析卡片 scope，确定修改范围
- [x] 2.2 调用 opencode 工具执行修改
- [x] 2.3 运行 linter/type-check 验证
- [x] 2.4 失败自动回滚

**实现：**
- `executor.ts` - 执行器核心功能
- `/meta-execute` 命令

---

### Phase 3: 评估闭环 ✅

执行后自动评估，对比预测 vs 实际。

**子任务：**
- [x] 3.1 运行 eval_factors 定义的评估
- [x] 3.2 更新卡片 outcome
- [x] 3.3 计算预测准确度
- [x] 3.4 更新 design.yaml baseline

**实现：**
- `evaluator.ts` - 评估器核心功能
- `/meta-eval` 命令

---

### Phase 4: 智能优化 ✅

基于历史数据优化生成策略。

**子任务：**
- [x] 4.1 分析历史卡片接受率
- [x] 4.2 调整 search_policy 权重
- [x] 4.3 条件性 NEG 自动解锁
- [x] 4.4 需求覆盖度自动更新

**实现：**
- `optimizer.ts` - 优化器核心功能
- `/meta-optimize` 命令

---

## 当前状态

**已完成：**
- ✅ 注入层（system prompt）
- ✅ 命令层（/meta、/meta-decide、/meta-execute、/meta-eval、/meta-optimize）
- ✅ 持久化层（YAML 文件）
- ✅ 负空间过滤
- ✅ 需求覆盖度可视化
- ✅ Loop 历史记录
- ✅ 自动执行（scope 解析、验证、回滚）
- ✅ 评估闭环（eval_factors、outcome、baseline）
- ✅ 智能优化（历史分析、权重调整、NEG 解锁、覆盖度更新）

**下一步：** 所有 Phase 已完成！可以进行端到端测试。

---

## 命令列表

| 命令 | 功能 |
|------|------|
| `/meta` | 生成决策卡片 |
| `/meta-decide` | 决策阶段（接受/拒绝） |
| `/meta-execute` | 为已接受的卡片生成安全执行计划 |
| `/meta-eval` | 评估执行结果 |
| `/meta-optimize` | 优化搜索策略 |

---

## 文件结构

```
.meta/
├── design.yaml      # 元设计文件
├── cards/           # 决策卡片
├── loops/           # 循环记录
└── negatives/       # 被拒绝的方向

plugin/
└── metadesign.ts    # MetaDesign 插件

packages/opencode/src/meta/
├── types.ts         # 类型定义
├── index.ts         # 核心功能
├── cards.ts         # 卡片管理
├── command.ts       # 命令实现
├── plugin.ts        # 插件实现
├── executor.ts      # 执行器
├── evaluator.ts     # 评估器
└── optimizer.ts     # 优化器
```
