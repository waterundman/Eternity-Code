# Meta-Design SaaS 自动迭代系统 —— Context 管理策略（基于 OpenCode）

---

## 0. 目标

本方案用于构建一个稳定、可扩展的上下文管理系统，服务于基于 LLM 的自动迭代型元设计 SaaS。
系统运行在 OpenCode 架构之上。

核心问题不是“如何使用大上下文”，而是：

> 如何在多轮自动迭代中 **避免语义漂移 + 控制上下文复杂度 + 保持目标一致性**

---

## 1. 基本原则（必须遵守）

### 1.1 Context ≠ Memory

* Context 是短期工作缓存
* Memory 必须外置（数据库 / 向量库 / 文件系统）

---

### 1.2 不允许使用满上下文

* 最大 context ≠ 可用 context
* 推荐上限：

≤ 40% of max context

---

### 1.3 强制结构化

禁止：

* 长自然语言历史
* 非结构化状态描述

必须：

* JSON / YAML / MD结构

---

### 1.4 信息必须可裁剪

所有上下文必须支持：

* chunking
* ranking
* 删除

---

## 2. 三层 Context 架构

* Short-Term Context（执行层）
* Mid-Term Memory（状态层）
* Long-Term Memory（知识层）

---

## 3. Short-Term Context（执行层）

### 3.1 定义

当前任务执行所需的最小信息集合

---

### 3.2 包含内容

* 当前任务（明确指令）
* 当前操作目标（文件 / 模块）
* 最近 1–2 步操作
* 必要代码片段（非全文件）

---

### 3.3 约束

≤ 20% 总 context

---

### 3.4 禁止内容

* 历史版本
* 无关文件
* 长对话记录

---

## 4. Mid-Term Memory（状态层）

### 4.1 定义

用于防止系统漂移的“压缩状态表示”

---

### 4.2 数据结构（示例）

```yaml
project_state:
  current_module: UI Generator
  primary_goal: Improve animation system
  completed:
    - layout system
    - theme system
  pending:
    - motion system
    - interaction layer
  constraints:
    - no full rewrite
    - maintain API compatibility
```

---

### 4.3 作用

* 提供全局一致性
* 防止目标偏移
* 控制长期方向

---

### 4.4 约束

≤ 20–30% context

---

## 5. Long-Term Memory（知识层）

### 5.1 存储内容

* 历史版本
* 用户偏好
* 设计演化路径
* 成功 / 失败案例
* 全代码库

---

### 5.2 使用方式

只允许通过：

RAG（检索增强）

---

### 5.3 检索约束

* Top-K ≤ 5
* 必须 relevance 排序
* 禁止全量加载

---

## 6. Context Mixer（核心模块）

### 6.1 功能

将三层信息组合为最终 prompt

---

### 6.2 输入

* 当前任务
* Short-Term Context
* Mid-Term Memory
* RAG 检索结果

---

### 6.3 输出

严格受限的 LLM 输入

---

### 6.4 Token 预算（示例）

* Short-Term   ≤ 200k
* Mid-Term     ≤ 200k
* RAG          ≤ 100k
* System       ≤ 50k

Total ≤ 550k（建议压到 400k）

---

### 6.5 信息筛选算法

```python
score = relevance * recency * task_alignment
```

仅保留：

* 文件片段：Top 5–10
* 状态块：Top 3
* 检索结果：Top 5

---

### 6.6 去冗余策略

必须执行：

* embedding 去重
* 删除重复语义
* 删除执行过的指令

---

## 7. 目标锁定机制（防漂移核心）

### 7.1 每轮必须包含

```yaml
goal:
  primary: 不可修改
  secondary: 可调整
  constraints: 强约束
```

---

### 7.2 写入 system prompt

确保模型始终感知：

* 当前目标
* 禁止偏离范围

---

## 8. 状态对齐检查（强制）

每轮执行后：

1. 当前输出是否偏离目标？
2. 偏离点在哪里？
3. 是否违反约束？

---

### 8.1 处理逻辑

* 若偏离 → 回滚
* 若不确定 → 再验证
* 若通过 → 进入下一轮

---

## 9. 版本控制策略（关键）

### 9.1 禁止线性历史

v1 → v2 → v3 → v4

---

### 9.2 使用分支结构

```
        v2a
v1 → v2
        v2b
```

---

### 9.3 好处

* 避免错误累积
* 支持多路径探索
* 提高收敛概率

---

## 10. OpenCode 特化优化

### 10.1 禁止全文件注入

必须改造：

* 使用 AST slicing
* 函数级 / 组件级加载

---

### 10.2 Rewrite 限制

```yaml
max_scope:
  files: 1
  lines: ≤ 300
```

---

### 10.3 强制任务拆分

当超过限制：

→ 自动拆任务

---

### 10.4 Prompt 模板（强制结构）

```
[GOAL]
[CURRENT STATE]
[TARGET FILE]
[CONSTRAINTS]
[ALLOWED ACTION]
```

---

## 11. Iteration Loop（建议实现）

```python
while not done:
    plan = planner()
    context = context_mixer(plan)
    result = executor(context)
    check = verifier(result)

    if check == FAIL:
        rollback()
    else:
        update_memory()
```

---

## 12. 关键风险与对策

| 风险            | 原因        | 对策        |
| ------------- | --------- | --------- |
| 语义漂移          | context过大 | 限制≤40%    |
| hallucination | 信息稀释      | RAG替代堆积   |
| 目标偏移          | 多轮迭代      | goal lock |
| 代码崩坏          | 全文件改写     | 限制rewrite |
| 信息污染          | 历史堆积      | 分层memory  |

---

## 13. 最终原则（不可违背）

1. Context 必须受控
2. Memory 必须外置
3. 每轮必须对齐目标
4. 不允许无限上下文增长
5. 不允许无结构信息进入系统

---

## 14. 一句话结论

> 系统稳定性的关键不在模型能力，而在于 **context 是否被严格约束与调度**
