# 系统优化步骤蓝图

更新日期：2026-03-26

## 优化目标

提高各系统间的拟合性，消除类型定义重复，修正类型不匹配问题。

## 问题清单

### 1. 类型定义重复

| 问题 | 位置 | 影响 |
|------|------|------|
| ExecutionPreflightSummary vs PlanPreflight | execute.ts vs execution/types.ts | 功能相似但结构不同 |
| ExecutionOptions vs ExecutorOptions | execute.ts vs execution/executor.ts | 几乎完全相同 |
| DEFAULT_CONFIG 重复 | prompt-meta.ts vs prompt/index.ts | 配置重复定义 |

### 2. 类型不匹配

| 问题 | 位置 | 影响 |
|------|------|------|
| 函数参数类型不匹配 | execute.ts 调用 execution/executor.ts | 类型不安全 |

### 3. 类型不完整

| 问题 | 位置 | 影响 |
|------|------|------|
| session 参数使用 any | evaluator.ts | 类型不安全 |

## 优化步骤

### Step 1: 统一类型定义（execute.ts）

**目标**：删除 `ExecutionPreflightSummary`，统一使用 `PlanPreflight`

**修改内容**：
1. 删除 `ExecutionPreflightSummary` 接口定义
2. 更新 `ExecutePlanningResult` 使用 `PlanPreflight`
3. 更新相关函数返回类型

### Step 2: 统一 ExecutionOptions

**目标**：让 `ExecutionOptions` 继承自 `ExecutorOptions`

**修改内容**：
1. 修改 `ExecutionOptions` 定义，使其兼容 `ExecutorOptions`
2. 更新函数签名以正确传递参数

### Step 3: 删除重复的 DEFAULT_CONFIG

**目标**：删除 `prompt-meta.ts` 中的 `DEFAULT_CONFIG`

**修改内容**：
1. 删除 `prompt-meta.ts` 中的 `DEFAULT_CONFIG` 定义
2. 使用从 `index.ts` 导入的 `DEFAULT_PROMPT_CONFIG`

### Step 4: 改进 any 类型使用

**目标**：为 `session` 参数定义具体类型

**修改内容**：
1. 定义 `Session` 接口
2. 更新相关函数签名

### Step 5: 验证

**目标**：运行 typecheck 确保所有修改正确

## 执行顺序

1. Step 1 → 2. Step 2 → 3. Step 3 → 4. Step 4 → 5. Step 5

## 预期结果

- 消除类型定义重复
- 修正类型不匹配
- 提高代码可维护性
- 通过 typecheck 验证
